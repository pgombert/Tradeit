import { classifyRegime, type RegimeInputs, type RegimeVerdict } from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { priceTrend, type PriceTrend } from './price-trend.js';

/**
 * Assembles the Stage 0 inputs from whatever the collectors have actually
 * stored, then classifies. A series we hold no data for arrives as null and the
 * classifier scores only what it has — see docs/PLAN.md §5.
 */

async function latest(seriesId: string): Promise<{ date: Date; value: number } | null> {
  const point = await prisma.econPoint.findFirst({
    where: { seriesId },
    orderBy: { date: 'desc' },
  });

  // Decimal to number happens here, at the edge, for the scorecard only. Nothing
  // downstream of this touches money.
  return point ? { date: point.date, value: Number(point.value) } : null;
}

async function changeOverDays(seriesId: string, days: number): Promise<number | null> {
  const current = await prisma.econPoint.findFirst({
    where: { seriesId },
    orderBy: { date: 'desc' },
  });
  if (!current) return null;

  const then = new Date(current.date);
  then.setDate(then.getDate() - days);

  const prior = await prisma.econPoint.findFirst({
    where: { seriesId, date: { lte: then } },
    orderBy: { date: 'desc' },
  });
  if (!prior) return null;

  return Number(current.value.sub(prior.value));
}

export interface RegimeResponse extends RegimeVerdict {
  asOf: string | null;
}

/**
 * SPY's trend from the price bars the Schwab collector stores. Closes convert to
 * number here, at the edge, for the scorecard only — the same convention the
 * econ inputs above follow. Returns nulls (and no date) until there is enough
 * history, which leaves the regime capped at Chop.
 */
async function spyTrend(): Promise<{ trend: PriceTrend; latestDate: Date | null }> {
  const spy = await prisma.security.findUnique({
    where: { symbol: 'SPY' },
    select: { id: true },
  });
  if (!spy) return { trend: { above50dma: null, above200dma: null }, latestDate: null };

  const bars = await prisma.priceBar.findMany({
    where: { securityId: spy.id },
    orderBy: { date: 'desc' },
    take: 200,
    select: { date: true, close: true },
  });

  const ascending = [...bars].reverse();
  const closesAsc = ascending.map((b) => Number(b.close));
  return { trend: priceTrend(closesAsc), latestDate: ascending.at(-1)?.date ?? null };
}

export async function getRegime(): Promise<RegimeResponse> {
  const [vix, hy, nfci, curve, hyChange, spy] = await Promise.all([
    latest('VIXCLS'),
    latest('BAMLH0A0HYM2'),
    latest('NFCI'),
    latest('T10Y2Y'),
    changeOverDays('BAMLH0A0HYM2', 30),
    spyTrend(),
  ]);

  const inputs: RegimeInputs = {
    vix: vix?.value ?? null,
    hySpread: hy?.value ?? null,
    hySpreadMonthChange: hyChange,
    nfci: nfci?.value ?? null,
    curve: curve?.value ?? null,

    // SPY vs its 50- and 200-day averages, from the Schwab price bars. Once these
    // are present the classifier can confirm a trend and let leverage back on.
    spyAbove50dma: spy.trend.above50dma,
    spyAbove200dma: spy.trend.above200dma,
  };

  const dates = [vix?.date, hy?.date, nfci?.date, curve?.date, spy.latestDate].filter(
    (d): d is Date => d instanceof Date,
  );
  const asOf = dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10)
    : null;

  return { ...classifyRegime(inputs), asOf };
}
