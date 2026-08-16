import { describe, expect, it } from 'vitest';
import { breakerFor, buildRiskLimits, leverageAllowed } from '../types/risk.js';

describe('risk limits', () => {
  const limits = buildRiskLimits(100_000, 30_000);

  it('puts the floor at capital minus the drawdown budget', () => {
    expect(limits.floor).toBe(70_000);
  });

  it('spaces the breaker ladder across the drawdown budget', () => {
    expect(limits.halveSizeAt).toBe(10_000);
    expect(limits.pauseAt).toBe(20_000);
    expect(limits.hardStopAt).toBe(30_000);
  });

  it('escalates as the drawdown deepens', () => {
    expect(breakerFor(0, limits)).toBe('NONE');
    expect(breakerFor(9_999, limits)).toBe('NONE');
    expect(breakerFor(10_000, limits)).toBe('HALVE_SIZE');
    expect(breakerFor(19_999, limits)).toBe('HALVE_SIZE');
    expect(breakerFor(20_000, limits)).toBe('PAUSE_AND_REVIEW');
    expect(breakerFor(29_999, limits)).toBe('PAUSE_AND_REVIEW');
    expect(breakerFor(30_000, limits)).toBe('HARD_STOP');
    expect(breakerFor(45_000, limits)).toBe('HARD_STOP');
  });
});

describe('leverage gating', () => {
  it('permits leveraged products in a trending tape only', () => {
    expect(leverageAllowed('RISK_ON_TREND')).toBe(true);
    expect(leverageAllowed('CHOP')).toBe(false);
    expect(leverageAllowed('RISK_OFF')).toBe(false);
    expect(leverageAllowed('CRISIS')).toBe(false);
  });
});
