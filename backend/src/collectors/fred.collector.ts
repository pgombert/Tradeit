import { FRED_SERIES, type FredSeriesDef } from '@tradeit/shared';
import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';
import {
  isoDate,
  startDateFor,
  usableObservations,
  type FredObservation,
} from './fred.parse.js';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/** How far back to reach the first time we see a series. */
const INITIAL_LOOKBACK_YEARS = 5;

/**
 * FRED revises recent points, so on an incremental run we re-request a window
 * behind the last date we hold rather than starting exactly at it.
 */
const REVISION_WINDOW_DAYS = 45;

const UPSERT_CHUNK = 500;

interface FredResponse {
  observations?: FredObservation[];
}

export interface FredCollectionResult {
  seriesId: string;
  pointsWritten: number;
  latestDate: string | null;
}

async function fetchSeries(seriesId: string, observationStart: string): Promise<FredObservation[]> {
  if (!env.FRED_ID) {
    throw new Error('FRED_ID is not set — get a free key at https://fredaccount.stlouisfed.org/apikeys');
  }

  const url = new URL(FRED_BASE);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', env.FRED_ID);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', observationStart);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FRED ${seriesId} returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as FredResponse;
  return usableObservations(json.observations ?? []);
}

async function collectOne(def: FredSeriesDef): Promise<FredCollectionResult> {
  const existing = await prisma.econSeries.findUnique({
    where: { seriesId: def.id },
    select: { lastObservedAt: true },
  });

  const observations = await fetchSeries(
    def.id,
    startDateFor(
      existing?.lastObservedAt ?? null,
      new Date(),
      INITIAL_LOOKBACK_YEARS,
      REVISION_WINDOW_DAYS,
    ),
  );

  await prisma.econSeries.upsert({
    where: { seriesId: def.id },
    create: { seriesId: def.id, title: def.title, role: def.role, units: def.units },
    update: { title: def.title, role: def.role, units: def.units },
  });

  // Chunked upserts rather than createMany, so a revised value overwrites the
  // one we already hold and a crashed run re-runs to the same end state.
  for (let i = 0; i < observations.length; i += UPSERT_CHUNK) {
    const chunk = observations.slice(i, i + UPSERT_CHUNK);
    await prisma.$transaction(
      chunk.map((o) =>
        prisma.econPoint.upsert({
          where: { seriesId_date: { seriesId: def.id, date: new Date(o.date) } },
          create: { seriesId: def.id, date: new Date(o.date), value: o.value },
          update: { value: o.value },
        }),
      ),
    );
  }

  const latest = observations.at(-1) ?? null;

  if (latest) {
    const observedAt = new Date(latest.date);

    await prisma.$transaction([
      prisma.econSeries.update({
        where: { seriesId: def.id },
        data: { lastObservedAt: observedAt },
      }),
      // One provenance record per release, not per point — a dossier cites the
      // series state as of a date, and this is the row it cites.
      prisma.observation.upsert({
        where: {
          source_sourceRef: {
            source: 'FRED',
            sourceRef: `${def.id}:${latest.date}`,
          },
        },
        create: {
          source: 'FRED',
          sourceRef: `${def.id}:${latest.date}`,
          scope: 'MARKET',
          kind: 'ECON_RELEASE',
          observedAt,
          payload: { seriesId: def.id, title: def.title, role: def.role, value: latest.value, units: def.units },
          url: `https://fred.stlouisfed.org/series/${def.id}`,
        },
        update: {
          payload: { seriesId: def.id, title: def.title, role: def.role, value: latest.value, units: def.units },
        },
      }),
    ]);
  }

  return {
    seriesId: def.id,
    pointsWritten: observations.length,
    latestDate: latest?.date ?? null,
  };
}

/**
 * Pulls every series in FRED_SERIES. Idempotent: re-running produces the same
 * end state, so a crash mid-run is recovered by running it again.
 */
export async function collectFred(): Promise<FredCollectionResult[]> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'fred', status: 'RUNNING' },
  });

  const results: FredCollectionResult[] = [];

  try {
    for (const def of FRED_SERIES) {
      const result = await collectOne(def);
      results.push(result);
      console.log(
        `[fred] ${def.id.padEnd(14)} ${String(result.pointsWritten).padStart(5)} points, latest ${result.latestDate ?? 'none'}`,
      );
    }

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        recordsWritten: results.reduce((sum, r) => sum + r.pointsWritten, 0),
      },
    });

    return results;
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        recordsWritten: results.reduce((sum, r) => sum + r.pointsWritten, 0),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
