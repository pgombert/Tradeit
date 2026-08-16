import type { EconSeriesDetail, EconSeriesSummary, YieldCurveSnapshot } from '@tradeit/shared';
import { fredSeriesById } from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error-handler.js';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Latest point plus the change over the preceding week. Values stay Decimal
 * through the arithmetic and become strings only at the API boundary.
 */
async function summarise(seriesId: string): Promise<EconSeriesSummary | null> {
  const series = await prisma.econSeries.findUnique({
    where: { seriesId },
    include: {
      points: { orderBy: { date: 'desc' }, take: 1 },
      _count: { select: { points: true } },
    },
  });

  if (!series) return null;

  const latest = series.points[0] ?? null;
  let weekChange: string | null = null;

  if (latest) {
    const weekAgo = new Date(latest.date);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const prior = await prisma.econPoint.findFirst({
      where: { seriesId, date: { lte: weekAgo } },
      orderBy: { date: 'desc' },
    });

    if (prior) weekChange = latest.value.sub(prior.value).toString();
  }

  return {
    seriesId: series.seriesId,
    title: series.title,
    role: series.role,
    units: series.units,
    latestValue: latest?.value.toString() ?? null,
    latestDate: latest ? isoDate(latest.date) : null,
    weekChange,
    pointCount: series._count.points,
  };
}

export async function listSeries(): Promise<EconSeriesSummary[]> {
  const rows = await prisma.econSeries.findMany({ select: { seriesId: true } });
  const summaries = await Promise.all(rows.map((r) => summarise(r.seriesId)));

  return summaries
    .filter((s): s is EconSeriesSummary => s !== null)
    .sort((a, b) => a.seriesId.localeCompare(b.seriesId));
}

export async function getSeries(seriesId: string, days: number): Promise<EconSeriesDetail> {
  if (!fredSeriesById(seriesId)) {
    throw new AppError(404, `Unknown series ${seriesId}`);
  }

  const summary = await summarise(seriesId);
  if (!summary) {
    throw new AppError(404, `No data collected yet for ${seriesId}`);
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const points = await prisma.econPoint.findMany({
    where: { seriesId, date: { gte: since } },
    orderBy: { date: 'asc' },
  });

  return {
    ...summary,
    points: points.map((p) => ({ date: isoDate(p.date), value: p.value.toString() })),
  };
}

/** The 2s10s snapshot the dashboard header reads. */
export async function getYieldCurve(): Promise<YieldCurveSnapshot> {
  const [two, ten, spread] = await Promise.all([
    prisma.econPoint.findFirst({ where: { seriesId: 'DGS2' }, orderBy: { date: 'desc' } }),
    prisma.econPoint.findFirst({ where: { seriesId: 'DGS10' }, orderBy: { date: 'desc' } }),
    prisma.econPoint.findFirst({ where: { seriesId: 'T10Y2Y' }, orderBy: { date: 'desc' } }),
  ]);

  // Prefer FRED's own spread series; fall back to deriving it only when both
  // legs are present and share a date.
  let spreadValue: string | null = spread?.value.toString() ?? null;
  if (!spreadValue && two && ten && two.date.getTime() === ten.date.getTime()) {
    spreadValue = ten.value.sub(two.value).toString();
  }

  const asOf = ten?.date ?? two?.date ?? spread?.date ?? null;

  return {
    asOf: asOf ? isoDate(asOf) : null,
    twoYear: two?.value.toString() ?? null,
    tenYear: ten?.value.toString() ?? null,
    spread: spreadValue,
    inverted: spreadValue !== null && Number(spreadValue) < 0,
  };
}
