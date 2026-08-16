import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../constants/instruments.js';
import { selectInstrument } from '../engine/instrument-selection.js';

describe('selectInstrument', () => {
  it('expresses a bearish view as a long inverse ETF, never a short', () => {
    // The retirement account cannot short — see docs/PLAN.md §2.
    const s = selectInstrument({
      exposure: 'SP500',
      direction: 'BEARISH',
      conviction: 3,
      regime: 'CHOP',
    });

    expect(s.instrument?.symbol).toBe('SH');
    expect(s.instrument?.isInverse).toBe(true);
    expect(s.usedLeverage).toBe(false);
  });

  it('uses a leveraged product only in Risk-On Trend with high conviction', () => {
    const s = selectInstrument({
      exposure: 'SEMIS',
      direction: 'BULLISH',
      conviction: 5,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument?.symbol).toBe('SOXL');
    expect(s.usedLeverage).toBe(true);
  });

  it('refuses leverage in Chop even at maximum conviction', () => {
    // Daily reset punishes chop regardless of direction.
    const s = selectInstrument({
      exposure: 'SEMIS',
      direction: 'BULLISH',
      conviction: 5,
      regime: 'CHOP',
    });

    expect(s.instrument?.symbol).toBe('SMH');
    expect(s.usedLeverage).toBe(false);
    expect(s.reason).toContain('Risk-On Trend');
  });

  it('refuses leverage below the conviction floor even in Risk-On Trend', () => {
    const s = selectInstrument({
      exposure: 'SEMIS',
      direction: 'BULLISH',
      conviction: 3,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument?.symbol).toBe('SMH');
    expect(s.usedLeverage).toBe(false);
    expect(s.reason).toContain('conviction 3');
  });

  it('picks the leveraged inverse for a high-conviction bearish view in a trend', () => {
    const s = selectInstrument({
      exposure: 'NASDAQ100',
      direction: 'BEARISH',
      conviction: 5,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument?.symbol).toBe('SQQQ');
    expect(s.usedLeverage).toBe(true);
  });

  it('takes no position at all in a crisis', () => {
    const s = selectInstrument({
      exposure: 'SP500',
      direction: 'BULLISH',
      conviction: 5,
      regime: 'CRISIS',
    });

    expect(s.instrument).toBeNull();
    expect(s.reason).toContain('Crisis');
  });

  it('rejects an exposure nothing covers rather than guessing', () => {
    const s = selectInstrument({
      exposure: 'URANIUM',
      direction: 'BULLISH',
      conviction: 4,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument).toBeNull();
    expect(s.reason).toContain('URANIUM');
  });

  it('rejects a bearish view on an exposure with no inverse product', () => {
    const s = selectInstrument({
      exposure: 'GOLD',
      direction: 'BEARISH',
      conviction: 4,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument).toBeNull();
    expect(s.reason).toContain('cannot short');
  });

  it('only ever returns liquid instruments', () => {
    for (const exposure of [...new Set(INSTRUMENTS.map((i) => i.exposure))]) {
      for (const direction of ['BULLISH', 'BEARISH'] as const) {
        const s = selectInstrument({ exposure, direction, conviction: 5, regime: 'RISK_ON_TREND' });
        if (s.instrument) expect(s.instrument.liquid).toBe(true);
      }
    }
  });
});

describe('instrument universe', () => {
  it('contains no options or shortable products', () => {
    for (const i of INSTRUMENTS) {
      expect(['EQUITY', 'ETF', 'LEVERAGED_ETF', 'INVERSE_ETF']).toContain(i.class);
    }
  });

  it('has unique symbols', () => {
    const symbols = INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('labels every leveraged product with a factor above one', () => {
    for (const i of INSTRUMENTS) {
      if (i.class === 'LEVERAGED_ETF') expect(i.leverageFactor).toBeGreaterThan(1);
      if (i.class === 'ETF') expect(i.leverageFactor).toBe(1);
    }
  });

  it('gives every leveraged long an unleveraged fallback', () => {
    // Otherwise a bullish view would become untradable the moment the regime
    // turns and leverage is gated off.
    const leveragedLongs = INSTRUMENTS.filter((i) => i.leverageFactor > 1 && !i.isInverse);
    for (const l of leveragedLongs) {
      const fallback = INSTRUMENTS.find(
        (i) => i.exposure === l.exposure && !i.isInverse && i.leverageFactor === 1,
      );
      expect(fallback, `${l.symbol} (${l.exposure}) has no unleveraged fallback`).toBeDefined();
    }
  });

  it('has unleveraged inverse cover for the broad indices', () => {
    for (const exposure of ['SP500', 'NASDAQ100', 'RUSSELL2000']) {
      const fallback = INSTRUMENTS.find(
        (i) => i.exposure === exposure && i.isInverse && i.leverageFactor === 1,
      );
      expect(fallback, `${exposure} has no unleveraged inverse`).toBeDefined();
    }
  });
});

describe('the sector inverse gap', () => {
  // No liquid *unleveraged* inverse ETF exists for semis, biotech or financials
  // — the only bearish sector products are 3x. That is a fact about the market,
  // not an omission from the table. It means a bearish sector view outside
  // Risk-On Trend has nothing to buy.
  const gapped = ['SEMIS', 'BIOTECH', 'FINANCIALS'];

  it('has no unleveraged inverse for these sectors', () => {
    for (const exposure of gapped) {
      const unleveragedInverse = INSTRUMENTS.find(
        (i) => i.exposure === exposure && i.isInverse && i.leverageFactor === 1,
      );
      expect(unleveragedInverse).toBeUndefined();
    }
  });

  it('declines the trade rather than substituting a different exposure', () => {
    // Quietly swapping in a broad-index inverse would change what is owned and
    // corrupt per-signal attribution later. Declining is the honest answer.
    for (const exposure of gapped) {
      const s = selectInstrument({
        exposure,
        direction: 'BEARISH',
        conviction: 5,
        regime: 'CHOP',
      });

      expect(s.instrument, `${exposure} should decline in Chop`).toBeNull();
      expect(s.reason).toContain('leverage is not permitted');
    }
  });

  it('still allows the leveraged inverse when the regime does permit it', () => {
    const s = selectInstrument({
      exposure: 'SEMIS',
      direction: 'BEARISH',
      conviction: 5,
      regime: 'RISK_ON_TREND',
    });

    expect(s.instrument?.symbol).toBe('SOXS');
    expect(s.usedLeverage).toBe(true);
  });
});
