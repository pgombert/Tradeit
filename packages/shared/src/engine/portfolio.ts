/**
 * Stage 5 — portfolio construction. Turns ranked candidates into positions that
 * each carry a size, a stop, and a mandatory exit date, bounded by the week's
 * regime risk budget, per-position and leverage caps, and the drawdown breakers
 * (docs/PLAN.md §1/§5). Pure and deterministic: inputs in, a portfolio out.
 *
 * The stop is the return driver, not a safety rail (§1): a tight ATR stop against
 * a wider target (3:1 by default). Sizing is risk-based — each position risks an
 * equal slice of the weekly budget to its stop — which naturally shrinks a
 * leveraged or high-volatility position.
 *
 * NOTE (v1): the sizing arithmetic here is `number`, not `Decimal`. These are
 * advisory sizes on a research brief that Pete places by hand; no money is
 * accounted on them yet. When Stage 7 books real fills and P&L, this moves to
 * Decimal end-to-end (CLAUDE.md rule 2).
 */
import { MAX_LEVERAGED_BOOK_FRACTION, breakerFor, type BreakerLevel, type RiskLimits } from '../types/risk.js';
import type { Conviction, Direction } from './instrument-selection.js';
import type { Candidate, DossierRegime } from '../types/candidate.js';

/** ATR multiples: a tight stop against a wider runner — 3:1 by default. */
const STOP_ATR_MULT = 2;
const TARGET_ATR_MULT = 6;
/** Stop/target fractions when ATR is unavailable (short history). */
const DEFAULT_STOP_FRACTION = 0.06;
const DEFAULT_TARGET_FRACTION = 0.18;
/** How many positions the weekly risk budget is spread across. */
const MAX_POSITIONS = 8;
/** Hard cap on any one position as a fraction of book. */
const MAX_POSITION_FRACTION = 0.2;
/** Weekly holds — the mandatory exit date is this many calendar days out. */
const HORIZON_DAYS = 10;

/** The tradable vehicle for a candidate, with the price used to count shares. */
export interface PositionVehicle {
  symbol: string;
  leverageFactor: number;
  isInverse: boolean;
  /** Latest close of the vehicle itself (not the underlying). */
  price: number;
}

/** One candidate prepared for sizing: the underlying entry/ATR and its vehicle. */
export interface PositionInput {
  candidate: Candidate;
  /** Latest close of the screened (underlying) security — the stop/target basis. */
  entry: number;
  /** Underlying ATR(14), or null on a short history. */
  atr: number | null;
  vehicle: PositionVehicle;
}

export interface SizedPosition {
  symbol: string; // the underlying/screened security
  instrument: string; // the vehicle actually traded
  direction: Direction;
  conviction: Conviction;
  leveraged: boolean;
  /** Prices on the underlying — the decision triggers. */
  entry: number;
  stop: number;
  target: number;
  exitDate: string;
  /** Vehicle shares and the resulting book commitment. */
  shares: number;
  positionValue: number;
  riskDollars: number;
  bookFraction: number;
  rationale: string;
}

export interface PortfolioConfig {
  /** Book size to size against (settled equity, or the starting capital). */
  capital: number;
  /** Drawdown from peak, for the breaker ladder. 0 when unknown. */
  drawdown: number;
  regime: DossierRegime;
  limits: RiskLimits;
  /** The brief date; the exit date is computed from it. */
  asOf: string;
}

export interface Portfolio {
  positions: SizedPosition[];
  weeklyRiskBudget: number;
  breaker: BreakerLevel;
  capitalDeployed: number;
  leveragedFraction: number;
  notes: string[];
}

/** Add whole days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function empty(breaker: BreakerLevel, notes: string[]): Portfolio {
  return { positions: [], weeklyRiskBudget: 0, breaker, capitalDeployed: 0, leveragedFraction: 0, notes };
}

function sizeOne(
  input: PositionInput,
  perPositionRisk: number,
  cfg: PortfolioConfig,
  leverageHeadroom: number,
): SizedPosition | null {
  const { candidate, entry, atr, vehicle } = input;
  if (entry <= 0 || vehicle.price <= 0) return null;

  const stopFraction = atr && atr > 0 ? (STOP_ATR_MULT * atr) / entry : DEFAULT_STOP_FRACTION;
  const targetFraction = atr && atr > 0 ? (TARGET_ATR_MULT * atr) / entry : DEFAULT_TARGET_FRACTION;
  const long = candidate.direction === 'BULLISH';

  // Underlying decision triggers. A bearish view is invalidated by a rise.
  const stop = long ? entry * (1 - stopFraction) : entry * (1 + stopFraction);
  const target = long ? entry * (1 + targetFraction) : entry * (1 - targetFraction);

  // The vehicle moves leverageFactor× the underlying, so its risk per dollar of
  // notional is that much larger — which shrinks the position.
  const effectiveRiskFraction = stopFraction * vehicle.leverageFactor;
  if (effectiveRiskFraction <= 0) return null;

  let positionValue = Math.min(perPositionRisk / effectiveRiskFraction, MAX_POSITION_FRACTION * cfg.capital);
  // Keep the leveraged sleeve under its cap by trimming, not dropping.
  if (vehicle.leverageFactor > 1) positionValue = Math.min(positionValue, leverageHeadroom);
  if (positionValue <= 0) return null;

  const shares = Math.floor(positionValue / vehicle.price);
  if (shares <= 0) return null;

  const actualValue = shares * vehicle.price;
  const riskDollars = actualValue * effectiveRiskFraction;

  return {
    symbol: candidate.symbol,
    instrument: vehicle.symbol,
    direction: candidate.direction,
    conviction: candidate.conviction,
    leveraged: vehicle.leverageFactor > 1,
    entry,
    stop,
    target,
    exitDate: addDays(cfg.asOf, HORIZON_DAYS),
    shares,
    positionValue: actualValue,
    riskDollars,
    bookFraction: actualValue / cfg.capital,
    rationale:
      `${vehicle.symbol}${vehicle.leverageFactor > 1 ? ` (${vehicle.leverageFactor}x)` : ''}: ` +
      `risk ~$${riskDollars.toFixed(0)} to a ${(stopFraction * 100).toFixed(1)}% stop, ${(targetFraction / stopFraction).toFixed(1)}:1 target.`,
  };
}

/**
 * Build the week's portfolio. Honours the breaker ladder first (halve / pause /
 * hard stop), gates out Crisis, spreads the regime risk budget across the top
 * candidates, sizes each to an equal risk slice, and keeps the leveraged sleeve
 * within its cap.
 */
export function buildPortfolio(inputs: PositionInput[], cfg: PortfolioConfig): Portfolio {
  const breaker = breakerFor(cfg.drawdown, cfg.limits);
  if (breaker === 'HARD_STOP') {
    return empty(breaker, ['Drawdown hit the hard floor — program halted. No positions.']);
  }
  if (breaker === 'PAUSE_AND_REVIEW') {
    return empty(breaker, ['Drawdown breached the pause level — trading paused for review. No new positions.']);
  }
  if (cfg.regime.regime === 'CRISIS') {
    return empty(breaker, ['Crisis regime — no new positions this week.']);
  }

  const notes: string[] = [];
  const sizeMult = breaker === 'HALVE_SIZE' ? 0.5 : 1;
  if (breaker === 'HALVE_SIZE') notes.push('Drawdown breached the first breaker — position sizes halved.');

  const weeklyRisk = cfg.capital * cfg.regime.riskBudget * sizeMult;
  const selected = inputs.slice(0, MAX_POSITIONS);
  if (selected.length === 0) return empty(breaker, ['No candidates to size.']);

  const perPositionRisk = weeklyRisk / selected.length;
  const leverageCap = cfg.capital * MAX_LEVERAGED_BOOK_FRACTION;

  const positions: SizedPosition[] = [];
  let leveragedNotional = 0;
  for (const input of selected) {
    const headroom = leverageCap - leveragedNotional;
    const sized = sizeOne(input, perPositionRisk, cfg, headroom);
    if (!sized) continue;
    if (sized.leveraged) leveragedNotional += sized.positionValue;
    positions.push(sized);
  }

  if (leveragedNotional > 0) {
    notes.push(
      `Leveraged sleeve ${((leveragedNotional / cfg.capital) * 100).toFixed(1)}% of book (cap ${(MAX_LEVERAGED_BOOK_FRACTION * 100).toFixed(0)}%).`,
    );
  }

  const capitalDeployed = positions.reduce((s, p) => s + p.positionValue, 0);
  return {
    positions,
    weeklyRiskBudget: weeklyRisk,
    breaker,
    capitalDeployed,
    leveragedFraction: leveragedNotional / cfg.capital,
    notes,
  };
}
