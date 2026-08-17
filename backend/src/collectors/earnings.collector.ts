import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';
import {
  earningsRef,
  earningsWindow,
  usableEarnings,
  type EarningsEvent,
  type RawEarnings,
} from './earnings.parse.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1/calendar/earnings';

/**
 * How far ahead to pull. A two-week look-ahead covers the coming week's holds
 * plus the events that land just after, without dragging in the whole quarter.
 */
const DAYS_AHEAD = 14;

const UPSERT_CHUNK = 500;

interface FinnhubResponse {
  earningsCalendar?: RawEarnings[];
}

export interface EarningsCollectionResult {
  eventsWritten: number;
  from: string;
  to: string;
}

async function fetchWindow(from: string, to: string): Promise<EarningsEvent[]> {
  if (!env.FINHUB_APIKEY) {
    throw new Error('FINHUB_APIKEY is not set — get a free key at https://finnhub.io/register');
  }

  const url = new URL(FINNHUB_BASE);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('token', env.FINHUB_APIKEY);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Finnhub earnings returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as FinnhubResponse;
  return usableEarnings(json.earningsCalendar ?? []);
}

/**
 * Pulls the upcoming earnings calendar into the Observation bus. Idempotent:
 * upserts on (FINNHUB, symbol:date), so a re-run overwrites revised estimates
 * and fills in actuals once a company has reported, reaching the same end state
 * as a clean run.
 */
export async function collectEarnings(): Promise<EarningsCollectionResult> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'earnings', status: 'RUNNING' },
  });

  try {
    const { from, to } = earningsWindow(new Date(), DAYS_AHEAD);
    const events = await fetchWindow(from, to);

    for (let i = 0; i < events.length; i += UPSERT_CHUNK) {
      const chunk = events.slice(i, i + UPSERT_CHUNK);
      await prisma.$transaction(
        chunk.map((e) => {
          const sourceRef = earningsRef(e);
          const payload = {
            symbol: e.symbol,
            date: e.date,
            hour: e.hour,
            quarter: e.quarter,
            year: e.year,
            epsEstimate: e.epsEstimate,
            epsActual: e.epsActual,
            revenueEstimate: e.revenueEstimate,
            revenueActual: e.revenueActual,
          };

          return prisma.observation.upsert({
            where: { source_sourceRef: { source: 'FINNHUB', sourceRef } },
            create: {
              source: 'FINNHUB',
              sourceRef,
              scope: e.symbol,
              kind: 'EARNINGS_EVENT',
              // The event date is what a dossier's "catalysts in the window"
              // query filters on, so it is the observedAt.
              observedAt: new Date(e.date),
              payload,
            },
            update: { payload },
          });
        }),
      );
    }

    console.log(`[earnings] ${String(events.length).padStart(5)} events, ${from} to ${to}`);

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), recordsWritten: events.length },
    });

    return { eventsWritten: events.length, from, to };
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
