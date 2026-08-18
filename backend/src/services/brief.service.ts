/**
 * Stages 1 + 2 wired to the data. Loads the screenable universe's price bars and
 * the recent market observations, converts Decimal→number at the edge, and runs
 * the pure pipeline (`runStage1`) and dossier assembly. No AI, no trading — the
 * rules-only brain that produces ranked candidates each with an evidence packet.
 */
import {
  hasInverseFor,
  isSectorExposure,
  screenableInstruments,
  type Bar,
  type Candidate,
  type Dossier,
  type DossierRegime,
} from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { getRegime } from './regime.service.js';
import { runStage1, type SecurityBars } from './candidates.parse.js';
import { buildDossier, observationToEvidence } from './dossier.parse.js';

/** ~1 trading year — enough for the 200-day average and 6-month returns. */
const BARS_LOOKBACK = 260;
/** How far back market-context observations are pulled for the dossier. */
const CONTEXT_DAYS = 21;
const CONTEXT_LIMIT = 60;
const BENCHMARK = 'SPY';

export interface Brief {
  asOf: string;
  regime: DossierRegime;
  candidates: Candidate[];
  dossiers: Dossier[];
}

/** Load a security's most recent bars, oldest-first, prices as numbers. */
async function loadBars(securityId: string): Promise<Bar[]> {
  const rows = await prisma.priceBar.findMany({
    where: { securityId },
    orderBy: { date: 'desc' },
    take: BARS_LOOKBACK,
    select: { date: true, open: true, high: true, low: true, close: true, volume: true },
  });
  return rows
    .reverse()
    .map((b) => ({
      date: b.date.toISOString().slice(0, 10),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }));
}

/** The market-wide observations (letters, transcripts, econ, sentiment) in the
 * recent window, as citable evidence lines, newest first. */
async function loadContext(): Promise<ReturnType<typeof observationToEvidence>[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONTEXT_DAYS);
  const rows = await prisma.observation.findMany({
    where: { scope: 'MARKET', observedAt: { gte: cutoff } },
    orderBy: { observedAt: 'desc' },
    take: CONTEXT_LIMIT,
    select: { id: true, source: true, kind: true, scope: true, observedAt: true, payload: true, url: true },
  });
  return rows.map((r) => observationToEvidence({ ...r, source: r.source, kind: r.kind }));
}

/**
 * Build the weekly brief: screen the universe into ranked candidates, then wrap
 * each in a Stage 2 dossier (its price readings, the regime, and the market
 * context that bears on it). Returns the whole packet for the API / Stage 3.
 */
export async function buildBrief(): Promise<Brief> {
  const universe = screenableInstruments();
  const symbols = universe.map((i) => i.symbol);

  const securityRows = await prisma.security.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true, symbol: true },
  });
  const idBySymbol = new Map(securityRows.map((s) => [s.symbol, s.id]));

  const [regimeVerdict, context] = await Promise.all([getRegime(), loadContext()]);
  const regime: DossierRegime = {
    regime: regimeVerdict.regime,
    leverageAllowed: regimeVerdict.leverageAllowed,
    riskBudget: regimeVerdict.riskBudget,
    asOf: regimeVerdict.asOf,
  };

  const securities: SecurityBars[] = (
    await Promise.all(
      universe.map(async (inst): Promise<SecurityBars | null> => {
        const id = idBySymbol.get(inst.symbol);
        if (!id) return null; // security not seeded / no price data yet
        const bars = await loadBars(id);
        if (bars.length === 0) return null;
        return {
          symbol: inst.symbol,
          exposure: inst.exposure,
          isSector: isSectorExposure(inst.exposure),
          hasInverse: hasInverseFor(inst.exposure),
          isLeveraged: false,
          bars,
        };
      }),
    )
  ).filter((s): s is SecurityBars => s !== null);

  const benchmarkId = idBySymbol.get(BENCHMARK);
  const benchmarkBars = benchmarkId ? await loadBars(benchmarkId) : [];

  const { candidates, indicatorsBySymbol, asOf } = runStage1(securities, benchmarkBars, regime);

  const dossiers = candidates.map((c) => {
    const price = indicatorsBySymbol.get(c.symbol)!;
    // Every candidate reads against the same market context today (observations
    // are market-scoped). Per-ticker context arrives with single-stock data.
    return buildDossier(c, price, regime, context, asOf);
  });

  return { asOf, regime, candidates, dossiers };
}
