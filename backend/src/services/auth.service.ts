import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthTokens, JwtPayload, LoginResponse } from '@tradeit/shared';
import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error-handler.js';

const ACCESS_TTL = '2h';
const REFRESH_TTL = '30d';

function isAllowed(email: string): boolean {
  return email.trim().toLowerCase() === env.ALLOWED_EMAIL.toLowerCase();
}

function issueTokens(payload: JwtPayload): AuthTokens {
  return {
    accessToken: jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL }),
    refreshToken: jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL }),
  };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  // Same error for "wrong address" and "wrong password" — a single-user instance
  // shouldn't confirm which address owns it.
  const rejection = new AppError(401, 'Invalid credentials');

  if (!isAllowed(email)) throw rejection;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) throw rejection;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw rejection;

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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
