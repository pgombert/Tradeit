/**
 * Stage 7 — the self-learning loop's measurement half. Every brief we've ever
 * stored named specific positions at specific entry prices; this grades those
 * calls against what the stock actually did afterward, using our own price data.
 *
 * The output starts sparse — a pick made today hasn't gone anywhere yet — and
 * sharpens as the track record accumulates. Reweighting the screens toward what
 * demonstrably works comes later; first the system has to see its own scorecard.
 *
 * Read-only. Nothing here trades, and every number comes from stored prices.
 * The grading maths lives in attribution.parse.ts so it can be tested directly.
 */
import type { AttributionSummary, StoredBrief } from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { gradeBriefs, rollup } from './attribution.parse.js';

/** Latest closes we hold for a set of symbols, one row per symbol. */
async function latestCloses(symbols: string[]): Promise<Map<string, number>> {
  const closes = new Map<string, number>();
  for (const symbol of new Set(symbols)) {
    const bar = await prisma.priceBar.findFirst({
      where: { security: { symbol } },
      orderBy: { date: 'desc' },
      select: { close: true },
    });
    if (bar) closes.set(symbol, Number(bar.close));
  }
  return closes;
}

/**
 * Grade every past brief's positions against subsequent price action and roll
 * the results up overall and per screen. Positions are the actionable calls —
 * the names the system actually told Pete to hold — so those are what we score.
 */
export async function computeAttribution(): Promise<AttributionSummary> {
  const rows = await prisma.weeklyBrief.findMany({ orderBy: { asOf: 'asc' } });
  const briefs = rows.map((r) => r.payload as unknown as StoredBrief);

  const symbols = briefs.flatMap((b) => b.portfolio.positions.map((p) => p.symbol));
  const closes = await latestCloses(symbols);

  const graded = gradeBriefs(briefs, (symbol) => closes.get(symbol) ?? null);
  const asOf = briefs.at(-1)?.asOf ?? new Date().toISOString().slice(0, 10);
  return rollup(graded, briefs.length, asOf);
}
