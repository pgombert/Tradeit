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

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 6000;

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

async function callJson(system: string, user: string): Promise<unknown> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'medium' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const textBlock = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return textBlock ? extractJson(textBlock.text) : null;
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

/** Whether the AI stages can run (key present) — the caller falls back to a
 * rules-only brief when this is false. */
export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}
