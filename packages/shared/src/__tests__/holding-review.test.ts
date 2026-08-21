import { describe, expect, it } from 'vitest';
import { assessHolding, stopDistanceFor, type HoldingSignals } from '../engine/holding-review.js';

/** A healthy, trending holding; spread a partial over it to change one thing. */
const HEALTHY: HoldingSignals = {
  symbol: 'AAA',
  price: 100,
  return1w: 0.01,
  return1m: 0.08,
  return3m: 0.2,
  above50dma: true,
  above200dma: true,
  atrPct: 0.03,
  drawdownFromHigh: -0.02,
  earningsWithinHold: false,
  regimeCrisis: false,
  gainFromCost: 0.15,
  weight: 0.2,
};
const sig = (p: Partial<HoldingSignals>): HoldingSignals => ({ ...HEALTHY, ...p });

describe('stopDistanceFor', () => {
  it('is 2.5x the daily range, floored at 8%', () => {
    expect(stopDistanceFor(0.05)).toBeCloseTo(0.125, 6); // 2.5 * 0.05
    expect(stopDistanceFor(0.01)).toBeCloseTo(0.08, 6); // floor
    expect(stopDistanceFor(null)).toBeCloseTo(0.08, 6);
  });
});

describe('assessHolding', () => {
  it('holds a healthy, trending name', () => {
    const v = assessHolding(HEALTHY);
    expect(v.action).toBe('HOLD');
    expect(v.roomToStop).toBeGreaterThan(0);
  });

  it('exits when the drop from the high breaks the trailing stop', () => {
    // atrPct 0.03 → buffer 7.5% floored to 8%; a 12% drop is through it.
    const v = assessHolding(sig({ drawdownFromHigh: -0.12 }));
    expect(v.action).toBe('EXIT');
    expect(v.reasons[0]).toMatch(/trailing stop/i);
    expect(v.roomToStop).toBeLessThanOrEqual(0);
  });

  it('exits when momentum breaks — below the 50-day and down on the month', () => {
    const v = assessHolding(sig({ above50dma: false, return1m: -0.09, drawdownFromHigh: -0.05 }));
    expect(v.action).toBe('EXIT');
    expect(v.reasons.join(' ')).toMatch(/momentum/i);
  });

  it('exits everything in a market crisis', () => {
    expect(assessHolding(sig({ regimeCrisis: true })).action).toBe('EXIT');
  });

  it('trims a name reporting earnings inside the window (not a break)', () => {
    const v = assessHolding(sig({ earningsWithinHold: true }));
    expect(v.action).toBe('TRIM');
    expect(v.reasons[0]).toMatch(/earnings/i);
  });

  it('trims a fading name that rolled below its 50-day but holds its 200-day', () => {
    const v = assessHolding(sig({ above50dma: false, above200dma: true, return1m: 0.01, drawdownFromHigh: -0.04 }));
    expect(v.action).toBe('TRIM');
    expect(v.reasons[0]).toMatch(/fading/i);
  });

  it('prefers EXIT over TRIM when both fire', () => {
    // earnings (trim) AND broke the stop (exit) → EXIT wins.
    const v = assessHolding(sig({ earningsWithinHold: true, drawdownFromHigh: -0.2 }));
    expect(v.action).toBe('EXIT');
  });

  it('does not guess without price data — holds and flags it', () => {
    const v = assessHolding(sig({ price: null, drawdownFromHigh: null }));
    expect(v.action).toBe('HOLD');
    expect(v.insufficientData).toBe(true);
  });
});
