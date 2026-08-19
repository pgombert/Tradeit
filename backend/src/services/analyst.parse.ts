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
      'You are a momentum analyst for a private single-stock research system. The edge here ' +
      'is SPEED and SIZE: a $100k book can ride a sharp move in a name too small for ' +
      'institutions to touch. You judge ONE candidate from the evidence provided — nothing else.\n' +
      'For a momentum trade the thesis is the MOVE ITSELF and why it continues: the strength of ' +
      'the breakout, the trend, relative strength, and any catalyst (news, a story the feed is ' +
      'pushing) driving it. You do NOT need a deep fundamental story — an established uptrend or a ' +
      'fresh breakout with a real catalyst IS a valid thesis. Direction is almost always BULLISH ' +
      '(the system only trades long). Conviction 1 (weak) to 5 (strong) tracks how clean and ' +
      'forceful the move is. whatWouldProveWrong should be a PRICE level — the breakout failing, ' +
      'price falling back below its trigger or its stop — not a change of fundamental opinion.\n' +
      'Be specific. Do NOT invent prices, tickers, or evidence. Cite only the evidence ids given ' +
      'to you; if the price/trend data alone drives your view, cite no ids.\n' +
      'Return ONLY a JSON object, no markdown or prose, with exactly these keys: ' +
      'thesis (string), direction ("BULLISH" or "BEARISH"), conviction (integer 1-5), ' +
      'catalyst (string), whatWouldProveWrong (string), evidenceIds (array of the cited evidence id strings).',
    user:
      `Judge this momentum candidate. Why does this move continue — the thesis, direction, your ` +
      `conviction, the catalyst driving it now, and the PRICE level that would prove it wrong?\n\n` +
      serialiseDossier(dossier),
  };
}

export function buildRedTeamPrompt(verdict: AnalystVerdict, dossier: Dossier): PromptPair {
  return {
    system:
      'You are the red team for a MOMENTUM trading system. This is the critical thing to ' +
      'understand: this system deliberately buys strength and rides it, cutting losers fast with ' +
      'a stop. So "it has already run", "it looks overbought/extended", and "this is a crowded ' +
      'momentum trade" are NOT reasons to kill — riding an extended, popular, still-rising move IS ' +
      'the strategy. Do not kill a name merely for being up a lot or widely liked.\n' +
      'KILL a thesis (survives=false, one-line cause of death) ONLY for a momentum-relevant risk ' +
      'that genuinely threatens THIS trade:\n' +
      '  - a scheduled event inside the holding window that could gap it against us — above all an ' +
      'earnings report (the one landmine we refuse to sit on);\n' +
      '  - the move is already FAILING — price has rolled back below its breakout trigger, broken ' +
      'its stop, or this week is sharply negative while the thesis claims strength;\n' +
      '  - the name cannot be exited fast (thin liquidity);\n' +
      '  - a specific, known, negative hard catalyst — not vague "it could reverse".\n' +
      'A name with intact upside momentum, adequate liquidity, and no imminent landmine should ' +
      'SURVIVE (survives=true, causeOfDeath null). When unsure and the trend is intact, let it ' +
      'survive — the stop is our protection, not your skepticism. Do not invent facts.\n' +
      'Still fill bearCase, whatsPriced, and crowding honestly for the record — just do not treat ' +
      '"priced in" or "crowded" as automatic kills.\n' +
      'Return ONLY a JSON object, no markdown or prose, with exactly these keys: ' +
      'survives (boolean), bearCase (string), whatsPriced (string), crowding (string), ' +
      'causeOfDeath (string or null).',
    user:
      `THESIS TO PRESSURE-TEST (${verdict.symbol}, ${verdict.direction}, conviction ${verdict.conviction}):\n` +
      `${verdict.thesis}\nCatalyst: ${verdict.catalyst}\nWould be wrong if: ${verdict.whatWouldProveWrong}\n\n` +
      `Does a momentum-relevant risk (earnings in the hold window, a failing move, illiquidity, a ` +
      `known negative catalyst) kill this trade — or does the trend justify riding it with a stop?\n\n` +
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
