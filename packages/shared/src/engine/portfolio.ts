/**
 * Stage 5 — portfolio construction, momentum-concentration model (docs/PLAN.md §1/§5).
 *
 * The strategy is nimble momentum on a $100k book: concentrate hard on the
 * strongest setups (up to the whole book on a standout), ride winners with a
 * trailing exit, cut losers fast with an initial stop, and *dodge the scheduled
 * landmines* — never hold a concentrated position into an earnings date, since a
 * stop can't protect through an overnight gap. Black swans are the accepted tail.
 *
 * Deployment scales with the regime (full in Risk-On, tapering to zero in Crisis)
 * and is throttled by the drawdown breaker ladder.
 *
 * Pure and deterministic. NOTE (v1): sizing is `number`, not `Decimal` — advisory
 * sizes on a research brief Pete places by hand; moves to Decimal at Stage 7.
 */
import { breakerFor, type BreakerLevel, type RiskLimits, type MarketRegime } from '../types/risk.js';
import type { Conviction, Direction } from './instrument-selection.js';
import type { Candidate, DossierRegime } from '../types/candidate.js';

/** How hard to concentrate: weight ∝ strength^power. Higher → the leader dominates. */
const CONCENTRATION_POWER = 2.5;
/** At most this many names carry the book at once. */
const MAX_POSITIONS = 5;
/** Initial stop distance, in ATRs — tight enough to cut a loser fast. */
const STOP_ATR_MULT = 2.5;
/** Fallback stop fraction when ATR is unavailable. */
const DEFAULT_STOP_FRACTION = 0.08;
/** The trailing exit reference — ride while above it. */
const TRAIL_MA = 20;
/** Fraction of the book deployed by regime, before the breaker throttles it. */
const DEPLOY_BY_REGIME: Record<MarketRegime, number> = {
  RISK_ON_TREND: 1.0,
  CHOP: 0.5,
  RISK_OFF: 0.25,
  CRISIS: 0,
};

export interface PositionVehicle {
  symbol: string;
  leverageFactor: number;
  isInverse: boolean;
  price: number;
}

export interface PositionInput {
  candidate: Candidate;
  /** Latest close of the screened security — the stop basis. */
  entry: number;
  atr: number | null;
  vehicle: PositionVehicle;
  /** Concentration weight basis: conviction blended with momentum (larger = bigger). */
  strength: number;
  /** A scheduled binary event (earnings) falls inside the intended hold. */
  earningsWithinHold: boolean;
}

export interface SizedPosition {
  symbol: string;
  instrument: string;
  direction: Direction;
  conviction: Conviction;
  leveraged: boolean;
  entry: number;
  /** Initial stop — cut the loser here. */
  stop: number;
  /** Ride-winner exit guidance. */
  trailRule: string;
  /** Fraction of the whole book this position is. */
  weight: number;
  shares: number;
  positionValue: number;
  bookFraction: number;
  /** Downside to the initial stop. */
  riskDollars: number;
  rationale: string;
}

/** A name kept out of the sized book, and why (e.g. earnings inside the hold). */
export interface WatchlistItem {
  symbol: string;
  reason: string;
}

export interface PortfolioConfig {
  capital: number;
  drawdown: number;
  regime: DossierRegime;
  limits: RiskLimits;
  asOf: string;
}

export interface Portfolio {
  positions: SizedPosition[];
  breaker: BreakerLevel;
  /** Fraction of the book put to work this week. */
  deployFraction: number;
  capitalDeployed: number;
  leveragedFraction: number;
  notes: string[];
  /** Strong names deliberately not sized (earnings inside the hold, etc.). */
  watchlist: WatchlistItem[];
}

function trailRule(): string {
  return `Ride it while it works — exit on a daily close below the ${TRAIL_MA}-day average, or if the initial stop breaks.`;
}

function empty(breaker: BreakerLevel, deployFraction: number, notes: string[], watchlist: WatchlistItem[] = []): Portfolio {
  return { positions: [], breaker, deployFraction, capitalDeployed: 0, leveragedFraction: 0, notes, watchlist };
}

/**
 * Build the week's book: dodge earnings, concentrate the deployable capital on
 * the strongest setups, and give each a stop and a trailing exit. Honours the
 * breaker ladder and Crisis first.
 */
export function buildPortfolio(inputs: PositionInput[], cfg: PortfolioConfig): Portfolio {
  const breaker = breakerFor(cfg.drawdown, cfg.limits);
  if (breaker === 'HARD_STOP') {
    return empty(breaker, 0, ['Drawdown hit the hard floor — program halted. No positions.']);
  }
  if (breaker === 'PAUSE_AND_REVIEW') {
    return empty(breaker, 0, ['Drawdown breached the pause level — trading paused for review. No new positions.']);
  }

  const regimeDeploy = DEPLOY_BY_REGIME[cfg.regime.regime] ?? 0;
  const deployFraction = regimeDeploy * (breaker === 'HALVE_SIZE' ? 0.5 : 1);
  const notes: string[] = [];
  if (breaker === 'HALVE_SIZE') notes.push('Drawdown breached the first breaker — deployment halved.');
  if (cfg.regime.regime !== 'RISK_ON_TREND') {
    notes.push(`Regime is ${cfg.regime.regime.replace(/_/g, ' ').toLowerCase()} — deploying only ${(deployFraction * 100).toFixed(0)}% of the book.`);
  }

  // Earnings dodge: strong names reporting inside the hold go to the watchlist,
  // never into a concentrated position that an overnight gap could wreck.
  const watchlist: WatchlistItem[] = [];
  const eligible: PositionInput[] = [];
  for (const inp of inputs) {
    if (inp.earningsWithinHold) {
      watchlist.push({ symbol: inp.candidate.symbol, reason: 'Reports inside the hold window — no concentrated position into an earnings gap. Revisit after it prints.' });
      continue;
    }
    if (inp.entry > 0 && inp.vehicle.price > 0 && inp.strength > 0) eligible.push(inp);
  }

  if (deployFraction <= 0) {
    notes.push('No capital deployed this week.');
    return empty(breaker, deployFraction, notes, watchlist);
  }
  if (eligible.length === 0) return empty(breaker, deployFraction, [...notes, 'No eligible names to size.'], watchlist);

  // Concentrate: the strongest setups, weighted by strength^power so a standout
  // can take most (or all) of the book.
  eligible.sort((a, b) => b.strength - a.strength);
  const chosen = eligible.slice(0, MAX_POSITIONS);
  const totalW = chosen.reduce((s, i) => s + Math.pow(i.strength, CONCENTRATION_POWER), 0);
  const deployable = cfg.capital * deployFraction;

  const positions: SizedPosition[] = [];
  for (const inp of chosen) {
    const weight = Math.pow(inp.strength, CONCENTRATION_POWER) / totalW;
    const notional = deployable * weight;
    const shares = Math.floor(notional / inp.vehicle.price);
    if (shares <= 0) continue;

    const value = shares * inp.vehicle.price;
    const stopFraction = inp.atr && inp.atr > 0 ? (STOP_ATR_MULT * inp.atr) / inp.entry : DEFAULT_STOP_FRACTION;
    const stop = inp.entry * (1 - stopFraction); // long-only momentum
    const riskDollars = value * stopFraction * inp.vehicle.leverageFactor;

    positions.push({
      symbol: inp.candidate.symbol,
      instrument: inp.vehicle.symbol,
      direction: inp.candidate.direction,
      conviction: inp.candidate.conviction,
      leveraged: inp.vehicle.leverageFactor > 1,
      entry: inp.entry,
      stop,
      trailRule: trailRule(),
      weight: value / cfg.capital,
      shares,
      positionValue: value,
      bookFraction: value / cfg.capital,
      riskDollars,
      rationale:
        `${(value / cfg.capital * 100).toFixed(0)}% of book${inp.vehicle.leverageFactor > 1 ? ` via ${inp.vehicle.symbol} (${inp.vehicle.leverageFactor}x)` : ''}; ` +
        `initial stop ${(stopFraction * 100).toFixed(1)}% (~$${riskDollars.toFixed(0)} at risk), then trail.`,
    });
  }

  const capitalDeployed = positions.reduce((s, p) => s + p.positionValue, 0);
  const leveragedFraction = positions.filter((p) => p.leveraged).reduce((s, p) => s + p.positionValue, 0) / cfg.capital;
  if (positions.length === 1) notes.push(`Full concentration — one position carrying ${(positions[0]!.weight * 100).toFixed(0)}% of the book.`);
  return { positions, breaker, deployFraction, capitalDeployed, leveragedFraction, notes, watchlist };
}
