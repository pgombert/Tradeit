import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import type { AuthTokens, JwtPayload, LoginResponse } from '@tradeit/shared';
import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error-handler.js';
import { GoogleAuthError, resolveGoogleEmail } from './auth.google.js';

const ACCESS_TTL = '2h';
const REFRESH_TTL = '30d';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

function isAllowed(email: string): boolean {
  return email.trim().toLowerCase() === env.ALLOWED_EMAIL.toLowerCase();
}

function issueTokens(payload: JwtPayload): AuthTokens {
  return {
    accessToken: jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL }),
    refreshToken: jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL }),
  };
}

/**
 * Verifies a Google ID token, confirms it belongs to the one allowlisted email,
 * and issues our own access/refresh tokens. The account is created on first
 * successful sign-in — there is no separate registration step.
 */
export async function loginWithGoogle(idToken: string): Promise<LoginResponse> {
  // One opaque error for every failure — a single-user instance shouldn't reveal
  // whether an address is the one that owns it.
  const rejection = new AppError(401, 'Invalid credentials');

  let email: string;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    email = resolveGoogleEmail(ticket.getPayload() ?? {}, env.ALLOWED_EMAIL);
  } catch (err) {
    if (err instanceof GoogleAuthError) throw rejection;
    // A malformed/expired/forged token throws out of verifyIdToken.
    throw rejection;
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  const payload: JwtPayload = { sub: user.id, email: user.email };
  return { ...issueTokens(payload), user: { id: user.id, email: user.email } };
}

export function refresh(refreshToken: string): AuthTokens {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  if (!isAllowed(payload.email)) {
    throw new AppError(403, 'Not authorised for this instance');
  }

  return issueTokens({ sub: payload.sub, email: payload.email });
}
