/**
 * Stage 1 screen — sector rotation.
 *
 * Ranks the *sector* ETFs by relative strength against the market (SPY) and
 * surfaces the two ends of the tape: leaders to lean into (BULLISH) and laggards
 * to lean against (BEARISH). Relative strength is the sector's trailing return
 * minus the benchmark's over the same horizon — positive means it is beating the
 * market, negative means it is trailing it.
 *
 * Two account constraints shape what this screen is allowed to emit:
 *   - It never emits a short. A bearish view is only surfaced when an inverse
 *     product exists (`hasInverse`), because this cash IRA cannot short and an
 *     unexpressible view is noise, not a signal (docs/PLAN.md §2). Laggards with
 *     no inverse are silently skipped.
 *   - It does not read `ctx.regime` to suppress anything — regime and leverage
 *     gating are a downstream (portfolio-construction) concern, exactly as in the
 *     momentum screen.
 *
 * Null discipline (repo rule 5): a missing return is `null`, never a coerced
 * zero. A sector whose relative strength cannot be computed on either horizon is
 * dropped, not treated as flat.
 */
import type { Indicators } from '../price-indicators.js';
import type { ScreenContext, ScreenFinding, SecurityView, Screen } from './types.js';
import type { Direction } from '../instrument-selection.js';

/** Label for the benchmark in rationale text — the context's benchmark is SPY. */
const BENCHMARK_LABEL = 'SPY';

/** A sector with its computed relative strength and the horizon it was read on. */
interface RankedSector {
  view: SecurityView;
  ind: Indicators;
  /** Sector return minus benchmark return over `horizon`. Positive = leading. */
  rs: number;
  /** Which horizon the relative strength was measured over. */
  horizon: '3m' | '1m';
}

/** A sector we will emit, tagged with the direction and its |rs| magnitude. */
interface Emitted {
  sector: RankedSector;
  direction: Direction;
  /** |rs| — the quantity we min-max normalize into a score. */
  magnitude: number;
}

/** Format a fraction (0.062) as a signed percentage to one decimal ("+6.2%"). */
function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Relative strength of a sector vs the benchmark. Prefers the 3-month horizon;
 * falls back to 1-month when either side is short on 3m. Returns null when
 * neither horizon can be computed for both the sector and the benchmark.
 */
function relativeStrength(
  ind: Indicators,
  bench: Indicators,
): { rs: number; horizon: '3m' | '1m' } | null {
  if (ind.return3m !== null && bench.return3m !== null) {
    return { rs: ind.return3m - bench.return3m, horizon: '3m' };
  }
  if (ind.return1m !== null && bench.return1m !== null) {
    return { rs: ind.return1m - bench.return1m, horizon: '1m' };
  }
  return null;
}

export const sectorRotationScreen: Screen = (ctx: ScreenContext): ScreenFinding[] => {
  const bench = ctx.benchmark;
  if (!bench) return []; // no market to measure against — nothing to say.

  // Step 1: rank every sector ETF by relative strength vs the benchmark.
  const ranked: RankedSector[] = [];
  for (const view of ctx.securities) {
    if (!view.isSector) continue; // sector rotation only reasons about sectors.
    const rs = relativeStrength(view.indicators, bench);
    if (rs === null) continue; // no horizon available for both sides — drop it.
    ranked.push({ view, ind: view.indicators, rs: rs.rs, horizon: rs.horizon });
  }

  // Steps 2–3: decide who we may emit. Leaders are the positive-rs sectors;
  // laggards are the negative-rs sectors, but only those with an inverse we can
  // actually trade. A flat (rs === 0) sector is neither, and is dropped.
  const emitted: Emitted[] = [];
  for (const sector of ranked) {
    if (sector.rs > 0) {
      emitted.push({ sector, direction: 'BULLISH', magnitude: sector.rs });
    } else if (sector.rs < 0 && sector.view.hasInverse) {
      emitted.push({ sector, direction: 'BEARISH', magnitude: -sector.rs });
    }
    // rs < 0 without an inverse: an unexpressible short — silently skipped.
  }

  if (emitted.length === 0) return [];

  // Step 4: min-max normalize |rs| across the emitted set to 0..1. A single item,
  // or a set whose magnitudes are all equal, all score 1 (nothing to spread over).
  const magnitudes = emitted.map((e) => e.magnitude);
  const min = Math.min(...magnitudes);
  const max = Math.max(...magnitudes);
  const span = max - min;

  // Step 5: build a finding per emitted sector.
  const findings: ScreenFinding[] = emitted.map((e) => {
    const score = span === 0 ? 1 : (e.magnitude - min) / span;
    const { sector } = e;

    const rationale =
      e.direction === 'BULLISH'
        ? `Sector leadership: ${fmtPct(sector.rs)} vs ${BENCHMARK_LABEL} over ${sector.horizon}`
        : `Sector laggard (inverse available): ${fmtPct(sector.rs)} vs ${BENCHMARK_LABEL} over ${sector.horizon}`;

    return {
      symbol: sector.view.symbol,
      exposure: sector.view.exposure,
      direction: e.direction,
      hit: {
        screen: 'sector-rotation',
        score,
        direction: e.direction,
        rationale,
        evidence: [`${sector.view.symbol}:bars:${sector.ind.asOf}`],
      },
    };
  });

  // Step 6: strongest relative-strength magnitude first.
  findings.sort((a, b) => b.hit.score - a.hit.score);
  return findings;
};
