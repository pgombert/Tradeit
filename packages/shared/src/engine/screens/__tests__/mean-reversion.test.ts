import { describe, it, expect } from 'vitest';
import { meanReversionScreen } from '../mean-reversion.js';
import type { ScreenContext, SecurityView } from '../types.js';
import type { Indicators } from '../../price-indicators.js';
import type { DossierRegime } from '../../../types/candidate.js';

/** A fully-null indicator set; tests set only the fields the screen reads. */
function nullIndicators(): Indicators {
  return {
    asOf: '2026-08-14',
    close: null,
    return1w: null,
    return1m: null,
    return3m: null,
    return6m: null,
    sma50: null,
    sma200: null,
    above50dma: null,
    above200dma: null,
    rsi14: null,
    atr14: null,
    atrPct: null,
    drawdownFromHigh: null,
    avgDollarVolume: null,
  };
}

function security(symbol: string, ind: Partial<Indicators>): SecurityView {
  return {
    symbol,
    exposure: symbol,
    isSector: false,
    hasInverse: false,
    isLeveraged: false,
    indicators: { ...nullIndicators(), ...ind },
  };
}

const REGIME: DossierRegime = {
  regime: 'RISK_ON_TREND',
  leverageAllowed: true,
  riskBudget: 0.06,
  asOf: '2026-08-14',
};

function ctx(securities: SecurityView[]): ScreenContext {
  return { securities, benchmark: nullIndicators(), regime: REGIME };
}

describe('meanReversionScreen', () => {
  it('(a) surfaces an oversold security above its 200-day as BULLISH', () => {
    const out = meanReversionScreen(
      ctx([security('AAA', { above200dma: true, rsi14: 28, drawdownFromHigh: -0.083 })]),
    );
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.symbol).toBe('AAA');
    expect(f.direction).toBe('BULLISH');
    expect(f.hit.screen).toBe('mean-reversion');
    expect(f.hit.direction).toBe('BULLISH');
    // base (35-28)/35 = 0.2, plus pullback min(0.3, 0.083) = 0.083 → 0.283.
    expect(f.hit.score).toBeCloseTo(0.283, 5);
    expect(f.hit.rationale).toBe(
      'Oversold in uptrend: RSI 28, above 200-day, -8.3% from 6-month high',
    );
    expect(f.hit.evidence).toEqual(['AAA:bars:2026-08-14']);
  });

  it('(b) excludes an oversold security BELOW its 200-day (falling knife)', () => {
    const out = meanReversionScreen(
      ctx([security('BBB', { above200dma: false, rsi14: 20, drawdownFromHigh: -0.4 })]),
    );
    expect(out).toEqual([]);
  });

  it('(c) excludes a security above its 200-day that is not oversold (RSI 50)', () => {
    const out = meanReversionScreen(
      ctx([security('CCC', { above200dma: true, rsi14: 50 })]),
    );
    expect(out).toEqual([]);
  });

  it('(d) excludes a security with a null RSI (never treated as 0/oversold)', () => {
    const out = meanReversionScreen(
      ctx([security('DDD', { above200dma: true, rsi14: null })]),
    );
    expect(out).toEqual([]);
  });

  it('(e) ranks the more-oversold security above the less-oversold one', () => {
    const out = meanReversionScreen(
      ctx([
        security('LESS', { above200dma: true, rsi14: 30 }), // base 5/35 ≈ 0.143
        security('MORE', { above200dma: true, rsi14: 10 }), // base 25/35 ≈ 0.714
      ]),
    );
    expect(out.map((f) => f.symbol)).toEqual(['MORE', 'LESS']);
    expect(out[0]!.hit.score).toBeGreaterThan(out[1]!.hit.score);
    expect(out[0]!.hit.score).toBeCloseTo(25 / 35, 5);
    expect(out[1]!.hit.score).toBeCloseTo(5 / 35, 5);
  });

  it('(f) returns [] for an empty context', () => {
    expect(meanReversionScreen(ctx([]))).toEqual([]);
  });

  it('omits the pullback phrase when drawdownFromHigh is null', () => {
    const out = meanReversionScreen(
      ctx([security('EEE', { above200dma: true, rsi14: 28, drawdownFromHigh: null })]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.hit.rationale).toBe('Oversold in uptrend: RSI 28, above 200-day');
    expect(out[0]!.hit.score).toBeCloseTo(0.2, 5);
  });

  it('excludes a security with a null above200dma (unknown trend)', () => {
    const out = meanReversionScreen(
      ctx([security('FFF', { above200dma: null, rsi14: 28 })]),
    );
    expect(out).toEqual([]);
  });
});
