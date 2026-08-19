/**
 * Pure grading maths for Stage 7 attribution — no database, no prices fetched
 * here, so the scoring logic can be tested with worked examples (CLAUDE.md
 * "anything computing a number Pete acts on gets a test").
 *
 * The service supplies a close-price lookup and the stored briefs; everything
 * else — forward returns, hit rate, per-screen rollup — is computed here.
 */
import type { AttributionRow, AttributionSummary, StoredBrief } from '@tradeit/shared';

export interface GradedPick {
  symbol: string;
  /** Forward return from the brief's entry to the latest close. */
  ret: number;
  /** The screens/signals that surfaced this name. */
  screens: string[];
}

export function aggregate(rets: number[]): { hitRate: number | null; avgReturn: number | null } {
  if (!rets.length) return { hitRate: null, avgReturn: null };
  const wins = rets.filter((r) => r > 0).length;
  const sum = rets.reduce((a, b) => a + b, 0);
  return { hitRate: wins / rets.length, avgReturn: sum / rets.length };
}

/**
 * Grade each brief's positions to a forward return. `closeOf` returns the latest
 * close we hold for a symbol, or null when we have no price — those are skipped,
 * never scored as zero.
 */
export function gradeBriefs(
  briefs: StoredBrief[],
  closeOf: (symbol: string) => number | null,
): GradedPick[] {
  const graded: GradedPick[] = [];
  for (const brief of briefs) {
    const screensBySymbol = new Map(
      brief.candidates.map((c) => [c.symbol, c.screens.map((s) => s.screen)]),
    );
    for (const pos of brief.portfolio.positions) {
      if (!(pos.entry > 0)) continue;
      const close = closeOf(pos.symbol);
      if (close == null) continue;
      graded.push({
        symbol: pos.symbol,
        ret: close / pos.entry - 1,
        screens: screensBySymbol.get(pos.symbol) ?? [],
      });
    }
  }
  return graded;
}

export function rollup(graded: GradedPick[], gradedBriefs: number, asOf: string): AttributionSummary {
  const overall = aggregate(graded.map((g) => g.ret));

  const byScreenMap = new Map<string, number[]>();
  for (const g of graded) {
    for (const screen of g.screens) {
      const arr = byScreenMap.get(screen) ?? [];
      arr.push(g.ret);
      byScreenMap.set(screen, arr);
    }
  }
  const byScreen: AttributionRow[] = [...byScreenMap]
    .map(([key, rets]) => ({ key, picks: rets.length, ...aggregate(rets) }))
    .sort((a, b) => (b.avgReturn ?? 0) - (a.avgReturn ?? 0));

  return {
    gradedBriefs,
    picks: graded.length,
    hitRate: overall.hitRate,
    avgReturn: overall.avgReturn,
    byScreen,
    asOf,
  };
}
