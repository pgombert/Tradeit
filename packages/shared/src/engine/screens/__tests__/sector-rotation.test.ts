import { describe, expect, it } from 'vitest';
import { sectorRotationScreen } from '../sector-rotation.js';
import type { ScreenContext, SecurityView } from '../types.js';
import type { Indicators } from '../../price-indicators.js';
import type { DossierRegime } from '../../../types/candidate.js';

/** All-null indicator reading, overridden field-by-field per fixture. */
function ind(partial: Partial<Indicators>): Indicators {
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
    ...partial,
  };
}

function sec(
  symbol: string,
  exposure: string,
  flags: { isSector: boolean; hasInverse: boolean; isLeveraged?: boolean },
  indicators: Indicators,
): SecurityView {
  return {
    symbol,
    exposure,
    isSector: flags.isSector,
    hasInverse: flags.hasInverse,
    isLeveraged: flags.isLeveraged ?? false,
    indicators,
  };
}

/** Regime is available to screens but sector-rotation never reads it. */
const REGIME: DossierRegime = {
  regime: 'CHOP',
  leverageAllowed: false,
  riskBudget: 0.03,
  asOf: '2026-08-14',
};

function context(securities: SecurityView[], benchmark: Indicators): ScreenContext {
  return { securities, benchmark, regime: REGIME };
}

// Benchmark (SPY): +2.0% over 3m, +1.0% over 1m.
const SPY = ind({ return3m: 0.02, return1m: 0.01 });

describe('sectorRotationScreen', () => {
  it('surfaces a sector outperforming SPY as BULLISH with the right numbers', () => {
    // XLK 3m return +8.2% → rs = 8.2% − 2.0% = +6.2% vs SPY.
    const ctx = context(
      [sec('XLK', 'TECH', { isSector: true, hasInverse: true }, ind({ return3m: 0.082 }))],
      SPY,
    );

    const findings = sectorRotationScreen(ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.symbol).toBe('XLK');
    expect(f.exposure).toBe('TECH');
    expect(f.direction).toBe('BULLISH');
    expect(f.hit.screen).toBe('sector-rotation');
    expect(f.hit.direction).toBe('BULLISH');
    // Only one emitted item → score 1.
    expect(f.hit.score).toBe(1);
    expect(f.hit.rationale).toBe('Sector leadership: +6.2% vs SPY over 3m');
    expect(f.hit.evidence).toEqual(['XLK:bars:2026-08-14']);
  });

  it('surfaces a lagging sector WITH an inverse as BEARISH', () => {
    // XLE 3m return −5.8% → rs = −5.8% − 2.0% = −7.8% vs SPY. Inverse exists.
    const ctx = context(
      [sec('XLE', 'ENERGY', { isSector: true, hasInverse: true }, ind({ return3m: -0.058 }))],
      SPY,
    );

    const findings = sectorRotationScreen(ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.symbol).toBe('XLE');
    expect(f.direction).toBe('BEARISH');
    expect(f.hit.direction).toBe('BEARISH');
    expect(f.hit.score).toBe(1); // single emitted item
    expect(f.hit.rationale).toBe('Sector laggard (inverse available): -7.8% vs SPY over 3m');
    expect(f.hit.evidence).toEqual(['XLE:bars:2026-08-14']);
  });

  it('does NOT emit a lagging sector with no inverse (unexpressible short)', () => {
    // XLU trails badly (rs = −6.0%) but the account cannot short it.
    const ctx = context(
      [sec('XLU', 'UTILITIES', { isSector: true, hasInverse: false }, ind({ return3m: -0.04 }))],
      SPY,
    );

    expect(sectorRotationScreen(ctx)).toEqual([]);
  });

  it('ignores a non-sector security even when it dominates the benchmark', () => {
    // A single-name stock, not a sector ETF — outside this screen's remit.
    const ctx = context(
      [sec('NVDA', 'SEMIS', { isSector: false, hasInverse: true }, ind({ return3m: 0.30 }))],
      SPY,
    );

    expect(sectorRotationScreen(ctx)).toEqual([]);
  });

  it('falls back to 1-month relative strength when 3-month is missing', () => {
    // XLF has no 3m history; on 1m it is +5.0% vs SPY's +1.0% → rs = +4.0%.
    const ctx = context(
      [
        sec(
          'XLF',
          'FINANCIALS',
          { isSector: true, hasInverse: true },
          ind({ return3m: null, return1m: 0.05 }),
        ),
      ],
      SPY,
    );

    const findings = sectorRotationScreen(ctx);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.direction).toBe('BULLISH');
    expect(f.hit.rationale).toBe('Sector leadership: +4.0% vs SPY over 1m');
  });

  it('returns [] for an empty context', () => {
    expect(sectorRotationScreen(context([], SPY))).toEqual([]);
  });

  it('ranks a leader and an inverse-backed laggard together, strongest magnitude first', () => {
    // XLK: rs = +6.2% (magnitude 0.062). XLE: rs = −7.8% (magnitude 0.078, inverse).
    // XLU: rs = −6.0% but no inverse → dropped. NVDA: not a sector → ignored.
    // Min-max over magnitudes {0.062, 0.078}: laggard → 1, leader → 0.
    const ctx = context(
      [
        sec('XLK', 'TECH', { isSector: true, hasInverse: true }, ind({ return3m: 0.082 })),
        sec('XLE', 'ENERGY', { isSector: true, hasInverse: true }, ind({ return3m: -0.058 })),
        sec('XLU', 'UTILITIES', { isSector: true, hasInverse: false }, ind({ return3m: -0.04 })),
        sec('NVDA', 'SEMIS', { isSector: false, hasInverse: true }, ind({ return3m: 0.30 })),
      ],
      SPY,
    );

    const findings = sectorRotationScreen(ctx);

    expect(findings.map((f) => f.symbol)).toEqual(['XLE', 'XLK']);
    expect(findings[0]!.direction).toBe('BEARISH');
    expect(findings[0]!.hit.score).toBe(1);
    expect(findings[1]!.direction).toBe('BULLISH');
    expect(findings[1]!.hit.score).toBe(0);
  });
});
