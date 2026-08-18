import { describe, expect, it } from 'vitest';
import type { Bar, DossierRegime } from '@tradeit/shared';
import { runStage1, type SecurityBars } from '../services/candidates.parse.js';

/** A rising bar series of length n, close stepping by `step` from `start`. */
function rising(n: number, start: number, step: number): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open: close, high: close, low: close, close, volume: 1_000_000 };
  });
}

const REGIME: DossierRegime = { regime: 'RISK_ON_TREND', leverageAllowed: true, riskBudget: 0.06, asOf: '2026-08-17' };

describe('runStage1', () => {
  it('surfaces a strongly-uptrending security that outperforms the benchmark', () => {
    const benchmarkBars = rising(210, 100, 0.2); // SPY up gently
    const securities: SecurityBars[] = [
      { symbol: 'XLK', exposure: 'TECH', isSector: true, hasInverse: false, isLeveraged: false, bars: rising(210, 100, 0.6) }, // faster
    ];
    const { candidates, indicatorsBySymbol, asOf } = runStage1(securities, benchmarkBars, REGIME);

    expect(candidates.map((c) => c.symbol)).toContain('XLK');
    const xlk = candidates.find((c) => c.symbol === 'XLK');
    expect(xlk?.direction).toBe('BULLISH');
    expect(indicatorsBySymbol.get('XLK')?.above200dma).toBe(true);
    expect(asOf).not.toBe('');
  });

  it('handles a security with no bars without crashing and produces no candidate for it', () => {
    const { candidates, indicatorsBySymbol } = runStage1(
      [{ symbol: 'XLE', exposure: 'ENERGY', isSector: true, hasInverse: false, isLeveraged: false, bars: [] }],
      rising(210, 100, 0.2),
      REGIME,
    );
    expect(candidates.map((c) => c.symbol)).not.toContain('XLE');
    expect(indicatorsBySymbol.get('XLE')?.above200dma).toBeNull();
  });
});
