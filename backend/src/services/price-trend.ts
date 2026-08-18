/**
 * Price-trend gate for Stage 0. Whether SPY sits above its 50- and 200-day
 * moving averages is the trend input the regime classifier needs before it can
 * confirm a Risk-On Trend regime and let leverage back on (docs/PLAN.md §5).
 *
 * Pure and tested: the closes are read from price_bars in regime.service and
 * converted to numbers at that edge — the same scorecard-only convention the
 * rest of the regime inputs follow (nothing here is money that gets traded on).
 */

export interface PriceTrend {
  /** SPY's latest close above its 50-day average; null if too few bars. */
  above50dma: boolean | null;
  /** SPY's latest close above its 200-day average; null if too few bars. */
  above200dma: boolean | null;
}

/** Simple moving average of the last `n` values, or null with too few. */
function sma(closesAsc: number[], n: number): number | null {
  if (closesAsc.length < n) return null;
  const window = closesAsc.slice(-n);
  return window.reduce((sum, v) => sum + v, 0) / n;
}

/**
 * @param closesAsc daily closes oldest-first, the most recent last.
 * Returns nulls when there is not yet enough history, which keeps the regime
 * capped at Chop rather than asserting a trend it cannot see.
 */
export function priceTrend(closesAsc: number[]): PriceTrend {
  const last = closesAsc.at(-1) ?? null;
  const sma50 = sma(closesAsc, 50);
  const sma200 = sma(closesAsc, 200);
  return {
    above50dma: last !== null && sma50 !== null ? last > sma50 : null,
    above200dma: last !== null && sma200 !== null ? last > sma200 : null,
  };
}
