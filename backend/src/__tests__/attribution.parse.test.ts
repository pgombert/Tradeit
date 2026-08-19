import { describe, expect, it } from 'vitest';
import type { StoredBrief } from '@tradeit/shared';
import { aggregate, gradeBriefs, rollup } from '../services/attribution.parse.js';

/** A stored brief with just the fields attribution reads. */
function brief(
  positions: { symbol: string; entry: number }[],
  screens: Record<string, string[]> = {},
): StoredBrief {
  return {
    asOf: '2026-08-01',
    generatedAt: '2026-08-01T00:00:00Z',
    regime: {} as StoredBrief['regime'],
    candidates: Object.entries(screens).map(([symbol, names]) => ({
      symbol,
      screens: names.map((screen) => ({ screen })),
    })) as unknown as StoredBrief['candidates'],
    analysed: [],
    portfolio: { positions } as unknown as StoredBrief['portfolio'],
    narrativeIdeas: [],
    aiRan: true,
  };
}

describe('aggregate', () => {
  it('is null on no picks, never zero', () => {
    expect(aggregate([])).toEqual({ hitRate: null, avgReturn: null });
  });

  it('computes hit rate and mean return', () => {
    // +10%, -5%, +3% → 2 of 3 winners, mean 2.6667%
    const out = aggregate([0.1, -0.05, 0.03]);
    expect(out.hitRate).toBeCloseTo(2 / 3, 6);
    expect(out.avgReturn).toBeCloseTo(0.08 / 3, 6);
  });
});

describe('gradeBriefs', () => {
  const closes: Record<string, number> = { NVDA: 110, GM: 45 };
  const closeOf = (s: string) => closes[s] ?? null;

  it('grades entry→close as a forward return', () => {
    const graded = gradeBriefs([brief([{ symbol: 'NVDA', entry: 100 }])], closeOf);
    expect(graded).toHaveLength(1);
    expect(graded[0]).toMatchObject({ symbol: 'NVDA' });
    expect(graded[0]?.ret).toBeCloseTo(0.1, 6); // 110/100 - 1
  });

  it('skips a position with no price rather than scoring it zero', () => {
    const graded = gradeBriefs([brief([{ symbol: 'ZZZ', entry: 50 }])], closeOf);
    expect(graded).toEqual([]);
  });

  it('skips a non-positive entry', () => {
    const graded = gradeBriefs([brief([{ symbol: 'NVDA', entry: 0 }])], closeOf);
    expect(graded).toEqual([]);
  });

  it('attaches the screens that surfaced the name', () => {
    const graded = gradeBriefs(
      [brief([{ symbol: 'GM', entry: 50 }], { GM: ['momentum', 'narrative'] })],
      closeOf,
    );
    expect(graded[0]?.screens).toEqual(['momentum', 'narrative']);
  });
});

describe('rollup', () => {
  it('rolls overall and per-screen, ranking screens by avg return', () => {
    const graded = [
      { symbol: 'A', ret: 0.2, screens: ['narrative', 'momentum'] },
      { symbol: 'B', ret: -0.1, screens: ['momentum'] },
    ];
    const out = rollup(graded, 1, '2026-08-01');
    expect(out.picks).toBe(2);
    expect(out.hitRate).toBeCloseTo(0.5, 6);
    expect(out.avgReturn).toBeCloseTo(0.05, 6);
    // narrative (only the +0.2 pick) outranks momentum (mean of +0.2 and -0.1)
    expect(out.byScreen[0]?.key).toBe('narrative');
    expect(out.byScreen[0]?.avgReturn).toBeCloseTo(0.2, 6);
  });

  it('is empty and null, not zero, with no graded picks', () => {
    const out = rollup([], 0, '2026-08-01');
    expect(out).toMatchObject({ picks: 0, hitRate: null, avgReturn: null, byScreen: [] });
  });
});
