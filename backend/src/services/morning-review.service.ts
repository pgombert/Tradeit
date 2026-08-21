/**
 * The morning portfolio check. Takes every holding across the connected Schwab
 * accounts and runs it through the momentum rules (holding-review engine) against
 * the day's fresh data — trend, trailing stop, momentum, earnings, regime — to a
 * Hold / Trim / Exit call with plain reasons. Stored so the site serves it
 * instantly and the scheduled job does the slow work once.
 *
 * Advisory only. Nothing here places an order — like everything on the Schwab
 * side, it is read-only, and Pete decides and executes every trade himself.
 */
import { Prisma } from '@prisma/client';
import {
  assessHolding,
  byUrgency,
  computeIndicators,
  type Bar,
  type HoldingReviewItem,
  type HoldingSignals,
  type Indicators,
  type MorningReview,
} from '@tradeit/shared';
import { ensureSymbolsPriced } from '../collectors/schwab.prices.collector.js';
import { prisma } from '../lib/prisma.js';
import { symbolsReportingSoon } from './portfolio.service.js';
import { getRegime } from './regime.service.js';
import { getPortfolioSnapshot } from './schwab.service.js';

/** Latest close-based indicators for one symbol, or null when we hold no bars. */
async function indicatorsFor(symbol: string): Promise<Indicators | null> {
  const rows = await prisma.priceBar.findMany({
    where: { security: { symbol } },
    orderBy: { date: 'asc' },
    select: { date: true, open: true, high: true, low: true, close: true, volume: true },
  });
  if (rows.length === 0) return null;
  const bars: Bar[] = rows.map((b) => ({
    date: b.date.toISOString().slice(0, 10),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
    volume: Number(b.volume),
  }));
  return computeIndicators(bars);
}

async function save(review: MorningReview): Promise<void> {
  await prisma.morningReview.create({
    data: {
      asOf: new Date(`${review.asOf}T00:00:00Z`),
      payload: review as unknown as Prisma.InputJsonObject,
    },
  });
}

/** Generate and store the morning check across all connected accounts. */
export async function generateMorningReview(): Promise<MorningReview> {
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const snap = await getPortfolioSnapshot();

  if (snap.status !== 'CONNECTED') {
    const review: MorningReview = {
      asOf,
      generatedAt: now.toISOString(),
      connected: false,
      regime: 'UNKNOWN',
      totalValue: snap.totalValue,
      summary: { exit: 0, trim: 0, hold: 0 },
      items: [],
      note: snap.message ?? 'Schwab is not connected — connect it to run the morning check.',
    };
    await save(review);
    console.log('[morning] stored — Schwab not connected');
    return review;
  }

  const symbols = snap.positions.map((p) => p.symbol);
  // Make sure holdings outside the tracked universe have price history to judge.
  await ensureSymbolsPriced(symbols);

  const [regime, reportingSoon] = await Promise.all([getRegime(), symbolsReportingSoon(symbols)]);

  const items: HoldingReviewItem[] = [];
  for (const p of snap.positions) {
    const ind = await indicatorsFor(p.symbol);
    const mv = Number(p.marketValue);
    const pnl = Number(p.unrealizedPnl);
    const cost = mv - pnl;
    const gainFromCost = cost > 0 ? pnl / cost : null;

    const signals: HoldingSignals = {
      symbol: p.symbol,
      price: ind?.close ?? null,
      return1w: ind?.return1w ?? null,
      return1m: ind?.return1m ?? null,
      return3m: ind?.return3m ?? null,
      above50dma: ind?.above50dma ?? null,
      above200dma: ind?.above200dma ?? null,
      atrPct: ind?.atrPct ?? null,
      drawdownFromHigh: ind?.drawdownFromHigh ?? null,
      earningsWithinHold: reportingSoon.has(p.symbol),
      regimeCrisis: regime.regime === 'CRISIS',
      gainFromCost,
      weight: p.weight,
    };

    items.push({
      symbol: p.symbol,
      name: p.description,
      quantity: p.quantity,
      marketValue: p.marketValue,
      weight: p.weight,
      gainFromCost,
      price: signals.price,
      return1w: signals.return1w,
      return1m: signals.return1m,
      return3m: signals.return3m,
      accounts: p.accounts,
      verdict: assessHolding(signals),
    });
  }

  items.sort((a, b) => byUrgency(a.verdict, b.verdict) || Number(b.marketValue) - Number(a.marketValue));

  const summary = {
    exit: items.filter((i) => i.verdict.action === 'EXIT').length,
    trim: items.filter((i) => i.verdict.action === 'TRIM').length,
    hold: items.filter((i) => i.verdict.action === 'HOLD').length,
  };

  const review: MorningReview = {
    asOf,
    generatedAt: now.toISOString(),
    connected: true,
    regime: regime.regime,
    totalValue: snap.totalValue,
    summary,
    items,
    note: null,
  };
  await save(review);
  console.log(`[morning] stored — ${items.length} holdings: ${summary.exit} exit, ${summary.trim} trim, ${summary.hold} hold`);
  return review;
}

/** The most recently generated morning check, or null if none yet. */
export async function getLatestMorningReview(): Promise<MorningReview | null> {
  const row = await prisma.morningReview.findFirst({ orderBy: { generatedAt: 'desc' } });
  return row ? (row.payload as unknown as MorningReview) : null;
}
