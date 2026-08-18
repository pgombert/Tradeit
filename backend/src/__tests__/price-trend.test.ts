import { describe, expect, it } from 'vitest';
import { priceTrend } from '../services/price-trend.js';

/** A rising ramp: the latest close sits above both averages. */
function rising(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 + i);
}

describe('priceTrend', () => {
  it('reports above both averages when the latest close leads a rising series', () => {
    const t = priceTrend(rising(200));
    expect(t.above50dma).toBe(true);
    expect(t.above200dma).toBe(true);
  });

  it('reports below both averages on a falling series', () => {
    const falling = rising(200).reverse(); // latest close is the lowest
    const t = priceTrend(falling);
    expect(t.above50dma).toBe(false);
    expect(t.above200dma).toBe(false);
  });

  it('computes the average over exactly the trailing window', () => {
    // 200 values 1..200. Latest = 200. SMA200 = mean(1..200) = 100.5 → above.
    // SMA50 = mean(151..200) = 175.5 → above.
    const t = priceTrend(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(t.above200dma).toBe(true);
    expect(t.above50dma).toBe(true);

    // A latest close below the 50-day mean but above the 200-day mean.
    const closes = [
      ...Array.from({ length: 150 }, () => 50), // long low base
      ...Array.from({ length: 49 }, () => 300), // recent spike lifts SMA50
      170, // latest: above the 200d mean, below the spiked 50d mean
    ];
    const mixed = priceTrend(closes);
    expect(mixed.above50dma).toBe(false);
    expect(mixed.above200dma).toBe(true);
  });

  it('returns null for an average it lacks the history to compute', () => {
    const t = priceTrend(rising(60)); // enough for 50, not 200
    expect(t.above50dma).toBe(true);
    expect(t.above200dma).toBeNull();

    const tooShort = priceTrend(rising(10));
    expect(tooShort.above50dma).toBeNull();
    expect(tooShort.above200dma).toBeNull();
  });

  it('handles an empty series as all-null', () => {
    expect(priceTrend([])).toEqual({ above50dma: null, above200dma: null });
  });
});
