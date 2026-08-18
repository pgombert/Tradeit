/**
 * Pure price-derived indicators for the Stage 1 screens. A daily bar series in,
 * a set of scalar readings out — no Decimal, no DB, no config — so every screen
 * computes the same metrics the same way and they can be tested against fixtures.
 *
 * Prices arrive here as `number` (converted from Decimal "at the edge" by the
 * service, exactly as `regime.service.ts` does for the trend booleans). These
 * are analytic readings that feed scores and rankings, never traded money, so
 * `number` is the right type here — sizing math stays Decimal downstream.
 */

/** One daily bar, prices already converted to number at the service edge. */
export interface Bar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The full indicator reading for one security. Any field is `null` when there
 * are too few bars to compute it honestly — never a coerced zero. */
export interface Indicators {
  asOf: string | null;
  close: number | null;
  /** Trailing simple returns over N trading days. */
  return1w: number | null; // ~5 bars
  return1m: number | null; // ~21 bars
  return3m: number | null; // ~63 bars
  return6m: number | null; // ~126 bars
  sma50: number | null;
  sma200: number | null;
  above50dma: boolean | null;
  above200dma: boolean | null;
  /** Wilder RSI(14), 0..100. */
  rsi14: number | null;
  /** Average True Range(14), in price units, and as a % of close. */
  atr14: number | null;
  atrPct: number | null;
  /** Distance below the trailing-window high, ≤ 0 (0 = at the high). */
  drawdownFromHigh: number | null;
  /** Trailing 20-day average dollar volume (close × volume). */
  avgDollarVolume: number | null;
}

const TRADING_DAYS = { WEEK: 5, MONTH: 21, QUARTER: 63, HALF: 126 } as const;
const HIGH_WINDOW = 126; // ~6 months, the drawdown-from-high reference

/** Simple return from `lookback` bars ago to the last bar, or null if short. */
export function simpleReturn(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback || lookback <= 0) return null;
  const last = closes[closes.length - 1]!;
  const prior = closes[closes.length - 1 - lookback]!;
  if (prior === 0) return null;
  return last / prior - 1;
}

/** Simple moving average of the last `n` values, or null if fewer than `n`. */
export function sma(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i]!;
  return sum / n;
}

/**
 * Wilder's RSI over `period` (default 14). Needs `period + 1` closes. Returns
 * 0..100, or null when short. 100 when there are no down moves in the window.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // Seed with the first `period` deltas.
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Average True Range over `period` (default 14), in price units. */
export function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i]!;
    const prevClose = bars[i - 1]!.close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

/** Distance below the trailing-`window` high as a non-positive fraction. */
export function drawdownFromHigh(closes: number[], window: number): number | null {
  if (closes.length === 0) return null;
  const slice = closes.slice(Math.max(0, closes.length - window));
  const high = Math.max(...slice);
  const last = closes[closes.length - 1]!;
  if (high === 0) return null;
  return last / high - 1;
}

/**
 * Relative strength: the screened series' trailing return minus the benchmark's
 * over the same lookback. Positive = outperforming. Null if either is short.
 */
export function relativeStrength(
  closes: number[],
  benchCloses: number[],
  lookback: number,
): number | null {
  const a = simpleReturn(closes, lookback);
  const b = simpleReturn(benchCloses, lookback);
  if (a === null || b === null) return null;
  return a - b;
}

/** Trailing average dollar volume over the last `n` bars (close × volume). */
export function avgDollarVolume(bars: Bar[], n = 20): number | null {
  if (bars.length < 1) return null;
  const slice = bars.slice(Math.max(0, bars.length - n));
  const sum = slice.reduce((acc, b) => acc + b.close * b.volume, 0);
  return sum / slice.length;
}

/**
 * Compute the whole indicator set for one security from its ascending daily
 * bars. Each field degrades to null independently, so a short history still
 * yields the metrics it can support.
 */
export function computeIndicators(bars: Bar[]): Indicators {
  if (bars.length === 0) {
    return {
      asOf: null, close: null, return1w: null, return1m: null, return3m: null,
      return6m: null, sma50: null, sma200: null, above50dma: null, above200dma: null,
      rsi14: null, atr14: null, atrPct: null, drawdownFromHigh: null, avgDollarVolume: null,
    };
  }
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1]!;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atr14 = atr(bars, 14);
  return {
    asOf: last.date,
    close: last.close,
    return1w: simpleReturn(closes, TRADING_DAYS.WEEK),
    return1m: simpleReturn(closes, TRADING_DAYS.MONTH),
    return3m: simpleReturn(closes, TRADING_DAYS.QUARTER),
    return6m: simpleReturn(closes, TRADING_DAYS.HALF),
    sma50,
    sma200,
    above50dma: sma50 === null ? null : last.close > sma50,
    above200dma: sma200 === null ? null : last.close > sma200,
    rsi14: rsi(closes, 14),
    atr14,
    atrPct: atr14 === null || last.close === 0 ? null : atr14 / last.close,
    drawdownFromHigh: drawdownFromHigh(closes, HIGH_WINDOW),
    avgDollarVolume: avgDollarVolume(bars, 20),
  };
}
