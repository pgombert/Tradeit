/**
 * Merge the Stage 1 screens' findings into a ranked list of candidates. Pure:
 * findings in, candidates out — no DB, no clock, no randomness.
 *
 * Two jobs beyond grouping:
 *   - the validation anchor (CLAUDE.md rule 1): a symbol that does not resolve
 *     to a known instrument is dropped, never carried forward;
 *   - conviction: more confirming screens and higher scores → higher conviction
 *     (1..5), which is what gates leverage eligibility at Stage 5.
 */
import { instrumentBySymbol } from '../../constants/instruments.js';
import type { Conviction, Direction } from '../instrument-selection.js';
import type { Candidate, ScreenHit } from '../../types/candidate.js';
import type { ScreenFinding } from './types.js';

export interface AggregateOptions {
  /** Cap on the returned list. Default 40 (the plan's Stage 1 upper bound). */
  maxCandidates?: number;
  /**
   * The validation anchor (CLAUDE.md rule 1). A symbol that fails this is
   * dropped. Defaults to "resolves to a known instrument"; the service passes a
   * predicate over the real `securities` table so single stocks validate too.
   */
  isValidSymbol?: (symbol: string) => boolean;
}

/** The strongest single screen score behind a candidate — the ranking tiebreak. */
function topScore(hits: ScreenHit[]): number {
  return hits.reduce((m, h) => Math.max(m, h.score), 0);
}

/**
 * Conviction 1..5 from the confirming screens: one screen is a lead (2), two
 * agreeing is corroboration (3), three-plus is a strong stack (4); a high
 * average score across them adds one, a lone weak signal drops to 1.
 */
function convictionFor(hits: ScreenHit[]): Conviction {
  const n = hits.length;
  const avg = hits.reduce((s, h) => s + h.score, 0) / n;
  let c = n >= 3 ? 4 : n === 2 ? 3 : 2;
  if (avg >= 0.66) c += 1;
  if (n === 1 && avg < 0.2) c = 1;
  const clamped = Math.max(1, Math.min(5, c));
  return clamped as Conviction;
}

/**
 * Group findings by symbol, resolve a single direction per symbol (the side with
 * the higher summed score when screens disagree), score conviction, and drop any
 * symbol that doesn't resolve to an instrument. Returns candidates ranked by
 * conviction then strongest screen score, capped at `maxCandidates`.
 */
export function aggregateCandidates(
  findings: ScreenFinding[],
  asOf: string,
  opts: AggregateOptions = {},
): Candidate[] {
  const isValidSymbol = opts.isValidSymbol ?? ((s: string) => Boolean(instrumentBySymbol(s)));
  const bySymbol = new Map<string, ScreenFinding[]>();
  for (const f of findings) {
    // Validation anchor: only symbols that resolve to real data survive.
    if (!isValidSymbol(f.symbol)) continue;
    const arr = bySymbol.get(f.symbol) ?? [];
    arr.push(f);
    bySymbol.set(f.symbol, arr);
  }

  const candidates: Candidate[] = [];
  for (const [symbol, fs] of bySymbol) {
    // When screens disagree on direction, the higher summed score wins.
    const scoreByDir = new Map<Direction, number>();
    for (const f of fs) {
      scoreByDir.set(f.direction, (scoreByDir.get(f.direction) ?? 0) + f.hit.score);
    }
    const direction = [...scoreByDir.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const hits = fs.filter((f) => f.direction === direction).map((f) => f.hit);

    candidates.push({
      symbol,
      exposure: fs[0]!.exposure,
      direction,
      conviction: convictionFor(hits),
      screens: hits,
      asOf,
    });
  }

  candidates.sort((a, b) => b.conviction - a.conviction || topScore(b.screens) - topScore(a.screens));
  const cap = opts.maxCandidates ?? 40;
  return candidates.slice(0, cap);
}
