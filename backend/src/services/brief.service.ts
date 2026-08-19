/**
 * Stages 1 + 2 wired to the data. Loads the screenable universe's price bars and
 * the recent market observations, converts Decimal→number at the edge, and runs
 * the pure pipeline (`runStage1`) and dossier assembly. No AI, no trading — the
 * rules-only brain that produces ranked candidates each with an evidence packet.
 */
import {
  hasInverseFor,
  instrumentBySymbol,
  isSectorExposure,
  screenableInstruments,
  type Bar,
  type Candidate,
  type Dossier,
  type DossierRegime,
  type EvidenceLine,
  type Portfolio,
} from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { getRegime } from './regime.service.js';
import { runStage1, type SecurityBars } from './candidates.parse.js';
import { buildDossier, observationToEvidence } from './dossier.parse.js';
import { constructPortfolio } from './portfolio.service.js';

/** ~1 trading year — enough for the 200-day average and 6-month returns. */
const BARS_LOOKBACK = 260;
/** Hard liquidity floor: a name must trade well above this in average daily
 * dollar volume so a $100k position goes in and out in seconds without moving
 * the price — the exit speed the momentum strategy depends on. */
const LIQUIDITY_FLOOR = 20_000_000;
/** How far back market-context observations are pulled for the dossier. */
const CONTEXT_DAYS = 21;
const CONTEXT_LIMIT = 60;
/** Cap on evidence lines per dossier: per-ticker items first, then market context. */
const DOSSIER_CONTEXT_LIMIT = 40;
const BENCHMARK = 'SPY';

export interface Brief {
  asOf: string;
  regime: DossierRegime;
  candidates: Candidate[];
  dossiers: Dossier[];
  portfolio: Portfolio;
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

/** Per-ticker observations (earnings, filings, news scoped to a symbol) in a
 * window that spans recent history and the coming two weeks — so an upcoming
 * earnings date shows up as a catalyst. Grouped by scope (the symbol). */
async function loadPerSymbolContext(symbols: string[]): Promise<Map<string, EvidenceLine[]>> {
  const from = new Date();
  from.setDate(from.getDate() - CONTEXT_DAYS);
  const to = new Date();
  to.setDate(to.getDate() + 21); // catch upcoming earnings (calendar is future-dated)

  const rows = await prisma.observation.findMany({
    where: { scope: { in: symbols }, observedAt: { gte: from, lte: to } },
    orderBy: { observedAt: 'asc' },
    select: { id: true, source: true, kind: true, scope: true, observedAt: true, payload: true, url: true },
  });

  const bySymbol = new Map<string, EvidenceLine[]>();
  for (const r of rows) {
    const line = observationToEvidence({ ...r, source: r.source, kind: r.kind });
    const arr = bySymbol.get(r.scope) ?? [];
    arr.push(line);
    bySymbol.set(r.scope, arr);
  }
  return bySymbol;
}

/**
 * Build the weekly brief: screen the universe into ranked candidates, then wrap
 * each in a Stage 2 dossier (its price readings, the regime, and the market
 * context that bears on it). Returns the whole packet for the API / Stage 3.
 */
export async function buildBrief(): Promise<Brief> {
  // The screenable universe: the base long ETFs (index, sectors, rates/credit/
  // commodity — not inverse or leveraged, which are Stage 5 expression vehicles)
  // plus every single stock. Loaded from the securities table so the validation
  // anchor is the real rows, and a stock with no price data yet drops out.
  const baseEtfSymbols = screenableInstruments().map((i) => i.symbol);
  const securityRows = await prisma.security.findMany({
    where: { OR: [{ symbol: { in: baseEtfSymbols } }, { class: 'EQUITY' }] },
    select: { id: true, symbol: true, name: true, avgDollarVolume: true },
  });
  const validSymbols = new Set(securityRows.map((s) => s.symbol));
  // Symbol → company name, so every candidate (and the whole brief) reads with
  // the name beside the ticker, never a bare symbol.
  const nameBySymbol = new Map(securityRows.map((s) => [s.symbol, s.name]));

  const [regimeVerdict, context] = await Promise.all([getRegime(), loadContext()]);
  const regime: DossierRegime = {
    regime: regimeVerdict.regime,
    leverageAllowed: regimeVerdict.leverageAllowed,
    riskBudget: regimeVerdict.riskBudget,
    asOf: regimeVerdict.asOf,
  };

  const securities: SecurityBars[] = (
    await Promise.all(
      securityRows.map(async (row): Promise<SecurityBars | null> => {
        const bars = await loadBars(row.id);
        if (bars.length === 0) return null; // no price history yet
        const inst = instrumentBySymbol(row.symbol);
        // Liquidity gate for single stocks: a name we can't exit fast has no
        // place in a cut-losers-fast momentum book. (ETFs in the base set are all
        // deeply liquid.) A stock with no computed ADV yet is excluded until it has one.
        if (!inst) {
          const adv = row.avgDollarVolume === null ? 0 : Number(row.avgDollarVolume);
          if (adv < LIQUIDITY_FLOOR) return null;
        }
        if (inst) {
          return {
            symbol: row.symbol,
            exposure: inst.exposure,
            isSector: isSectorExposure(inst.exposure),
            hasInverse: hasInverseFor(inst.exposure),
            isLeveraged: false,
            bars,
          };
        }
        // A single stock is its own exposure: not a sector ETF, and — no
        // single-stock inverse exists — a bearish view is not expressible, so
        // the screens only ever surface it long.
        return {
          symbol: row.symbol,
          exposure: row.symbol,
          isSector: false,
          hasInverse: false,
          isLeveraged: false,
          bars,
        };
      }),
    )
  ).filter((s): s is SecurityBars => s !== null);

  const benchmarkId = securityRows.find((r) => r.symbol === BENCHMARK)?.id;
  const benchmarkBars = benchmarkId ? await loadBars(benchmarkId) : [];

  const { candidates: rawCandidates, indicatorsBySymbol, asOf } = runStage1(securities, benchmarkBars, regime, {
    isValidSymbol: (s) => validSymbols.has(s),
    // Single stocks only in the book: an ETF resolves to a base instrument, a
    // stock doesn't. ETFs are still screened above (market context, relative
    // strength) but never become candidates — this is a single-stock momentum hunt.
    candidateFilter: (s) => !instrumentBySymbol(s),
  });
  // Attach the company name to every candidate (the pure layer works in symbols).
  const candidates = rawCandidates.map((c) => ({ ...c, name: nameBySymbol.get(c.symbol) }));

  // Each dossier leads with the candidate's own per-ticker evidence (its
  // earnings catalyst, any symbol-scoped items), then the shared market context.
  const perSymbol = await loadPerSymbolContext(candidates.map((c) => c.symbol));
  const dossiers = candidates.map((c) => {
    const price = indicatorsBySymbol.get(c.symbol)!;
    const ctx: EvidenceLine[] = [...(perSymbol.get(c.symbol) ?? []), ...context].slice(0, DOSSIER_CONTEXT_LIMIT);
    return buildDossier(c, price, regime, ctx, asOf);
  });

  const portfolio = await constructPortfolio(candidates, indicatorsBySymbol, regime, asOf);

  return { asOf, regime, candidates, dossiers, portfolio };
}
