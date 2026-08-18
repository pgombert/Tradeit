import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { INSTRUMENTS } from '@tradeit/shared';
import { env } from '../config/environment.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/error-handler.js';
import * as authService from '../services/auth.service.js';
import * as econService from '../services/econ.service.js';
import * as regimeService from '../services/regime.service.js';
import * as schwabService from '../services/schwab.service.js';
import { buildAuthorizeUrl } from '../services/schwab.parse.js';
import { exchangeAuthCode } from '../services/schwab.oauth.js';
import { saveFromAuthCode } from '../services/schwab.tokens.js';
import { getRiskStatus } from '../services/risk.service.js';
import { prisma } from '../lib/prisma.js';

export const router: Router = Router();

/** The signed state nonce that ties a Schwab callback to our connect request. */
const SCHWAB_STATE_PURPOSE = 'schwab_oauth';

function frontendRedirect(status: string, reason?: string): string {
  const url = new URL(env.FRONTEND_URL);
  url.searchParams.set('schwab', status);
  if (reason) url.searchParams.set('reason', reason);
  return url.toString();
}

// ---- Health -------------------------------------------------------------

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---- Auth ---------------------------------------------------------------

const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

router.post(
  '/auth/google',
  asyncHandler(async (req, res) => {
    const { idToken } = googleLoginSchema.parse(req.body);
    res.json(await authService.loginWithGoogle(idToken));
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

router.post('/auth/refresh', (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(authService.refresh(refreshToken));
});

// ---- Schwab OAuth callback ----------------------------------------------
// Public by necessity: Schwab redirects the browser here with no bearer token.
// The `state` nonce — a short-lived JWT we signed when the connect began — is
// what authenticates the flow, so a stray call here cannot plant a token.
// Read-only scope; this stores tokens and never touches a trading endpoint.

router.get(
  '/schwab/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    if (typeof error === 'string' && error) {
      res.redirect(frontendRedirect('error', error));
      return;
    }
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.redirect(frontendRedirect('error', 'missing_code'));
      return;
    }

    try {
      const payload = jwt.verify(state, env.JWT_SECRET) as { purpose?: string };
      if (payload.purpose !== SCHWAB_STATE_PURPOSE) throw new Error('wrong purpose');
    } catch {
      res.redirect(frontendRedirect('error', 'bad_state'));
      return;
    }

    try {
      const tokens = await exchangeAuthCode(code);
      await saveFromAuthCode(tokens);
      res.redirect(frontendRedirect('connected'));
    } catch (err) {
      console.error('[schwab] callback token exchange failed:', err);
      res.redirect(frontendRedirect('error', 'exchange_failed'));
    }
  }),
);

// ---- Everything below requires the single allowlisted user --------------

router.use(requireAuth);

// Begin the Schwab connect: hand the dashboard the URL to send the user to.
router.get('/schwab/login', (req, res) => {
  if (!schwabService.isConfigured()) {
    throw new AppError(503, 'Schwab credentials are not set on the server.');
  }
  const { id } = (req as AuthenticatedRequest).user!;
  const state = jwt.sign({ purpose: SCHWAB_STATE_PURPOSE, sub: id }, env.JWT_SECRET, {
    expiresIn: '10m',
  });
  const url = buildAuthorizeUrl(env.SCHWAB_CLIENT_ID!, env.SCHWAB_REDIRECT_URI!, state);
  res.json({ url });
});

router.get('/econ/series', asyncHandler(async (_req, res) => {
  res.json(await econService.listSeries());
}));

const seriesQuery = z.object({ days: z.coerce.number().int().min(7).max(3650).default(365) });

router.get('/econ/series/:seriesId', asyncHandler(async (req, res) => {
  const { days } = seriesQuery.parse(req.query);
  res.json(await econService.getSeries(String(req.params.seriesId), days));
}));

router.get('/econ/yield-curve', asyncHandler(async (_req, res) => {
  res.json(await econService.getYieldCurve());
}));

router.get('/regime', asyncHandler(async (_req, res) => {
  res.json(await regimeService.getRegime());
}));

router.get('/instruments', (_req, res) => {
  res.json(INSTRUMENTS);
});

router.get('/account', asyncHandler(async (_req, res) => {
  res.json(await schwabService.getAccountSnapshot());
}));

router.get('/risk', (_req, res) => {
  // Equity is unknown until the account is connected in Phase 1.
  res.json(getRiskStatus(null, null));
});

router.get('/collectors/runs', asyncHandler(async (_req, res) => {
  const runs = await prisma.collectorRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  res.json(runs);
}));
