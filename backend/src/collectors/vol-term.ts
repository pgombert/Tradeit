/**
 * Pure computation for the VIX term-structure signal. No Prisma queries and no
 * config, so it tests with hand-built Decimals and no database.
 *
 * The term structure is the front-month VIX (30-day) against the 3-month VIX.
 * In a calm market longer-dated volatility trades *above* near-dated — contango,
 * ratio below 1 — which is a risk-on tell. When near-term fear spikes above
 * longer-term (backwardation, ratio above 1) the market is under stress. The
 * score follows the Stage 0 scorecard convention in docs/PLAN.md §5: positive is
 * risk-on, and it runs -2 (acute stress) to +2 (deep calm).
 *
 * All arithmetic stays in Decimal — the ratio is a number the regime call acts
 * on, so it never touches JavaScript floating point (CLAUDE.md rule 2).
 */
import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;

export type VolTermSignal = 'CONTANGO' | 'FLAT' | 'BACKWARDATION';

export interface VolTermReading {
  /** Front-month VIX close, as a string. */
  front: string;
  /** 3-month VIX close, as a string. */
  back: string;
  /** front / back, to four places. Below 1 is contango, above 1 backwardation. */
  ratio: string;
  signal: VolTermSignal;
  /** -2 (acute stress) to +2 (deep calm), matching the Stage 0 scorecard. */
  score: number;
}

const D = (s: string): Decimal => new Prisma.Decimal(s);

/**
 * Classify the term structure from a front (30-day) and back (3-month) close.
 * Returns null when the back month is non-positive — a bad point can't form a
 * ratio, and a fabricated one would poison the regime call.
 */
export function classifyVolTerm(front: Decimal, back: Decimal): VolTermReading | null {
  if (back.lte(0)) return null;

  const ratio = front.div(back);

  let signal: VolTermSignal;
  let score: number;

  if (ratio.lt(D('0.92'))) {
    signal = 'CONTANGO';
    score = 2;
  } else if (ratio.lt(D('0.98'))) {
    signal = 'CONTANGO';
    score = 1;
  } else if (ratio.lt(D('1.02'))) {
    signal = 'FLAT';
    score = 0;
  } else if (ratio.lt(D('1.08'))) {
    signal = 'BACKWARDATION';
    score = -1;
  } else {
    signal = 'BACKWARDATION';
    score = -2;
  }

  return {
    front: front.toString(),
    back: back.toString(),
    ratio: ratio.toDecimalPlaces(4).toString(),
    signal,
    score,
  };
}
