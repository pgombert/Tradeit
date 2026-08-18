import { describe, expect, it } from 'vitest';
import {
  atr,
  avgDollarVolume,
  computeIndicators,
  drawdownFromHigh,
  relativeStrength,
  rsi,
  simpleReturn,
  sma,
  type Bar,
} from '../engine/price-indicators.js';

/** Build a bar with a given close; OHLC flat around it unless overridden. */
function bar(date: string, close: number, extra: Partial<Bar> = {}): Bar {
  return { date, open: close, high: close, low: close, close, volume: 1_000, ...extra };
}

/** N ascending bars stepping by `step` from `start`. */
function series(n: number, start = 100, step = 1): Bar[] {
  return Array.from({ length: n }, (_, i) => bar(`2026-01-${String(i + 1).padStart(2, '0')}`, start + i * step));
}

describe('simpleReturn', () => {
  it('computes the trailing return over the lookback', () => {
    expect(simpleReturn([100, 105, 110], 2)).toBeCloseTo(0.1, 10);
  });
  it('is null when the series is shorter than the lookback', () => {
    expect(simpleReturn([100], 5)).toBeNull();
  });
});

describe('sma', () => {
  it('averages the last n values', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
  });
  it('is null with fewer than n values', () => {
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe('rsi', () => {
  it('is 100 for a strictly rising series (no losses)', () => {
    expect(rsi([1, 2, 3, 4, 5], 4)).toBe(100);
  });
  it('is 0 for a strictly falling series (no gains)', () => {
    expect(rsi([5, 4, 3, 2, 1], 4)).toBe(0);
  });
  it('matches a worked mixed example', () => {
    // last 2 deltas: +1 (gain), -0.5 (loss) → avgGain .5, avgLoss .25, rs 2 → 66.67
    expect(rsi([10, 11, 10.5], 2)).toBeCloseTo(66.666, 2);
  });
  it('is null without period+1 closes', () => {
    expect(rsi([1, 2], 14)).toBeNull();
  });
});

describe('atr', () => {
  it('averages true range over the period (worked example)', () => {
    const bars = [
      bar('2026-01-01', 10, { high: 10, low: 10 }),
      bar('2026-01-02', 11, { high: 12, low: 9 }), // TR = 3
      bar('2026-01-03', 12, { high: 13, low: 11 }), // TR = 2
    ];
    expect(atr(bars, 2)).toBeCloseTo(2.5, 10);
  });
});

describe('drawdownFromHigh', () => {
  it('is the non-positive distance below the window high', () => {
    expect(drawdownFromHigh([100, 120, 110], 10)).toBeCloseTo(110 / 120 - 1, 10);
  });
  it('is 0 at a fresh high', () => {
    expect(drawdownFromHigh([100, 110, 120], 10)).toBe(0);
  });
});

describe('relativeStrength', () => {
  it('is the series return minus the benchmark return', () => {
    // series +10%, bench +4% → +6%
    expect(relativeStrength([100, 110], [100, 104], 1)).toBeCloseTo(0.06, 10);
  });
});

describe('avgDollarVolume', () => {
  it('averages close × volume over the window', () => {
    const bars = [bar('2026-01-01', 10, { volume: 100 }), bar('2026-01-02', 20, { volume: 200 })];
    // (10*100 + 20*200) / 2 = (1000 + 4000)/2 = 2500
    expect(avgDollarVolume(bars, 20)).toBe(2500);
  });
});

describe('computeIndicators', () => {
  it('degrades each field to null on a short history, never zero', () => {
    const ind = computeIndicators(series(3));
    expect(ind.asOf).toBe('2026-01-03');
    expect(ind.close).toBe(102);
    expect(ind.sma200).toBeNull();
    expect(ind.above200dma).toBeNull();
    expect(ind.rsi14).toBeNull(); // needs 15
    expect(ind.atr14).toBeNull(); // needs 15
    expect(ind.return6m).toBeNull(); // needs > 126
  });

  it('computes the full set once history is long enough', () => {
    const ind = computeIndicators(series(210)); // rising series
    expect(ind.sma50).not.toBeNull();
    expect(ind.sma200).not.toBeNull();
    expect(ind.above200dma).toBe(true); // last close above the 200-day mean of a rising series
    expect(ind.rsi14).toBe(100); // strictly rising → no losses
    expect(ind.return1m).toBeGreaterThan(0);
    expect(ind.drawdownFromHigh).toBe(0); // last bar is the high
  });

  it('returns an all-null shape for no bars', () => {
    const ind = computeIndicators([]);
    expect(ind.asOf).toBeNull();
    expect(ind.close).toBeNull();
  });
});
