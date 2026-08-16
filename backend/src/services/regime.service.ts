import { classifyRegime, type RegimeInputs, type RegimeVerdict } from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';

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

export async function getRegime(): Promise<RegimeResponse> {
  const [vix, hy, nfci, curve, hyChange] = await Promise.all([
    latest('VIXCLS'),
    latest('BAMLH0A0HYM2'),
    latest('NFCI'),
    latest('T10Y2Y'),
    changeOverDays('BAMLH0A0HYM2', 30),
  ]);

  const inputs: RegimeInputs = {
    vix: vix?.value ?? null,
    hySpread: hy?.value ?? null,
    hySpreadMonthChange: hyChange,
    nfci: nfci?.value ?? null,
    curve: curve?.value ?? null,

    // Filled in once Schwab price history lands in Phase 1. Until then the
    // classifier holds the verdict at Chop and leverage stays off.
    spyAbove50dma: null,
    spyAbove200dma: null,
  };

  const dates = [vix?.date, hy?.date, nfci?.date, curve?.date].filter(
    (d): d is Date => d instanceof Date,
  );
  const asOf = dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10)
    : null;

  return { ...classifyRegime(inputs), asOf };
}
