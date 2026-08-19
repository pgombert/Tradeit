/**
 * The AI stages' outputs (Stage 3 analyst, Stage 4 red team). Shared so the
 * frontend renders them and the validation gate has one shape to check against.
 *
 * The model supplies *judgement* — a thesis, a direction, a conviction, a
 * catalyst, and what would prove it wrong — plus the evidence ids it relied on.
 * It never supplies prices or sizes: those come from our own data (Stage 5), so
 * a hallucinated number can never become a tradeable figure (CLAUDE.md rule 1).
 */
import type { Conviction, Direction } from '../engine/instrument-selection.js';
import type { Portfolio } from '../engine/portfolio.js';
import type { Candidate, DossierRegime } from './candidate.js';

export interface AnalystVerdict {
  symbol: string;
  thesis: string;
  direction: Direction;
  conviction: Conviction;
  catalyst: string;
  whatWouldProveWrong: string;
  /** Observation ids the thesis rests on — every one must exist in the dossier. */
  evidenceIds: string[];
}

export interface RedTeamVerdict {
  symbol: string;
  survives: boolean;
  bearCase: string;
  whatsPriced: string;
  crowding: string;
  /** Why it was killed, when it doesn't survive; null when it does. */
  causeOfDeath: string | null;
}

/** One candidate carried through the AI stages, with its cause of death if cut. */
export interface AnalysedCandidate {
  analyst: AnalystVerdict;
  redTeam: RedTeamVerdict;
  survived: boolean;
}

/** A ticker the news/podcast feed surfaced with bullish momentum (Stage 1 discovery). */
export interface NarrativeIdea {
  symbol: string;
  reason: string;
  confidence: number;
  /** Whether this name is in the screened universe and made the candidate list. */
  inBook: boolean;
}

/** The stored weekly brief — the whole pipeline's output, served by the API. */
export interface StoredBrief {
  asOf: string;
  generatedAt: string;
  regime: DossierRegime;
  /** Stage 1 — the full ranked candidate list. */
  candidates: Candidate[];
  /** Stage 3-4 — the analysed candidates with their verdicts. */
  analysed: AnalysedCandidate[];
  /** Stage 5 — the sized portfolio, built from the survivors. */
  portfolio: Portfolio;
  /** Names the news/podcast feed surfaced with momentum (Stage 1 discovery). */
  narrativeIdeas: NarrativeIdea[];
  /** True when the AI stages ran; false means a rules-only fallback. */
  aiRan: boolean;
}
