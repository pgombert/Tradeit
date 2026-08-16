import { describe, expect, it } from 'vitest';
import { startDateFor, usableObservations } from '../collectors/fred.parse.js';

describe('usableObservations', () => {
  it('drops the "." placeholder FRED uses for a missing value', () => {
    const result = usableObservations([
      { date: '2026-08-10', value: '4.21' },
      { date: '2026-08-11', value: '.' },
      { date: '2026-08-12', value: '4.25' },
    ]);

    expect(result).toEqual([
      { date: '2026-08-10', value: '4.21' },
      { date: '2026-08-12', value: '4.25' },
    ]);
  });

  it('drops blank and whitespace-only values', () => {
    expect(
      usableObservations([
        { date: '2026-08-10', value: '' },
        { date: '2026-08-11', value: '   ' },
      ]),
    ).toEqual([]);
  });

  it('keeps a genuine zero', () => {
    // A real 0.00 reading is data, not a gap. Coercing it away would be as
    // wrong as coercing "." into a zero.
    expect(usableObservations([{ date: '2026-08-10', value: '0.00' }])).toEqual([
      { date: '2026-08-10', value: '0.00' },
    ]);
  });

  it('keeps negatives, which the 2s10s spread produces when inverted', () => {
    expect(usableObservations([{ date: '2026-08-10', value: '-0.43' }])).toEqual([
      { date: '2026-08-10', value: '-0.43' },
    ]);
  });

  it('preserves values as strings so no precision is lost', () => {
    const [point] = usableObservations([{ date: '2026-08-10', value: '4.2100' }]);
    expect(point?.value).toBe('4.2100');
  });
});

describe('startDateFor', () => {
  const now = new Date('2026-08-16T00:00:00Z');

  it('reaches back the full lookback on a first run', () => {
    expect(startDateFor(null, now, 5, 45)).toBe('2021-08-16');
  });

  it('re-requests a revision window behind the last point we hold', () => {
    // FRED revises recent points, so resuming exactly at lastObservedAt would
    // keep a stale value forever.
    expect(startDateFor(new Date('2026-08-14T00:00:00Z'), now, 5, 45)).toBe('2026-06-30');
  });

  it('crosses a month boundary correctly', () => {
    expect(startDateFor(new Date('2026-03-05T00:00:00Z'), now, 5, 45)).toBe('2026-01-19');
  });
});
