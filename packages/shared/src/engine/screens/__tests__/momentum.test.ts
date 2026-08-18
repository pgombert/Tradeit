import { describe, expect, it } from 'vitest';
import { momentumScreen } from '../momentum.js';
import type { ScreenContext, SecurityView } from '../types.js';
import type { Indicators } from '../../price-indicators.js';
import type { DossierRegime } from '../../../types/candidate.js';

/** A full null indicator set; spread a partial over it to set only what matters. */
const NULL_INDICATORS: Indicators = {
  asOf: null,
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
  return {
    symbol,
    exposure: symbol,
    isSector: false,
    hasInverse: true,
    isLeveraged: false,
    indicators,
  };
}

/** Regime is present but ignored by this screen — construction handles gating. */
const REGIME: DossierRegime = {
  regime: 'RISK_ON_TREND',
  leverageAllowed: true,
  riskBudget: 0.06,
  asOf: '2026-08-17',
};

/** Benchmark (SPY) up 5% over 3m. */
const benchmark: Indicators = ind({ asOf: '2026-08-17', return3m: 0.05 });

function context(securities: SecurityView[], bench: Indicators = benchmark): ScreenContext {
  return { securities, benchmark: bench, regime: REGIME };
}

describe('momentumScreen', () => {
  it('surfaces a clear established uptrend as a BULLISH finding', () => {
    // return3m +12.4%, return6m +20%, rel strength +12.4% - +5% = +7.4%.
    const view = security(
      'AAA',
      ind({ asOf: '2026-08-17', above50dma: true, above200dma: true, return3m: 0.124, return6m: 0.2 }),
    );

    const findings = momentumScreen(context([view]));

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.symbol).toBe('AAA');
    expect(f.exposure).toBe('AAA');
    expect(f.direction).toBe('BULLISH');
    expect(f.hit.screen).toBe('momentum');
    expect(f.hit.direction).toBe('BULLISH');
    // Only qualifier → score normalizes to 1.
    expect(f.hit.score).toBe(1);
    expect(f.hit.rationale).toBe(
      'Established uptrend: +12.4% over 3m, above 50- and 200-day averages, +7.4% vs SPY',
    );
    expect(f.hit.evidence).toEqual(['AAA:bars:2026-08-17']);
  });

  it('excludes a security trading below its 200-day average', () => {
    const view = security(
      'BBB',
      ind({ asOf: '2026-08-17', above50dma: true, above200dma: false, return3m: 0.3, return6m: 0.3 }),
    );

    expect(momentumScreen(context([view]))).toEqual([]);
  });

  it('excludes a security with a null 3-month return (does not treat null as 0)', () => {
    // Trend booleans are fine, but return3m is missing — not the same as "flat".
    const view = security(
      'CCC',
      ind({ asOf: '2026-08-17', above50dma: true, above200dma: true, return3m: null, return6m: 0.3 }),
    );

    expect(momentumScreen(context([view]))).toEqual([]);
  });

  it('ranks two qualifiers by composite, strongest scoring highest', () => {
    // STRONG composite = avg(0.30, 0.40, 0.25) = 0.31667 (rel = 0.30 - 0.05).
    const strong = security(
      'STRONG',
      ind({ asOf: '2026-08-17', above50dma: true, above200dma: true, return3m: 0.3, return6m: 0.4 }),
    );
    // WEAK composite = avg(0.10, 0.12, 0.05) = 0.09 (rel = 0.10 - 0.05).
    const weak = security(
      'WEAK',
      ind({ asOf: '2026-08-17', above50dma: true, above200dma: true, return3m: 0.1, return6m: 0.12 }),
    );

    const findings = momentumScreen(context([weak, strong]));

    expect(findings).toHaveLength(2);
    // Sorted strongest first.
    expect(findings[0]!.symbol).toBe('STRONG');
    expect(findings[1]!.symbol).toBe('WEAK');
    // Min-max over {0.31667, 0.09}: max → 1, min → 0.
    expect(findings[0]!.hit.score).toBe(1);
    expect(findings[1]!.hit.score).toBe(0);
    expect(findings[0]!.hit.score).toBeGreaterThan(findings[1]!.hit.score);
  });

  it('returns [] for an empty context', () => {
    expect(momentumScreen(context([]))).toEqual([]);
  });
});
