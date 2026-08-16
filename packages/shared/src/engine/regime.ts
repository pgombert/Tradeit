import type { MarketRegime } from '../types/risk.js';

/**
 * Stage 0 — regime classification.
 *
 * The most important control in the system: it sets the week's risk budget
 * before a single candidate is looked at, and it decides whether leveraged
 * products are eligible at all (docs/PLAN.md §1, §5).
 *
 * Deliberately a transparent scorecard rather than a fitted model. Every input
 * contributes a score in [-2, +2] where positive means risk-on, the scores are
 * averaged over the inputs actually available, and the average maps to a regime.
 * When it is wrong we want to be able to read *why* it was wrong.
 */

export interface RegimeInputs {
  /** VIX level (FRED: VIXCLS). */
  vix: number | null;
  /** High yield option-adjusted spread, percent (FRED: BAMLH0A0HYM2). */
  hySpread: number | null;
  /** Change in the HY spread over the last month, in percentage points. */
  hySpreadMonthChange: number | null;
  /** Chicago Fed financial conditions (FRED: NFCI). Positive is tighter. */
  nfci: number | null;
  /** 10Y minus 2Y, percent (FRED: T10Y2Y). */
  curve: number | null;

  /**
   * Price trend. Null until Schwab prices flow in Phase 1 — and while it is
   * null the regime is capped at CHOP, because a trend regime cannot be
   * confirmed without trend data. That cap is what keeps leverage switched off.
   */
  spyAbove50dma: boolean | null;
  spyAbove200dma: boolean | null;
}

export interface RegimeSignal {
  key: string;
  label: string;
  /** The raw reading, formatted for display. */
  reading: string;
  /** -2 (most risk-off) to +2 (most risk-on). */
  score: number;
}

export interface RegimeVerdict {
  regime: MarketRegime;
  /** Average of the contributing signal scores, -2 to +2. */
  score: number;
  signals: RegimeSignal[];
  /** Signals we had no data for. */
  missing: string[];
  /** True when the verdict was held down for want of trend data. */
  cappedByMissingTrend: boolean;
  leverageAllowed: boolean;
  /** Fraction of capital that may be put at risk this week. */
  riskBudget: number;
  rationale: string;
}

/** A reading so extreme it overrides the scorecard entirely. */
function crisisOverride(i: RegimeInputs): string | null {
  if (i.vix !== null && i.vix > 40) return `VIX at ${i.vix.toFixed(1)}`;
  if (i.hySpread !== null && i.hySpread > 8) return `high yield spreads at ${i.hySpread.toFixed(2)}%`;
  if (i.nfci !== null && i.nfci > 1) return `financial conditions at ${i.nfci.toFixed(2)}`;
  return null;
}

function scoreVix(v: number): number {
  if (v < 15) return 2;
  if (v < 20) return 1;
  if (v < 25) return 0;
  if (v < 30) return -1;
  return -2;
}

function scoreHyLevel(v: number): number {
  if (v < 3) return 2;
  if (v < 4) return 1;
  if (v < 5) return 0;
  if (v < 7) return -1;
  return -2;
}

/** Credit direction leads credit level — widening matters more than wide. */
function scoreHyChange(v: number): number {
  if (v > 1) return -2;
  if (v > 0.5) return -1;
  if (v < -0.5) return 1;
  return 0;
}

function scoreNfci(v: number): number {
  if (v < -0.5) return 2;
  if (v < 0) return 1;
  if (v < 0.5) return -1;
  return -2;
}

/** Weak weekly signal, so it is present but never decisive on its own. */
function scoreCurve(v: number): number {
  return v < 0 ? -1 : 0;
}

function scoreTrend(above50: boolean, above200: boolean): number {
  if (above50 && above200) return 2;
  if (above200) return 1;
  if (above50) return 0;
  return -2;
}

export const RISK_BUDGET: Record<MarketRegime, number> = {
  RISK_ON_TREND: 0.06,
  CHOP: 0.03,
  RISK_OFF: 0.015,
  CRISIS: 0,
};

export function classifyRegime(inputs: RegimeInputs): RegimeVerdict {
  const signals: RegimeSignal[] = [];
  const missing: string[] = [];

  if (inputs.vix !== null) {
    signals.push({ key: 'vix', label: 'Volatility (VIX)', reading: inputs.vix.toFixed(2), score: scoreVix(inputs.vix) });
  } else missing.push('Volatility (VIX)');

  if (inputs.hySpread !== null) {
    signals.push({
      key: 'hy_level',
      label: 'Credit spreads',
      reading: `${inputs.hySpread.toFixed(2)}%`,
      score: scoreHyLevel(inputs.hySpread),
    });
  } else missing.push('Credit spreads');

  if (inputs.hySpreadMonthChange !== null) {
    signals.push({
      key: 'hy_change',
      label: 'Credit direction (1m)',
      reading: `${inputs.hySpreadMonthChange >= 0 ? '+' : ''}${inputs.hySpreadMonthChange.toFixed(2)}%`,
      score: scoreHyChange(inputs.hySpreadMonthChange),
    });
  } else missing.push('Credit direction (1m)');

  if (inputs.nfci !== null) {
    signals.push({
      key: 'nfci',
      label: 'Financial conditions',
      reading: inputs.nfci.toFixed(2),
      score: scoreNfci(inputs.nfci),
    });
  } else missing.push('Financial conditions');

  if (inputs.curve !== null) {
    signals.push({
      key: 'curve',
      label: 'Yield curve (2s10s)',
      reading: `${inputs.curve.toFixed(2)}%`,
      score: scoreCurve(inputs.curve),
    });
  } else missing.push('Yield curve (2s10s)');

  const hasTrend = inputs.spyAbove50dma !== null && inputs.spyAbove200dma !== null;
  if (hasTrend) {
    signals.push({
      key: 'trend',
      label: 'Price trend',
      reading: `${inputs.spyAbove50dma ? 'above' : 'below'} 50d, ${inputs.spyAbove200dma ? 'above' : 'below'} 200d`,
      score: scoreTrend(inputs.spyAbove50dma === true, inputs.spyAbove200dma === true),
    });
  } else missing.push('Price trend');

  const crisis = crisisOverride(inputs);
  const score =
    signals.length === 0 ? 0 : signals.reduce((sum, s) => sum + s.score, 0) / signals.length;

  let regime: MarketRegime;
  let rationale: string;

  if (crisis) {
    regime = 'CRISIS';
    rationale = `Crisis override — ${crisis}. No new positions.`;
  } else if (signals.length === 0) {
    regime = 'RISK_OFF';
    rationale = 'No data collected yet. Defaulting to risk-off rather than assuming calm.';
  } else if (score >= 1) {
    regime = 'RISK_ON_TREND';
    rationale = 'Volatility, credit and conditions all supportive.';
  } else if (score >= -0.5) {
    regime = 'CHOP';
    rationale = 'Mixed signals — no clear direction to lean on.';
  } else if (score >= -1.5) {
    regime = 'RISK_OFF';
    rationale = 'Conditions deteriorating. Defensive only.';
  } else {
    regime = 'CRISIS';
    rationale = 'Broad deterioration across every reading.';
  }

  // A trend regime cannot be confirmed without trend data. Holding the verdict
  // at CHOP is what keeps leveraged products switched off until prices flow.
  let cappedByMissingTrend = false;
  if (regime === 'RISK_ON_TREND' && !hasTrend) {
    regime = 'CHOP';
    cappedByMissingTrend = true;
    rationale =
      'Macro readings are supportive, but price trend data is missing — a trend regime cannot be confirmed without it, so this is held at Chop and leverage stays off.';
  }

  return {
    regime,
    score,
    signals,
    missing,
    cappedByMissingTrend,
    leverageAllowed: regime === 'RISK_ON_TREND',
    riskBudget: RISK_BUDGET[regime],
    rationale,
  };
}
