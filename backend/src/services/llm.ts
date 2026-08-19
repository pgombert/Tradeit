/**
 * The AI stages' network layer (Stage 3 analyst, Stage 4 red team). Calls Claude
 * via the official SDK and runs every response through the validation gate in
 * `analyst.parse.ts` before returning it. A failed call never aborts the brief —
 * an analyst failure discards that candidate; a red-team failure kills the
 * thesis (fail-safe). The model gives judgement only; prices and sizes are ours.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnalystVerdict, Dossier, RedTeamVerdict } from '@tradeit/shared';
import { env } from '../config/environment.js';
import {
  buildAnalystPrompt,
  buildRedTeamPrompt,
  validateAnalystVerdict,
  validateRedTeamVerdict,
} from './analyst.parse.js';
import {
  buildDiscoveryPrompt,
  validateDiscovered,
  type DiscoveredTicker,
  type ResearchItem,
} from './discovery.parse.js';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 6000;
/** Discovery is an extraction task — "list the stocks discussed bullishly" — not a
 * reasoning one. Run it at LOW effort so the token budget goes to the answer, not
 * to extended thinking (at medium effort the model spent the whole budget thinking
 * and returned stop_reason=max_tokens with no text). A small budget is plenty for
 * a JSON list of a few tickers. */
const DISCOVERY_MAX_TOKENS = 4000;
const DISCOVERY_EFFORT = 'low';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** Extract a JSON object from the model's text (tolerating markdown fences). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callJson(
  system: string,
  user: string,
  maxTokens = MAX_TOKENS,
  effort: 'low' | 'medium' | 'high' = 'medium',
): Promise<unknown> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    // No text block usually means the token budget was spent while thinking.
    console.warn(`[llm] no text block returned (stop_reason=${res.stop_reason})`);
    return null;
  }
  return extractJson(textBlock.text);
}

/** Stage 3 — the analyst forms a view; the gate validates it or discards it. */
export async function analystPass(dossier: Dossier): Promise<AnalystVerdict | null> {
  const { system, user } = buildAnalystPrompt(dossier);
  try {
    return validateAnalystVerdict(await callJson(system, user), dossier);
  } catch (err) {
    console.warn(`[analyst] ${dossier.candidate.symbol} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Stage 4 — the red team attacks; an unreadable attack kills the thesis. */
export async function redTeamPass(verdict: AnalystVerdict, dossier: Dossier): Promise<RedTeamVerdict> {
  const { system, user } = buildRedTeamPrompt(verdict, dossier);
  try {
    return validateRedTeamVerdict(await callJson(system, user), verdict.symbol);
  } catch (err) {
    console.warn(`[redteam] ${verdict.symbol} failed: ${err instanceof Error ? err.message : String(err)}`);
    return validateRedTeamVerdict(null, verdict.symbol);
  }
}

/** News-driven discovery — the model names tickers being discussed with real
 * momentum/catalyst; the gate keeps only well-formed, source-cited ones. */
export async function discoverTickers(items: ResearchItem[]): Promise<DiscoveredTicker[]> {
  if (items.length === 0) return [];
  const { system, user } = buildDiscoveryPrompt(items);
  const validRefs = new Set(items.map((_, i) => String(i + 1))); // items are cited by number
  try {
    const raw = await callJson(system, user, DISCOVERY_MAX_TOKENS, DISCOVERY_EFFORT);
    const out = validateDiscovered(raw, validRefs);
    if (out.length === 0) {
      // Surface why nothing survived — an empty model reply vs. everything filtered.
      console.warn(`[discovery] no tickers after validation; raw=${JSON.stringify(raw)?.slice(0, 500)}`);
    }
    return out;
  } catch (err) {
    console.warn(`[discovery] failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Whether the AI stages can run (key present) — the caller falls back to a
 * rules-only brief when this is false. */
export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}
