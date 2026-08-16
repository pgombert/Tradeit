import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@tradeit/shared';
import { env } from '../config/environment.js';
import { AppError } from './error-handler.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
}

/**
 * Verifies the bearer token and re-checks the allowlist on every request.
 * A token minted before ALLOWED_EMAIL changed must stop working immediately.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'Missing bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    next(new AppError(401, 'Invalid or expired token'));
    return;
  }

  if (payload.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
    next(new AppError(403, 'Not authorised for this instance'));
    return;
  }

  req.user = { id: payload.sub, email: payload.email };
  next();
}
