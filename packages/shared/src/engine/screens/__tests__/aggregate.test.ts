import { describe, expect, it } from 'vitest';
import { aggregateCandidates } from '../aggregate.js';
import type { ScreenFinding } from '../types.js';
import type { Direction } from '../../instrument-selection.js';

let n = 0;
function finding(
  symbol: string,
  exposure: string,
  direction: Direction,
  screen: string,
  score: number,
): ScreenFinding {
  return {
    symbol,
    exposure,
    direction,
    hit: { screen, score, direction, rationale: `${screen} ${symbol}`, evidence: [`${symbol}:bars:2026-08-17`] },
  };
}

describe('aggregateCandidates', () => {
  const asOf = '2026-08-17';

  it('merges multiple screen hits on one symbol into a single candidate', () => {
    const out = aggregateCandidates(
      [
        finding('SPY', 'SP500', 'BULLISH', 'momentum', 0.8),
        finding('SPY', 'SP500', 'BULLISH', 'mean-reversion', 0.7),
      ],
      asOf,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ symbol: 'SPY', exposure: 'SP500', direction: 'BULLISH' });
    expect(out[0]?.screens).toHaveLength(2);
    // two agreeing screens (n=2 → 3) + high avg score (0.75 ≥ .66 → +1) = 4
    expect(out[0]?.conviction).toBe(4);
  });

  it('drops a symbol that does not resolve to an instrument (validation anchor)', () => {
    const out = aggregateCandidates([finding('ZZZZ', 'MYSTERY', 'BULLISH', 'momentum', 0.9)], asOf);
    expect(out).toEqual([]);
  });

  it('resolves a direction conflict to the higher summed score, keeping only those hits', () => {
    const out = aggregateCandidates(
      [
        finding('SMH', 'SEMIS', 'BULLISH', 'momentum', 0.9),
        finding('SMH', 'SEMIS', 'BEARISH', 'sector-rotation', 0.3),
      ],
      asOf,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.direction).toBe('BULLISH');
    expect(out[0]?.screens).toHaveLength(1);
    expect(out[0]?.screens[0]?.screen).toBe('momentum');
  });

  it('ranks a strongly-confirmed candidate above a lone weak one', () => {
    const out = aggregateCandidates(
      [
        finding('XLF', 'FINANCIALS', 'BULLISH', 'momentum', 0.15), // lone weak → conviction 1
        finding('XLK', 'TECH', 'BULLISH', 'momentum', 0.9),
        finding('XLK', 'TECH', 'BULLISH', 'mean-reversion', 0.85),
        finding('XLK', 'TECH', 'BULLISH', 'sector-rotation', 0.8), // 3 strong → conviction 5
      ],
      asOf,
    );
    expect(out.map((c) => c.symbol)).toEqual(['XLK', 'XLF']);
    expect(out[0]?.conviction).toBe(5);
    expect(out[1]?.conviction).toBe(1);
  });

  it('honours the maxCandidates cap', () => {
    const out = aggregateCandidates(
      [
        finding('SPY', 'SP500', 'BULLISH', 'momentum', 0.9),
        finding('QQQ', 'NASDAQ100', 'BULLISH', 'momentum', 0.5),
      ],
      asOf,
      { maxCandidates: 1 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('SPY');
  });
});
