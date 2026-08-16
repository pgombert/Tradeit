/**
 * Risk limits. These are the numbers from docs/PLAN.md §1 expressed once, in
 * one place, so the engine and the dashboard cannot drift apart.
 *
 * Capital and the drawdown limit come from the environment (STARTING_CAPITAL,
 * MAX_DRAWDOWN) because they are Pete's to change. Everything below is derived.
 */

export type MarketRegime = 'RISK_ON_TREND' | 'CHOP' | 'RISK_OFF' | 'CRISIS';

/** What the ladder does at each depth of drawdown from the equity peak. */
export type BreakerLevel = 'NONE' | 'HALVE_SIZE' | 'PAUSE_AND_REVIEW' | 'HARD_STOP';

export interface RiskLimits {
  startingCapital: number;
  /** Dollars. Pete set this to 30,000 on 2026-08-16. */
  maxDrawdown: number;
  /** Equity level at which the program stops entirely. */
  floor: number;
  /** Fraction of the drawdown budget consumed at each breaker step. */
  halveSizeAt: number;
  pauseAt: number;
  hardStopAt: number;
}

export function buildRiskLimits(startingCapital: number, maxDrawdown: number): RiskLimits {
  return {
    startingCapital,
    maxDrawdown,
    floor: startingCapital - maxDrawdown,
    halveSizeAt: maxDrawdown / 3,
    pauseAt: (maxDrawdown * 2) / 3,
    hardStopAt: maxDrawdown,
  };
}

/**
 * Which breaker applies at a given drawdown, in dollars from the equity peak.
 * `drawdown` is expected to be a positive number.
 */
export function breakerFor(drawdown: number, limits: RiskLimits): BreakerLevel {
  if (drawdown >= limits.hardStopAt) return 'HARD_STOP';
  if (drawdown >= limits.pauseAt) return 'PAUSE_AND_REVIEW';
  if (drawdown >= limits.halveSizeAt) return 'HALVE_SIZE';
  return 'NONE';
}

/** Leveraged products are eligible in one regime only — see docs/PLAN.md §1. */
export function leverageAllowed(regime: MarketRegime): boolean {
  return regime === 'RISK_ON_TREND';
}

/** Ceiling on leveraged notional as a fraction of book. */
export const MAX_LEVERAGED_BOOK_FRACTION = 0.2;

/** The weekly pace that compounds $100k to $200k across 52 weeks. */
export const TARGET_WEEKLY_RETURN = 0.01342;
