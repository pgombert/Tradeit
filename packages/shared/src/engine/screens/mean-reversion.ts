/**
 * Stage 1 screen — mean reversion (buy the dip, not the falling knife).
 *
 * We only want oversold securities whose *primary* trend is still up: a stock
 * above its 200-day that has been sold down to an oversold RSI is a pullback
 * within an uptrend, the kind that tends to bounce. An oversold stock *below*
 * its 200-day is a downtrend accelerating — a falling knife — and this screen
 * deliberately never surfaces it. Bullish only; there is no bearish dip.
 *
 * Pure, like every screen (see ./types.ts): same context in → same findings
 * out. Null indicators mean "we couldn't compute it honestly" and are never
 * coerced to zero — a null RSI is unknown, not oversold.
 */
import type { ScreenContext, ScreenFinding, Screen } from './types.js';
import type { Indicators } from '../price-indicators.js';

const SCREEN = 'mean-reversion';

/** RSI below this is "oversold". Wilder's classic threshold is 30; we use a
 * slightly looser 35 so a shallow, tradeable dip in a strong uptrend qualifies
 * before it has to collapse all the way to 30. */
const OVERSOLD_RSI = 35;

/** Cap on the pullback-depth bonus, so a deep drawdown nudges the rank without
 * ever swamping the RSI signal that is the core of the screen. */
const MAX_PULLBACK_BONUS = 0.3;

/** Numbers to 1 decimal percent; "-8.3%" from a fraction like -0.0831. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Score a qualifier so that more oversold ranks higher. Base is how far RSI has
 * fallen past the threshold, normalised to 0..~1 (RSI 35 → 0, RSI 5 → ~0.86).
 * A pullback from the trailing high adds a small bounded term — a dip that has
 * actually retraced is a better mean-reversion setup than one that has not.
 * `drawdownFromHigh` is ≤ 0, so its magnitude is `-drawdownFromHigh`.
 */
function scoreQualifier(rsi14: number, drawdownFromHigh: number | null): number {
  const base = (OVERSOLD_RSI - rsi14) / OVERSOLD_RSI;
  const pullbackBonus =
    drawdownFromHigh === null ? 0 : Math.min(MAX_PULLBACK_BONUS, -drawdownFromHigh);
  const score = base + pullbackBonus;
  // Clamp to 0..1: base is ≥ 0 for any qualifier (rsi < 35), but the bonus can
  // push it past 1, and we never emit a score outside the screen's contract.
  return Math.max(0, Math.min(1, score));
}

/** A security qualifies only if its primary trend is intact *and* it is oversold. */
function qualifies(ind: Indicators): boolean {
  // above200dma must be exactly true (null = unknown history, false = downtrend).
  if (ind.above200dma !== true) return false;
  // A null RSI is unknown, not oversold — never treat it as 0.
  if (ind.rsi14 === null) return false;
  return ind.rsi14 < OVERSOLD_RSI;
}

export const meanReversionScreen: Screen = (ctx: ScreenContext): ScreenFinding[] => {
  const findings: ScreenFinding[] = [];

  for (const sec of ctx.securities) {
    const ind = sec.indicators;
    if (!qualifies(ind)) continue;

    // qualifies() guarantees these are non-null; read them into locals so the
    // rationale and score work with plain numbers.
    const rsi14 = ind.rsi14!;
    const score = scoreQualifier(rsi14, ind.drawdownFromHigh);

    const pullbackPhrase =
      ind.drawdownFromHigh === null
        ? ''
        : `, ${pct(ind.drawdownFromHigh)} from 6-month high`;
    const rationale = `Oversold in uptrend: RSI ${rsi14.toFixed(0)}, above 200-day${pullbackPhrase}`;

    findings.push({
      symbol: sec.symbol,
      exposure: sec.exposure,
      direction: 'BULLISH',
      hit: {
        screen: SCREEN,
        score,
        direction: 'BULLISH',
        rationale,
        evidence: [`${sec.symbol}:bars:${ind.asOf}`],
      },
    });
  }

  // Most oversold (highest score) first.
  findings.sort((a, b) => b.hit.score - a.hit.score);
  return findings;
};
