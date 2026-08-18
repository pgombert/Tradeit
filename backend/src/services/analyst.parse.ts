/**
 * Pure helpers for the AI stages: build the prompts, and — the load-bearing part
 * — validate whatever the model returns before it is trusted (CLAUDE.md rule 1).
 * No network, no SDK, so the gate is tested against fixtures.
 *
 * The gate's rules: the symbol is forced to the candidate's (never the model's);
 * direction and conviction must be in range; and every cited evidence id must
 * exist in the dossier — a verdict citing an id we don't hold is discarded whole,
 * not partially trusted.
 */
import type {
  AnalystVerdict,
  Conviction,
  Direction,
  Dossier,
  Indicators,
  RedTeamVerdict,
} from '@tradeit/shared';

/** JSON schema the analyst pass is constrained to (Stage 3). */
export const ANALYST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thesis', 'direction', 'conviction', 'catalyst', 'whatWouldProveWrong', 'evidenceIds'],
  properties: {
    thesis: { type: 'string' },
    direction: { type: 'string', enum: ['BULLISH', 'BEARISH'] },
    conviction: { type: 'integer', minimum: 1, maximum: 5 },
    catalyst: { type: 'string' },
    whatWouldProveWrong: { type: 'string' },
    evidenceIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** JSON schema the red-team pass is constrained to (Stage 4). */
export const REDTEAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['survives', 'bearCase', 'whatsPriced', 'crowding', 'causeOfDeath'],
  properties: {
    survives: { type: 'boolean' },
    bearCase: { type: 'string' },
    whatsPriced: { type: 'string' },
    crowding: { type: 'string' },
    causeOfDeath: { type: ['string', 'null'] },
  },
} as const;

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

/** A compact, model-readable rendering of a candidate's dossier. */
export function serialiseDossier(dossier: Dossier): string {
  const c = dossier.candidate;
  const p: Indicators = dossier.price;
  const screens = c.screens.map((s) => `${s.screen} (${s.rationale})`).join('; ');
  const lines = [
    `CANDIDATE: ${c.symbol} — exposure ${c.exposure}, screen direction ${c.direction}, screen conviction ${c.conviction}.`,
    `SCREENS: ${screens || 'none'}`,
    `PRICE: last ${p.close ?? 'n/a'}; 1m ${pct(p.return1m)}, 3m ${pct(p.return3m)}, 6m ${pct(p.return6m)}; ` +
      `above50dma ${p.above50dma}, above200dma ${p.above200dma}; RSI14 ${p.rsi14?.toFixed(0) ?? 'n/a'}; ` +
      `ATR ${pct(p.atrPct)} of price; drawdown-from-high ${pct(p.drawdownFromHigh)}.`,
    `REGIME: ${dossier.regime.regime} (leverage ${dossier.regime.leverageAllowed ? 'allowed' : 'off'}, weekly risk budget ${pct(dossier.regime.riskBudget)}).`,
    `EVIDENCE (cite by id):`,
    ...dossier.context.map((e) => `  [${e.observationId}] (${e.kind}) ${e.summary}`),
  ];
  return lines.join('\n');
}

export interface PromptPair {
  system: string;
  user: string;
}

export function buildAnalystPrompt(dossier: Dossier): PromptPair {
  return {
    system:
      'You are a disciplined swing-trading analyst for a private research system. ' +
      'You form a view on ONE candidate from the evidence provided — nothing else. ' +
      'Be skeptical and specific. Do NOT invent prices, tickers, or evidence. ' +
      'Cite only the evidence ids given to you; if the price/trend data alone drives your view, cite no ids. ' +
      'Conviction 1 (weak) to 5 (strong).\n' +
      'Return ONLY a JSON object, no markdown or prose, with exactly these keys: ' +
      'thesis (string), direction ("BULLISH" or "BEARISH"), conviction (integer 1-5), ' +
      'catalyst (string), whatWouldProveWrong (string), evidenceIds (array of the cited evidence id strings).',
    user:
      `Form your view on this candidate. What is the thesis, the direction, your conviction, ` +
      `the catalyst in the coming week or two, and specifically what would prove the thesis wrong?\n\n` +
      serialiseDossier(dossier),
  };
}

export function buildRedTeamPrompt(verdict: AnalystVerdict, dossier: Dossier): PromptPair {
  return {
    system:
      'You are a red-team analyst. Your only job is to KILL the thesis in front of you. ' +
      'Make the strongest bear case, say what is already priced in, and assess crowding. ' +
      'Then decide: does the thesis survive your attack? Set survives=false with a one-line ' +
      'cause of death if it does not, or survives=true (causeOfDeath null) if it genuinely holds up. ' +
      'Default to killing weak or crowded theses. Do not invent facts.\n' +
      'Return ONLY a JSON object, no markdown or prose, with exactly these keys: ' +
      'survives (boolean), bearCase (string), whatsPriced (string), crowding (string), ' +
      'causeOfDeath (string or null).',
    user:
      `THESIS TO KILL (${verdict.symbol}, ${verdict.direction}, conviction ${verdict.conviction}):\n` +
      `${verdict.thesis}\nCatalyst: ${verdict.catalyst}\nWould be wrong if: ${verdict.whatWouldProveWrong}\n\n` +
      `Context:\n${serialiseDossier(dossier)}`,
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The Stage 3 validation gate. Forces the symbol to the candidate's, checks the
 * direction and conviction, and requires every cited evidence id to exist in the
 * dossier. Returns a trusted verdict, or null to discard the whole thing.
 */
export function validateAnalystVerdict(raw: unknown, dossier: Dossier): AnalystVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const direction = r.direction;
  if (direction !== 'BULLISH' && direction !== 'BEARISH') return null;

  const conviction = r.conviction;
  if (typeof conviction !== 'number' || !Number.isInteger(conviction) || conviction < 1 || conviction > 5) {
    return null;
  }

  const thesis = asString(r.thesis);
  const catalyst = asString(r.catalyst);
  const whatWouldProveWrong = asString(r.whatWouldProveWrong);
  if (!thesis || !catalyst || !whatWouldProveWrong) return null;

  const rawIds = Array.isArray(r.evidenceIds) ? r.evidenceIds : [];
  const validIds = new Set(dossier.context.map((e) => e.observationId));
  const evidenceIds: string[] = [];
  for (const id of rawIds) {
    if (typeof id !== 'string') return null;
    // A cited id we don't hold means the verdict is untrustworthy — discard whole.
    if (!validIds.has(id)) return null;
    evidenceIds.push(id);
  }

  return {
    symbol: dossier.candidate.symbol, // forced to canonical — never the model's
    thesis,
    direction: direction as Direction,
    conviction: conviction as Conviction,
    catalyst,
    whatWouldProveWrong,
    evidenceIds,
  };
}

/** The Stage 4 gate. A malformed red-team result defaults to KILLING the thesis
 * (fail-safe: an unparseable attack is treated as a thesis that didn't survive). */
export function validateRedTeamVerdict(raw: unknown, symbol: string): RedTeamVerdict {
  const killed = (cause: string): RedTeamVerdict => ({
    symbol,
    survives: false,
    bearCase: '',
    whatsPriced: '',
    crowding: '',
    causeOfDeath: cause,
  });
  if (!raw || typeof raw !== 'object') return killed('Red-team result was unreadable.');
  const r = raw as Record<string, unknown>;
  if (typeof r.survives !== 'boolean') return killed('Red-team gave no clear verdict.');

  return {
    symbol,
    survives: r.survives,
    bearCase: asString(r.bearCase),
    whatsPriced: asString(r.whatsPriced),
    crowding: asString(r.crowding),
    causeOfDeath: r.survives ? null : asString(r.causeOfDeath) || 'Killed by the red team.',
  };
}
