/**
 * The contracts the brain is built around. Stage 1 screens emit `Candidate`s;
 * Stage 2 wraps each in a `Dossier`. Defined here in shared so every screen, the
 * aggregator, the dossier builder, and the frontend all agree on the shape.
 *
 * A candidate is an *exposure + direction* (e.g. bullish SEMIS), carried on the
 * security that surfaced it — not yet a traded instrument. Stage 5's
 * `selectInstrument` turns exposure+direction+conviction+regime into the actual
 * ticker (long, inverse, or leveraged). Screens never emit a short.
 */
import type { Conviction, Direction } from '../engine/instrument-selection.js';
import type { Indicators } from '../engine/price-indicators.js';
import type { MarketRegime } from './risk.js';
import type { ObservationKind, ObservationSource } from './observation.js';

/** One screen's finding for a security: how strongly, and why, with provenance. */
export interface ScreenHit {
  /** The screen that surfaced it, e.g. 'momentum' | 'mean-reversion' | 'sector-rotation'. */
  screen: string;
  /** Normalized strength within the screen, 0..1 — used to rank and to aggregate. */
  score: number;
  direction: Direction;
  /** Plain-English reason, for the brief and for auditing. */
  rationale: string;
  /** Ids/refs backing the finding: price-bar dates, observation ids. */
  evidence: string[];
}

/**
 * A Stage 1 candidate: the security, its exposure bucket and direction, an
 * aggregate conviction (1..5, which gates leverage at Stage 5), and every screen
 * that surfaced it. The `symbol` must resolve to an `INSTRUMENTS` entry or a
 * `Security` row — the AI/validation anchor — before it is ever shown or sized.
 */
export interface Candidate {
  symbol: string;
  /** The company/fund name, e.g. "NVIDIA Corp". Filled by the service from the
   * securities table; the pure screen/aggregate layer leaves it unset. Always
   * shown next to the ticker so the brief never reads as bare symbols. */
  name?: string;
  exposure: string;
  direction: Direction;
  conviction: Conviction;
  screens: ScreenHit[];
  asOf: string;
}

/** One cited line of context in a dossier — always carries its observation id. */
export interface EvidenceLine {
  observationId: string;
  source: ObservationSource;
  kind: ObservationKind;
  scope: string;
  observedAt: string;
  summary: string;
  url: string | null;
}

/** The regime context a dossier is read against — a slice of the Stage 0 verdict. */
export interface DossierRegime {
  regime: MarketRegime;
  leverageAllowed: boolean;
  riskBudget: number;
  asOf: string | null;
}

/**
 * A Stage 2 evidence dossier for one candidate: its price/vol readings, the
 * week's regime, and the market-wide observations (letters, transcripts, econ
 * releases) in the window that bear on it — every line citable. This is the
 * packet Stage 3 (Claude) will later read; nothing enters it without an id.
 */
export interface Dossier {
  candidate: Candidate;
  price: Indicators;
  regime: DossierRegime;
  context: EvidenceLine[];
  asOf: string;
}
