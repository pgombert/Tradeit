/**
 * News-driven discovery, wired to data. Pulls the recent research feed
 * (newsletters, podcast transcripts, web articles) and asks the model which
 * tickers are being discussed with real bullish momentum. Returns the validated,
 * source-cited names for the brief to fold in.
 */
import { prisma } from '../lib/prisma.js';
import { discoverTickers } from './llm.js';
import type { DiscoveredTicker, ResearchItem } from './discovery.parse.js';

const RESEARCH_DAYS = 14;
/** Cap on items and on total characters sent to the model. A podcast transcript
 * runs 40–100k chars, so the old 16-item / 3.5k-per-item budget fed the model
 * only the opening minutes of each show and it found nothing. These bounds let
 * discovery read the substance of the idea-rich transcripts (opus-5 1M context)
 * while keeping one call's input bounded (~600k chars ≈ 150k tokens). */
const MAX_ITEMS = 40;
const MAX_ITEM_CHARS = 40_000;
const TOTAL_CHAR_BUDGET = 600_000;

function textOf(payload: unknown): { title: string; text: string; source: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const title = (typeof p.title === 'string' && p.title) || (typeof p.subject === 'string' && p.subject) || '';
  const text = (typeof p.text === 'string' && p.text) || (typeof p.bodyText === 'string' && p.bodyText) || (typeof p.excerpt === 'string' && p.excerpt) || '';
  const source = (typeof p.sourceName === 'string' && p.sourceName) || (typeof p.author === 'string' && p.author) || 'research';
  return { title, text, source };
}

/** Long-form discussion (a podcast transcript) is where the single-stock ideas
 * live, so it goes to the front of the queue ahead of short macro blog posts. */
function isRichSource(source: string): boolean {
  return /transcript/i.test(source);
}

/**
 * The research to hand discovery: everything in the window with real text,
 * prioritised so the idea-rich transcripts are read first and in depth, then
 * accumulated up to the item and character budgets. Each item's text is capped
 * so one very long transcript can't consume the whole budget.
 */
async function loadResearchItems(): Promise<ResearchItem[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RESEARCH_DAYS);
  const rows = await prisma.observation.findMany({
    where: { kind: 'LETTER_ITEM', observedAt: { gte: cutoff } },
    orderBy: { observedAt: 'desc' },
    take: 300,
    select: { id: true, payload: true },
  });

  const usable = rows
    .map((r) => ({ id: r.id, ...textOf(r.payload) }))
    .filter((it) => it.text && it.text.length >= 200);

  // Transcripts first; within each group, the meatier item first.
  usable.sort((a, b) => {
    const ra = isRichSource(a.source) ? 0 : 1;
    const rb = isRichSource(b.source) ? 0 : 1;
    return ra - rb || b.text.length - a.text.length;
  });

  const items: ResearchItem[] = [];
  let budget = TOTAL_CHAR_BUDGET;
  for (const it of usable) {
    if (items.length >= MAX_ITEMS || budget <= 0) break;
    const text = it.text.slice(0, Math.min(MAX_ITEM_CHARS, budget));
    if (text.length < 200) continue;
    budget -= text.length;
    items.push({ id: it.id, source: it.source, title: it.title, text });
  }
  return items;
}

/** Run discovery over the current research feed. Each returned name carries the
 * human-readable source it came from (the newsletter/podcast), resolved from the
 * cited item — so the brief can show where the idea originated, not just an id. */
export async function discover(): Promise<DiscoveredTicker[]> {
  const items = await loadResearchItems();
  const chars = items.reduce((s, i) => s + i.text.length, 0);
  console.log(`[discovery] reading ${items.length} research items (${Math.round(chars / 1000)}k chars) from ${new Set(items.map((i) => i.source)).size} sources`);
  if (items.length === 0) return [];
  const discovered = await discoverTickers(items);
  console.log(`[discovery] surfaced ${discovered.length} tickers: ${discovered.map((d) => d.symbol).join(', ') || '(none)'}`);
  // The model cited each idea by item number; translate that back to the real
  // observation id (the audit trail) and the human-readable source name.
  return discovered.map((d) => {
    const item = items[Number(d.evidenceId) - 1];
    return { ...d, evidenceId: item?.id ?? d.evidenceId, source: item?.source ?? 'research' };
  });
}
