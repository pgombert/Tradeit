/**
 * Pure Stage 1 pipeline: bars in, candidates out. No Prisma, no clock — the
 * service loads the data and converts Decimal→number at the edge, then hands it
 * here so the screening pipeline can be tested against fixtures.
 */
import {
  aggregateCandidates,
  computeIndicators,
  runScreens,
  type AggregateOptions,
  type Bar,
  type Candidate,
  type DossierRegime,
  type Indicators,
  type SecurityView,
} from '@tradeit/shared';

/** One screenable security with its loaded daily bars (prices already numbers). */
export interface SecurityBars {
  symbol: string;
  exposure: string;
  isSector: boolean;
  hasInverse: boolean;
  isLeveraged: boolean;
  bars: Bar[];
}

export interface Stage1Result {
  candidates: Candidate[];
  /** Every screened security's indicators, so Stage 2 reuses them without recompute. */
  indicatorsBySymbol: Map<string, Indicators>;
  asOf: string;
}

/**
 * Compute indicators for each security and the benchmark, run the standard
 * screen set, and aggregate to ranked candidates. `asOf` is the benchmark's last
 * bar date, falling back to any security's date, then the regime's.
 */
export function runStage1(
  securities: SecurityBars[],
  benchmarkBars: Bar[],
  regime: DossierRegime,
  opts: AggregateOptions = {},
): Stage1Result {
  const benchmark = computeIndicators(benchmarkBars);
  const views: SecurityView[] = securities.map((s) => ({
    symbol: s.symbol,
    exposure: s.exposure,
    isSector: s.isSector,
    hasInverse: s.hasInverse,
    isLeveraged: s.isLeveraged,
    indicators: computeIndicators(s.bars),
  }));

  const indicatorsBySymbol = new Map(views.map((v) => [v.symbol, v.indicators]));
  const asOf =
    benchmark.asOf ?? views.map((v) => v.indicators.asOf).find((d): d is string => Boolean(d)) ?? regime.asOf ?? '';

  const findings = runScreens({ securities: views, benchmark, regime });
  const candidates = aggregateCandidates(findings, asOf, opts);
  return { candidates, indicatorsBySymbol, asOf };
}
