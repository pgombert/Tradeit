import { describe, expect, it } from 'vitest';
import { breakoutScreen } from '../breakout.js';
import type { ScreenContext, SecurityView } from '../types.js';
import type { Indicators } from '../../price-indicators.js';
import type { DossierRegime } from '../../../types/candidate.js';

const NULL_INDICATORS: Indicators = {
  asOf: '2026-08-18',
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

function ind(partial: Partial<Indicators>): Indicators {
  return { ...NULL_INDICATORS, ...partial };
}

function security(symbol: string, indicators: Indicators): SecurityView {
  return { symbol, exposure: symbol, isSector: false, hasInverse: false, isLeveraged: false, indicators };
}

const REGIME: DossierRegime = {
  regime: 'RISK_ON_TREND',
  leverageAllowed: true,
  riskBudget: 0.06,
  asOf: '2026-08-18',
};

/** SPY up 2% over 1m. */
const benchmark: Indicators = ind({ return1m: 0.02 });

function context(securities: SecurityView[], bench: Indicators = benchmark): ScreenContext {
  return { securities, benchmark: bench, regime: REGIME };
}

/** A textbook fresh breakout: up 18% in a month, at its highs, still rising. */
const BREAKOUT = ind({
  above50dma: true,
  return1m: 0.18,
  return1w: 0.04,
  drawdownFromHigh: -0.01,
});

describe('breakoutScreen', () => {
  it('surfaces a fresh breakout as a BULLISH finding with a stock exposure', () => {
    const findings = breakoutScreen(context([security('RIP', BREAKOUT)]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ symbol: 'RIP', exposure: 'RIP', direction: 'BULLISH' });
    expect(findings[0]?.hit.screen).toBe('breakout');
    expect(findings[0]?.hit.rationale).toContain('Breakout');
  });

  it('does not require a months-long established trend (no above-200dma gate)', () => {
    // A nimble name above its 50d but not its 200d still qualifies — the whole point.
    const fresh = ind({ ...BREAKOUT, above200dma: false });
    expect(breakoutScreen(context([security('NEW', fresh)]))).toHaveLength(1);
  });

  it('rejects a name below its 50-day average', () => {
    expect(breakoutScreen(context([security('X', ind({ ...BREAKOUT, above50dma: false }))]))).toEqual([]);
  });

  it('rejects a weak 1-month move (a drift, not a breakout)', () => {
    expect(breakoutScreen(context([security('X', ind({ ...BREAKOUT, return1m: 0.02 }))]))).toEqual([]);
  });

  it('rejects a name well off its high (a recovery, not a breakout)', () => {
    expect(breakoutScreen(context([security('X', ind({ ...BREAKOUT, drawdownFromHigh: -0.2 }))]))).toEqual([]);
  });

  it('rejects a name already fading hard this week (a failed breakout)', () => {
    expect(breakoutScreen(context([security('X', ind({ ...BREAKOUT, return1w: -0.09 }))]))).toEqual([]);
  });

  it('ranks the stronger thrust first and normalizes scores to 0..1', () => {
    const strong = ind({ above50dma: true, return1m: 0.3, return1w: 0.06, drawdownFromHigh: 0 });
    const weak = ind({ above50dma: true, return1m: 0.07, return1w: 0.0, drawdownFromHigh: -0.07 });
    const findings = breakoutScreen(context([security('WEAK', weak), security('STRONG', strong)]));
    expect(findings.map((f) => f.symbol)).toEqual(['STRONG', 'WEAK']);
    expect(findings[0]?.hit.score).toBe(1);
    expect(findings[1]?.hit.score).toBe(0);
  });

  it('credits relative strength over the benchmark in the rationale', () => {
    // 18% vs SPY 2% → +16% edge.
    const findings = breakoutScreen(context([security('RIP', BREAKOUT)]));
    expect(findings[0]?.hit.rationale).toContain('vs SPY');
  });
});
