import { breakerFor, buildRiskLimits, type BreakerLevel, type RiskLimits } from '@tradeit/shared';
import { env } from '../config/environment.js';

export interface RiskStatus {
  limits: RiskLimits;
  /** Null until the account is connected — never rendered as zero. */
  currentEquity: number | null;
  peakEquity: number | null;
  drawdown: number | null;
  breaker: BreakerLevel;
  /** Weekly pace needed from here to finish the year at target. */
  targetWeeklyReturn: number;
}

export const limits = buildRiskLimits(env.STARTING_CAPITAL, env.MAX_DRAWDOWN);

/**
 * Phase 0 reports the configured limits and an unknown equity. Phase 4 fills in
 * equity from the position ledger and the breaker starts biting.
 */
export function getRiskStatus(currentEquity: number | null, peakEquity: number | null): RiskStatus {
  const drawdown =
    currentEquity !== null && peakEquity !== null ? Math.max(0, peakEquity - currentEquity) : null;

  return {
    limits,
    currentEquity,
    peakEquity,
    drawdown,
    breaker: drawdown === null ? 'NONE' : breakerFor(drawdown, limits),
    targetWeeklyReturn: 2 ** (1 / 52) - 1,
  };
}
