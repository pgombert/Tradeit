/**
 * Stage 1 screen — breakout momentum.
 *
 * This is the system's primary single-stock hunt: names that are *moving now* —
 * a sharp recent thrust, still trading near their highs, outrunning the market.
 * Where the `momentum` screen rewards a slow, established, months-old uptrend
 * (which structurally favors big steady names and index ETFs), this one rewards
 * the fresh, punchy move in a nimble name — the kind a $100k book can ride and
 * institutions can't touch without moving the price.
 *
 * A qualifier is:
 *   - above its 50-day average (the short-term trend is up), and
 *   - up meaningfully over the last month (a real move, not a drift), and
 *   - within a short reach of its 6-month high (breaking out, not recovering), and
 *   - not already rolling over this week (we want continuation, not a fade).
 *
 * Screens never emit a short (docs/PLAN.md §2), so this is BULLISH-only. Null
 * discipline (repo rule 5): a missing indicator is not a zero — it disqualifies.
 */
import type { Indicators } from '../price-indicators.js';
import type { ScreenContext, ScreenFinding, Screen } from './types.js';

const BENCHMARK_LABEL = 'SPY';

/** Up at least this much over ~1 month to count as a real move. */
const MIN_RETURN_1M = 0.06;
/** Must sit within this fraction of its 6-month high — a breakout, not a bounce. */
const MAX_DRAWDOWN_FROM_HIGH = 0.08;
/** Reject a name already fading hard this week (a failed breakout). */
const MIN_RETURN_1W = -0.05;

interface Qualifier {
  symbol: string;
  exposure: string;
  ind: Indicators;
  composite: number;
  relStrength1m: number | null;
}

function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function qualifies(ind: Indicators): boolean {
  return (
    ind.above50dma === true &&
    ind.return1m !== null &&
    ind.return1m >= MIN_RETURN_1M &&
    ind.return1w !== null &&
    ind.return1w >= MIN_RETURN_1W &&
    ind.drawdownFromHigh !== null &&
    ind.drawdownFromHigh >= -MAX_DRAWDOWN_FROM_HIGH
  );
}

/**
 * Breakout strength = a weighted blend, favoring the recent thrust: the 1-month
 * move (double weight), this week's continuation, how tightly it sits under its
 * high (nearer = stronger), and its 1-month edge over the benchmark. Each term is
 * skipped when its input is null, never coerced to zero.
 */
function composite(ind: Indicators, relStrength1m: number | null): number | null {
  const terms: { value: number; weight: number }[] = [];
  if (ind.return1m !== null) terms.push({ value: ind.return1m, weight: 2 });
  if (ind.return1w !== null) terms.push({ value: ind.return1w, weight: 1 });
  if (relStrength1m !== null) terms.push({ value: relStrength1m, weight: 1 });
  // Proximity to high: drawdown is ≤ 0, so (1 + drawdown) → 1 at the high.
  if (ind.drawdownFromHigh !== null) terms.push({ value: 1 + ind.drawdownFromHigh, weight: 1 });
  if (terms.length === 0) return null;
  const wSum = terms.reduce((s, t) => s + t.weight, 0);
  return terms.reduce((s, t) => s + t.value * t.weight, 0) / wSum;
}

export const breakoutScreen: Screen = (ctx: ScreenContext): ScreenFinding[] => {
  const benchReturn1m = ctx.benchmark?.return1m ?? null;

  const qualifiers: Qualifier[] = [];
  for (const view of ctx.securities) {
    const ind = view.indicators;
    if (!qualifies(ind)) continue;
    const relStrength1m = benchReturn1m === null ? null : ind.return1m! - benchReturn1m;
    const comp = composite(ind, relStrength1m);
    if (comp === null) continue;
    qualifiers.push({ symbol: view.symbol, exposure: view.exposure, ind, composite: comp, relStrength1m });
  }

  if (qualifiers.length === 0) return [];

  // Min-max normalize composites to 0..1 (mirrors the momentum screen). One
  // qualifier, or an all-equal set, all score 1 — nothing to spread them over.
  const composites = qualifiers.map((q) => q.composite);
  const min = Math.min(...composites);
  const max = Math.max(...composites);
  const span = max - min;

  const findings: ScreenFinding[] = qualifiers.map((q) => {
    const score = span === 0 ? 1 : (q.composite - min) / span;
    let rationale = `Breakout: ${fmtPct(q.ind.return1m!)} over 1m, ${fmtPct(q.ind.drawdownFromHigh!)} from its 6-month high`;
    if (q.relStrength1m !== null) rationale += `, ${fmtPct(q.relStrength1m)} vs ${BENCHMARK_LABEL}`;
    return {
      symbol: q.symbol,
      exposure: q.exposure,
      direction: 'BULLISH',
      hit: {
        screen: 'breakout',
        score,
        direction: 'BULLISH',
        rationale,
        evidence: [`${q.symbol}:bars:${q.ind.asOf}`],
      },
    };
  });

  findings.sort((a, b) => b.hit.score - a.hit.score);
  return findings;
};
