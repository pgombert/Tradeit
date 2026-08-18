/**
 * The contract every Stage 1 screen is written against. A screen is a *pure*
 * function: given a `ScreenContext` (each security's indicators, the benchmark,
 * and the week's regime), it returns `ScreenFinding`s — no DB, no dates-from-now,
 * no randomness — so it is deterministic and testable against fixtures.
 *
 * The backend builds the context from `price_bars` and the regime service, runs
 * every screen, and the aggregator merges findings by symbol into `Candidate`s.
 * Direction-to-instrument translation and sizing happen later (Stage 5); screens
 * only surface an exposure + direction with a reason.
 */
import type { Direction } from '../instrument-selection.js';
import type { Indicators } from '../price-indicators.js';
import type { DossierRegime, ScreenHit } from '../../types/candidate.js';

/** One security as a screen sees it: its indicators plus the metadata screens
 * need to reason about expressibility (sector membership, inverse availability). */
export interface SecurityView {
  symbol: string;
  exposure: string;
  /** True for a sector ETF (vs index, rates/credit/commodity). */
  isSector: boolean;
  /** True when an inverse instrument exists for this exposure — a bearish
   * finding with no inverse cannot be traded (the account can't short), so
   * screens should not emit one. */
  hasInverse: boolean;
  /** Whether this security is itself a leveraged product. */
  isLeveraged: boolean;
  indicators: Indicators;
}

/** Everything a screen reads. Immutable — screens must not mutate it. */
export interface ScreenContext {
  securities: readonly SecurityView[];
  /** The benchmark's indicators (SPY), for relative-strength comparisons. */
  benchmark: Indicators;
  regime: DossierRegime;
}

/** A screen's finding for one security: the exposure/direction it surfaces plus
 * the `ScreenHit` (score, rationale, evidence). The aggregator groups these. */
export interface ScreenFinding {
  symbol: string;
  exposure: string;
  direction: Direction;
  hit: ScreenHit;
}

/** A Stage 1 screen. Pure; same context in → same findings out. */
export type Screen = (ctx: ScreenContext) => ScreenFinding[];
