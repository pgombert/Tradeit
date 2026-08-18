/**
 * Stage 1 screen — momentum.
 *
 * Surfaces securities in a strong, *established* uptrend: price above both its
 * 50- and 200-day averages with a positive 3-month return. This is a pure signal
 * — it ranks trend strength and says nothing about whether the regime lets us act
 * on it. Regime and leverage gating live in portfolio construction downstream, so
 * this screen deliberately does not read `ctx.regime` to suppress anything.
 *
 * Screens never emit a short (docs/PLAN.md §2), so momentum is BULLISH-only.
 *
 * Null discipline (repo rule 5): a missing indicator is `null`, never a coerced
 * zero. A security with `return3m === null` is not a qualifier — it is not "flat".
 */
import type { Indicators } from '../price-indicators.js';
import type { ScreenContext, ScreenFinding, SecurityView, Screen } from './types.js';

/** Label for the benchmark in rationale text — the context's benchmark is SPY. */
const BENCHMARK_LABEL = 'SPY';

/** A qualifier plus its raw composite, carried until we can min-max normalize. */
interface Qualifier {
  view: SecurityView;
  ind: Indicators;
  composite: number;
  /** Relative strength vs benchmark over 3m, or null when the benchmark is short. */
  relStrength: number | null;
}

/** Format a fraction (0.124) as a signed percentage to one decimal ("+12.4%"). */
function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** True only when the trend is established and 3m return is genuinely positive. */
function qualifies(ind: Indicators): boolean {
  return (
    ind.above200dma === true &&
    ind.above50dma === true &&
    ind.return3m !== null &&
    ind.return3m > 0
  );
}

/**
 * Momentum composite = the average of the available terms among 3m return, 6m
 * return, and relative strength vs the benchmark. Each term is skipped when its
 * input is null (never coerced to 0); returns null if no term is available at all.
 */
function composite(ind: Indicators, relStrength: number | null): number | null {
  const terms: number[] = [];
  if (ind.return3m !== null) terms.push(ind.return3m);
  if (ind.return6m !== null) terms.push(ind.return6m);
  if (relStrength !== null) terms.push(relStrength);
  if (terms.length === 0) return null;
  return terms.reduce((a, b) => a + b, 0) / terms.length;
}

export const momentumScreen: Screen = (ctx: ScreenContext): ScreenFinding[] => {
  const benchmarkReturn3m = ctx.benchmark?.return3m ?? null;

  // Step 1–2: keep only established uptrends that yield a composite.
  const qualifiers: Qualifier[] = [];
  for (const view of ctx.securities) {
    const ind = view.indicators;
    if (!qualifies(ind)) continue;

    // return3m is non-null here (guaranteed by qualifies), so relative strength
    // is available exactly when the benchmark's 3m return is.
    const relStrength =
      benchmarkReturn3m === null ? null : ind.return3m! - benchmarkReturn3m;

    const comp = composite(ind, relStrength);
    if (comp === null) continue; // no usable terms — drop it.

    qualifiers.push({ view, ind, composite: comp, relStrength });
  }

  if (qualifiers.length === 0) return [];

  // Step 3: min-max normalize composites to 0..1. One qualifier, or a set whose
  // composites are all equal, all score 1 (there is nothing to spread them over).
  const composites = qualifiers.map((q) => q.composite);
  const min = Math.min(...composites);
  const max = Math.max(...composites);
  const span = max - min;

  // Step 4: build a finding per qualifier.
  const findings: ScreenFinding[] = qualifiers.map((q) => {
    const score = span === 0 ? 1 : (q.composite - min) / span;

    let rationale = `Established uptrend: ${fmtPct(q.ind.return3m!)} over 3m, above 50- and 200-day averages`;
    if (q.relStrength !== null) {
      rationale += `, ${fmtPct(q.relStrength)} vs ${BENCHMARK_LABEL}`;
    }

    return {
      symbol: q.view.symbol,
      exposure: q.view.exposure,
      direction: 'BULLISH',
      hit: {
        screen: 'momentum',
        score,
        direction: 'BULLISH',
        rationale,
        evidence: [`${q.view.symbol}:bars:${q.ind.asOf}`],
      },
    };
  });

  // Step 5: strongest first.
  findings.sort((a, b) => b.hit.score - a.hit.score);
  return findings;
};
