import { instrumentsForExposure, type InstrumentDef } from '../constants/instruments.js';
import type { MarketRegime } from '../types/risk.js';

/**
 * Stage 5 — turning a view into something we can actually buy.
 *
 * The engine upstream produces a *direction* on an *exposure*. It never names a
 * ticker, because two account constraints decide the instrument:
 *
 *  - The retirement account cannot short, so a bearish view is expressed as a
 *    long position in an inverse ETF (docs/PLAN.md §2).
 *  - Leveraged products are eligible only in Risk-On Trend and only above a
 *    conviction bar, because their daily reset punishes chop (§1).
 */

export type Direction = 'BULLISH' | 'BEARISH';

/** 1 (weakest) to 5 (strongest), as returned by the Stage 3 analyst pass. */
export type Conviction = 1 | 2 | 3 | 4 | 5;

/** Leverage is reserved for the strongest views, not merely permitted ones. */
export const LEVERAGE_CONVICTION_FLOOR = 4;

export interface SelectionRequest {
  exposure: string;
  direction: Direction;
  conviction: Conviction;
  regime: MarketRegime;
}

export interface SelectionResult {
  instrument: InstrumentDef;
  /** Why this instrument and not the leveraged or unleveraged alternative. */
  reason: string;
  usedLeverage: boolean;
}

export interface SelectionFailure {
  instrument: null;
  reason: string;
  usedLeverage: false;
}

export type Selection = SelectionResult | SelectionFailure;

function pick(candidates: InstrumentDef[], leveraged: boolean): InstrumentDef | undefined {
  return candidates.find(
    (i) => i.liquid && (leveraged ? i.leverageFactor > 1 : i.leverageFactor === 1),
  );
}

export function selectInstrument(req: SelectionRequest): Selection {
  if (req.regime === 'CRISIS') {
    return {
      instrument: null,
      reason: 'Crisis regime — no new positions.',
      usedLeverage: false,
    };
  }

  const family = instrumentsForExposure(req.exposure);
  if (family.length === 0) {
    return {
      instrument: null,
      reason: `No instrument covers the exposure "${req.exposure}".`,
      usedLeverage: false,
    };
  }

  // The account cannot short. A bearish view is a long inverse position.
  const wantInverse = req.direction === 'BEARISH';
  const matching = family.filter((i) => i.isInverse === wantInverse);

  if (matching.length === 0) {
    return {
      instrument: null,
      reason: wantInverse
        ? `No inverse product covers "${req.exposure}", and the account cannot short.`
        : `No long product covers "${req.exposure}".`,
      usedLeverage: false,
    };
  }

  const leverageEligible =
    req.regime === 'RISK_ON_TREND' && req.conviction >= LEVERAGE_CONVICTION_FLOOR;

  if (leverageEligible) {
    const leveraged = pick(matching, true);
    if (leveraged) {
      return {
        instrument: leveraged,
        reason: `Risk-On Trend with conviction ${req.conviction} — leveraged expression permitted.`,
        usedLeverage: true,
      };
    }
  }

  const plain = pick(matching, false);
  if (plain) {
    let reason: string;
    if (req.regime !== 'RISK_ON_TREND') {
      reason = `Unleveraged — leveraged products are gated to Risk-On Trend, and the regime is ${req.regime.replace(/_/g, ' ').toLowerCase()}.`;
    } else if (req.conviction < LEVERAGE_CONVICTION_FLOOR) {
      reason = `Unleveraged — conviction ${req.conviction} is below the leverage floor of ${LEVERAGE_CONVICTION_FLOOR}.`;
    } else {
      reason = 'Unleveraged — no liquid leveraged product covers this exposure.';
    }
    return { instrument: plain, reason, usedLeverage: false };
  }

  // Only a leveraged product exists, but leverage isn't permitted right now.
  return {
    instrument: null,
    reason: `Only leveraged products cover "${req.exposure}", and leverage is not permitted in the current regime.`,
    usedLeverage: false,
  };
}
