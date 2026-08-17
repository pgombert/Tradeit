/**
 * Derived signals — computed in-house from data other collectors already hold,
 * never fetched (docs/PLAN.md §5). The first is the VIX term structure. This
 * collector reads the volatility series FRED brought in and writes one signal
 * into the Observation bus, so it must run *after* the FRED collector.
 */
import { prisma } from '../lib/prisma.js';
import { classifyVolTerm } from './vol-term.js';

const FRONT = 'VIXCLS';
const BACK = 'VXVCLS';

/** How many recent back-month points to scan for a date the front also has. */
const PAIR_LOOKBACK = 20;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DerivedCollectionResult {
  recordsWritten: number;
}

/**
 * The most recent date on which both volatility series have a point. The two
 * series can publish a day apart, so pairing them on a shared date keeps the
 * ratio honest rather than mixing a stale leg with a fresh one.
 */
async function latestCommonPair() {
  const backs = await prisma.econPoint.findMany({
    where: { seriesId: BACK },
    orderBy: { date: 'desc' },
    take: PAIR_LOOKBACK,
  });

  for (const back of backs) {
    const front = await prisma.econPoint.findUnique({
      where: { seriesId_date: { seriesId: FRONT, date: back.date } },
    });
    if (front) return { date: back.date, front: front.value, back: back.value };
  }

  return null;
}

/**
 * Idempotent: upserts one observation keyed on the date it describes, so a
 * re-run overwrites in place and reaches the same end state as a clean run.
 */
export async function collectDerived(): Promise<DerivedCollectionResult> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'derived', status: 'RUNNING' },
  });

  try {
    let recordsWritten = 0;
    const pair = await latestCommonPair();

    if (!pair) {
      console.log('[derived] no VIXCLS/VXVCLS pair yet — run the fred collector first');
    } else {
      const reading = classifyVolTerm(pair.front, pair.back);

      if (reading) {
        const date = isoDate(pair.date);
        const sourceRef = `VIX_TERM:${date}`;
        const payload = { ...reading, frontSeries: FRONT, backSeries: BACK, date };

        await prisma.observation.upsert({
          where: { source_sourceRef: { source: 'DERIVED', sourceRef } },
          create: {
            source: 'DERIVED',
            sourceRef,
            scope: 'MARKET',
            kind: 'SENTIMENT_READING',
            observedAt: pair.date,
            payload,
          },
          update: { payload },
        });

        recordsWritten = 1;
        console.log(
          `[derived] VIX term ${reading.signal.padEnd(13)} ratio ${reading.ratio} (score ${reading.score}) as of ${date}`,
        );
      }
    }

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), recordsWritten },
    });

    return { recordsWritten };
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
