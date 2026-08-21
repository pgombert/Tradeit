/**
 * The morning check's brain: turn one holding's current signals into a
 * Hold / Trim / Exit call, using the same momentum discipline the weekly book is
 * built on. Pure and deterministic — no prices fetched, no dates-from-now — so
 * every rule is unit-tested with worked examples (CLAUDE.md: anything computing a
 * number Pete acts on gets a test).
 *
 * This surfaces what the mechanical rules say; it never places an order.
 */

export type HoldingAction = 'HOLD' | 'TRIM' | 'EXIT';

/** How far a name can fall off its recent high before the trailing stop trips:
 * a volatility buffer of 2.5× its daily range, floored so a very calm name still
 * gets room to breathe. Mirrors the weekly portfolio's STOP_ATR_MULT. */
const STOP_ATR_MULT = 2.5;
const MIN_STOP_DISTANCE = 0.08;

/** The current picture of one holding — everything the rules read. */
export interface HoldingSignals {
  symbol: string;
  /** Latest close; null when we have no recent price (then we can't assess). */
  price: number | null;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  above50dma: boolean | null;
  above200dma: boolean | null;
  /** Average true range as a fraction of price (daily volatility). */
  atrPct: number | null;
  /** Distance below the recent high, ≤ 0 (e.g. -0.12 = 12% off the high). */
  drawdownFromHigh: number | null;
  /** Reports earnings inside the holding window. */
  earningsWithinHold: boolean;
  /** The market regime is CRISIS. */
  regimeCrisis: boolean;
  /** Return since cost basis, or null when cost is unknown. */
  gainFromCost: number | null;
  /** Share of the whole portfolio, 0..1. */
  weight: number;
}

export interface HoldingVerdict {
  symbol: string;
  action: HoldingAction;
  /** Plain-English reasons, most important first. */
  reasons: string[];
  /** The trailing-stop buffer used (fraction), for display. */
  stopDistance: number | null;
  /** How much further it can fall before the stop trips (fraction); ≤0 = already through. */
  roomToStop: number | null;
  /** True when we lacked the data to judge (shown as HOLD but flagged). */
  insufficientData: boolean;
}

function pct(x: number, decimals = 1): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(decimals)}%`;
}

/** The trailing-stop buffer for a name given its volatility. */
export function stopDistanceFor(atrPct: number | null): number {
  if (atrPct === null) return MIN_STOP_DISTANCE;
  return Math.max(MIN_STOP_DISTANCE, STOP_ATR_MULT * atrPct);
}

/**
 * Assess one holding. EXIT when the move has broken (through its trailing stop,
 * momentum flipped hard, or a market crisis); TRIM for a caution (earnings in the
 * window, or momentum fading); HOLD when the trend is intact. When we can't see
 * the price, we don't guess — it's HOLD, flagged as unassessed.
 */
export function assessHolding(s: HoldingSignals): HoldingVerdict {
  if (s.price === null || s.drawdownFromHigh === null) {
    return {
      symbol: s.symbol,
      action: 'HOLD',
      reasons: ['No recent price data — left as is, not assessed this morning.'],
      stopDistance: null,
      roomToStop: null,
      insufficientData: true,
    };
  }

  const stopDistance = stopDistanceFor(s.atrPct);
  const dropFromHigh = -s.drawdownFromHigh; // positive = how far below the high
  const roomToStop = stopDistance - dropFromHigh; // ≤ 0 means the stop is through

  const exitReasons: string[] = [];
  const trimReasons: string[] = [];

  // ---- EXIT triggers ----
  if (s.regimeCrisis) {
    exitReasons.push('Market regime is in crisis — the momentum book goes to cash.');
  }
  if (roomToStop <= 0) {
    exitReasons.push(
      `Broke its trailing stop — down ${pct(-dropFromHigh)} from its recent high, past the ${pct(stopDistance, 0)} buffer.`,
    );
  }
  if (s.above50dma === false && s.return1m !== null && s.return1m < -0.05) {
    exitReasons.push(
      `Momentum has broken — below its 50-day average and ${pct(s.return1m)} over the past month.`,
    );
  }

  // ---- TRIM triggers ----
  if (s.earningsWithinHold) {
    trimReasons.push('Reports earnings inside the holding window — trim before a coin-flip event.');
  }
  const fadingRollover = s.above50dma === false && s.above200dma === true;
  const fadingPullback =
    s.above50dma === true && s.return1w !== null && s.return1w <= -0.04 && s.return1m !== null && s.return1m > 0;
  if (fadingRollover) {
    trimReasons.push('Momentum fading — dropped below its 50-day average, longer trend still intact.');
  } else if (fadingPullback) {
    trimReasons.push(`Pulling back — ${pct(s.return1w ?? 0)} on the week while still up on the month.`);
  }

  let action: HoldingAction = 'HOLD';
  let reasons: string[];
  if (exitReasons.length > 0) {
    action = 'EXIT';
    reasons = exitReasons;
  } else if (trimReasons.length > 0) {
    action = 'TRIM';
    reasons = trimReasons;
  } else {
    const bits: string[] = [];
    if (s.above50dma && s.above200dma) bits.push('above its 50- and 200-day averages');
    else if (s.above50dma) bits.push('above its 50-day average');
    if (s.return1m !== null) bits.push(`${pct(s.return1m)} on the month`);
    reasons = [`Trend intact${bits.length ? ` — ${bits.join(', ')}` : ''}. Let it run.`];
  }

  return { symbol: s.symbol, action, reasons, stopDistance, roomToStop, insufficientData: false };
}

/** Order verdicts so the ones needing attention come first. */
export function byUrgency(a: HoldingVerdict, b: HoldingVerdict): number {
  const rank: Record<HoldingAction, number> = { EXIT: 0, TRIM: 1, HOLD: 2 };
  return rank[a.action] - rank[b.action];
}
