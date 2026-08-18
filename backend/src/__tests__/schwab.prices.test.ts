import { describe, expect, it } from 'vitest';
import {
  ADV_WINDOW,
  averageDollarVolume,
  buildPriceHistoryPath,
  candleDate,
  historyStartMs,
  INITIAL_LOOKBACK_DAYS,
  isUsableCandle,
  REVISION_WINDOW_DAYS,
  securitySeeds,
  toBars,
  type ParsedBar,
  type SchwabCandle,
} from '../collectors/schwab.prices.parse.js';

function candle(overrides: Partial<SchwabCandle> = {}): SchwabCandle {
  return {
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1_000_000,
    datetime: Date.UTC(2026, 7, 17, 4, 0), // 2026-08-17
    ...overrides,
  };
}

describe('candleDate', () => {
  it('reduces an epoch-ms timestamp to that UTC calendar date', () => {
    expect(candleDate(Date.UTC(2026, 7, 17, 4, 30)).toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });
});

describe('isUsableCandle', () => {
  it('accepts a fully-formed candle and rejects one with a bad field', () => {
    expect(isUsableCandle(candle())).toBe(true);
    expect(isUsableCandle(candle({ close: Number.NaN }))).toBe(false);
    expect(isUsableCandle(candle({ datetime: Number.POSITIVE_INFINITY }))).toBe(false);
  });
});

describe('toBars', () => {
  it('maps candles to bars with string prices and BigInt volume, dropping bad ones', () => {
    const bars = toBars([candle(), candle({ volume: Number.NaN })]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({
      date: new Date('2026-08-17T00:00:00.000Z'),
      open: '10',
      high: '11',
      low: '9',
      close: '10.5',
      volume: 1_000_000n,
    });
  });

  it('truncates fractional volume dust before converting to BigInt', () => {
    expect(toBars([candle({ volume: 1234.9 })])[0]?.volume).toBe(1234n);
  });
});

describe('buildPriceHistoryPath', () => {
  it('requests daily bars for the symbol over the window, no extended hours', () => {
    const path = buildPriceHistoryPath('spy', 1000, 2000);
    const url = new URL(`https://api.schwabapi.com/marketdata/v1${path}`);
    expect(url.pathname).toBe('/marketdata/v1/pricehistory');
    expect(url.searchParams.get('symbol')).toBe('SPY');
    expect(url.searchParams.get('frequencyType')).toBe('daily');
    expect(url.searchParams.get('startDate')).toBe('1000');
    expect(url.searchParams.get('endDate')).toBe('2000');
    expect(url.searchParams.get('needExtendedHoursData')).toBe('false');
  });
});

describe('historyStartMs', () => {
  const now = new Date('2026-08-17T00:00:00Z');
  const dayMs = 24 * 60 * 60 * 1000;

  it('reaches back a year the first time it sees a symbol', () => {
    expect(historyStartMs(null, now)).toBe(now.getTime() - INITIAL_LOOKBACK_DAYS * dayMs);
  });

  it('re-requests a short tail behind the last bar on an incremental run', () => {
    const last = new Date('2026-08-15T00:00:00Z');
    expect(historyStartMs(last, now)).toBe(last.getTime() - REVISION_WINDOW_DAYS * dayMs);
  });
});

describe('averageDollarVolume', () => {
  it('averages close × volume over recent bars, in Decimal', () => {
    // Two bars: 10×100 = 1000, 20×300 = 6000 → mean 3500.00
    const bars: ParsedBar[] = [
      { date: new Date(), open: '9', high: '11', low: '8', close: '10', volume: 100n },
      { date: new Date(), open: '18', high: '21', low: '17', close: '20', volume: 300n },
    ];
    expect(averageDollarVolume(bars)).toBe('3500.00');
  });

  it('only averages the trailing window, not the whole history', () => {
    // ADV_WINDOW+1 bars; the oldest is huge and must be excluded.
    const bars: ParsedBar[] = [
      { date: new Date(), open: '0', high: '0', low: '0', close: '1000000', volume: 1000000n },
      ...Array.from({ length: ADV_WINDOW }, () => ({
        date: new Date(),
        open: '10',
        high: '10',
        low: '10',
        close: '10',
        volume: 100n,
      })),
    ];
    // Trailing window is all 10×100 = 1000 → mean 1000.00, unaffected by the spike.
    expect(averageDollarVolume(bars)).toBe('1000.00');
  });

  it('returns null when there are no bars', () => {
    expect(averageDollarVolume([])).toBeNull();
  });
});

describe('securitySeeds', () => {
  it('derives one seed per instrument, carrying leverage and inverse flags', () => {
    const seeds = securitySeeds();
    expect(seeds.length).toBeGreaterThan(0);

    const spy = seeds.find((s) => s.symbol === 'SPY');
    expect(spy).toMatchObject({ assetClass: 'ETF', leverageFactor: 1, isInverse: false });

    const sqqq = seeds.find((s) => s.symbol === 'SQQQ');
    expect(sqqq).toMatchObject({ assetClass: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true });
  });
});
