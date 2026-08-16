import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import * as authService from '../services/auth.service.js';
import * as econService from '../services/econ.service.js';
import * as schwabService from '../services/schwab.service.js';
import { getRiskStatus } from '../services/risk.service.js';
import { prisma } from '../lib/prisma.js';

export const router: Router = Router();

// ---- Health -------------------------------------------------------------

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---- Auth ---------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await authService.login(email, password));
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

router.post('/auth/refresh', (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(authService.refresh(refreshToken));
});

// ---- Everything below requires the single allowlisted user --------------

router.use(requireAuth);

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
