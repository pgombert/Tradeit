import { describe, expect, it } from 'vitest';
import {
  earningsRef,
  earningsWindow,
  usableEarnings,
  type RawEarnings,
} from '../collectors/earnings.parse.js';

describe('earningsWindow', () => {
  const now = new Date('2026-08-16T00:00:00Z');

  it('runs from today forward the requested number of days', () => {
    expect(earningsWindow(now, 14)).toEqual({ from: '2026-08-16', to: '2026-08-30' });
  });

  it('crosses a month boundary correctly', () => {
    expect(earningsWindow(new Date('2026-08-25T00:00:00Z'), 14)).toEqual({
      from: '2026-08-25',
      to: '2026-09-08',
    });
  });
});

describe('usableEarnings', () => {
  it('drops rows missing a symbol or a date — nothing to key or cite', () => {
    const rows: RawEarnings[] = [
      { date: '2026-08-18', symbol: 'AAPL' },
      { date: '2026-08-18', symbol: '   ' },
      { date: '', symbol: 'MSFT' },
    ];
    expect(usableEarnings(rows).map((e) => e.symbol)).toEqual(['AAPL']);
  });

  it('upper-cases the symbol so it can resolve to a Security later', () => {
    const [event] = usableEarnings([{ date: '2026-08-18', symbol: 'nvda' }]);
    expect(event?.symbol).toBe('NVDA');
  });

  it('preserves a missing estimate as null, never as zero', () => {
    // A company with no published estimate is not a company estimated to earn
    // zero — the same reasoning as the FRED "." placeholder.
    const [event] = usableEarnings([{ date: '2026-08-18', symbol: 'AAPL' }]);
    expect(event?.epsEstimate).toBeNull();
    expect(event?.revenueEstimate).toBeNull();
  });

  it('keeps a genuine zero estimate', () => {
    const [event] = usableEarnings([{ date: '2026-08-18', symbol: 'AAPL', epsEstimate: 0 }]);
    expect(event?.epsEstimate).toBe(0);
  });

  it('carries through the reporting time and quarter metadata', () => {
    const [event] = usableEarnings([
      { date: '2026-08-18', symbol: 'AAPL', hour: 'amc', quarter: 3, year: 2026, epsEstimate: 1.09 },
    ]);
    expect(event).toMatchObject({
      symbol: 'AAPL',
      date: '2026-08-18',
      hour: 'amc',
      quarter: 3,
      year: 2026,
      epsEstimate: 1.09,
    });
  });
});

describe('earningsRef', () => {
  it('keys on symbol and date, unique per report', () => {
    const [event] = usableEarnings([{ date: '2026-08-18', symbol: 'AAPL' }]);
    expect(event && earningsRef(event)).toBe('AAPL:2026-08-18');
  });
});
