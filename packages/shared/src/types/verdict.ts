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
