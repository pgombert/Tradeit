import { describe, expect, it } from 'vitest';
import { classifyRegime, RISK_BUDGET, type RegimeInputs } from '../engine/regime.js';

/** A calm, trending tape: low vol, tight credit, loose conditions. */
const benign: RegimeInputs = {
  vix: 13.5,
  hySpread: 2.85,
  hySpreadMonthChange: -0.2,
  nfci: -0.6,
  curve: 0.55,
  spyAbove50dma: true,
  spyAbove200dma: true,
};

describe('classifyRegime', () => {
  it('calls a calm trending tape Risk-On Trend and permits leverage', () => {
    const v = classifyRegime(benign);
    expect(v.regime).toBe('RISK_ON_TREND');
    expect(v.leverageAllowed).toBe(true);
    expect(v.riskBudget).toBe(RISK_BUDGET.RISK_ON_TREND);
    expect(v.missing).toHaveLength(0);
  });

  it('holds at Chop when price trend is missing, however good the macro looks', () => {
    // This is the property that keeps leverage switched off until Schwab prices
    // flow — a trend regime cannot be confirmed without trend data.
    const v = classifyRegime({ ...benign, spyAbove50dma: null, spyAbove200dma: null });

    expect(v.regime).toBe('CHOP');
    expect(v.cappedByMissingTrend).toBe(true);
    expect(v.leverageAllowed).toBe(false);
    expect(v.missing).toContain('Price trend');
  });

  it('never reports capping when the regime would not have been Risk-On anyway', () => {
    const v = classifyRegime({
      ...benign,
      vix: 27,
      hySpread: 6.2,
      nfci: 0.4,
      spyAbove50dma: null,
      spyAbove200dma: null,
    });
    expect(v.regime).not.toBe('RISK_ON_TREND');
    expect(v.cappedByMissingTrend).toBe(false);
  });

  it('drops to Chop on mixed readings', () => {
    const v = classifyRegime({ ...benign, vix: 22, hySpread: 4.5, nfci: 0.1, hySpreadMonthChange: 0.3 });
    expect(v.regime).toBe('CHOP');
    expect(v.leverageAllowed).toBe(false);
  });

  it('goes Risk-Off as conditions deteriorate', () => {
    const v = classifyRegime({
      vix: 28,
      hySpread: 6.5,
      hySpreadMonthChange: 0.8,
      nfci: 0.6,
      curve: -0.2,
      spyAbove50dma: false,
      spyAbove200dma: true,
    });
    expect(v.regime).toBe('RISK_OFF');
    expect(v.riskBudget).toBe(RISK_BUDGET.RISK_OFF);
  });

  it('overrides to Crisis on a VIX above 40 even with everything else calm', () => {
    const v = classifyRegime({ ...benign, vix: 44 });
    expect(v.regime).toBe('CRISIS');
    expect(v.riskBudget).toBe(0);
    expect(v.rationale).toContain('44.0');
  });

  it('overrides to Crisis on high yield spreads above 8%', () => {
    expect(classifyRegime({ ...benign, hySpread: 8.4 }).regime).toBe('CRISIS');
  });

  it('overrides to Crisis when financial conditions exceed 1.0', () => {
    expect(classifyRegime({ ...benign, nfci: 1.3 }).regime).toBe('CRISIS');
  });

  it('defaults to Risk-Off with no data rather than assuming calm', () => {
    const v = classifyRegime({
      vix: null,
      hySpread: null,
      hySpreadMonthChange: null,
      nfci: null,
      curve: null,
      spyAbove50dma: null,
      spyAbove200dma: null,
    });

    expect(v.regime).toBe('RISK_OFF');
    expect(v.leverageAllowed).toBe(false);
    expect(v.signals).toHaveLength(0);
    expect(v.missing).toHaveLength(6);
  });

  it('scores only the signals it actually has', () => {
    const v = classifyRegime({
      vix: 13.5,
      hySpread: null,
      hySpreadMonthChange: null,
      nfci: null,
      curve: null,
      spyAbove50dma: true,
      spyAbove200dma: true,
    });

    // Both readings score +2, so the average is +2 regardless of the gaps.
    expect(v.signals).toHaveLength(2);
    expect(v.score).toBe(2);
  });

  it('penalises an inverted curve without letting it decide alone', () => {
    const upright = classifyRegime(benign);
    const inverted = classifyRegime({ ...benign, curve: -0.4 });

    expect(inverted.score).toBeLessThan(upright.score);
    expect(inverted.regime).toBe('RISK_ON_TREND');
  });

  it('treats widening credit as worse than merely wide credit', () => {
    const wide = classifyRegime({ ...benign, hySpread: 4.5, hySpreadMonthChange: 0 });
    const widening = classifyRegime({ ...benign, hySpread: 4.5, hySpreadMonthChange: 1.2 });
    expect(widening.score).toBeLessThan(wide.score);
  });
});
