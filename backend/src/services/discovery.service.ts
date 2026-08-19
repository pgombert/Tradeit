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
/** Each item is read in its OWN focused model call (not one giant batch — that
 * hung), so we can read a transcript in full. Bound how many shows/letters we
 * cover and how much of each we read. */
const MAX_TRANSCRIPTS = 14; // the idea-rich long-form; the priority
const MAX_LETTERS = 8; // shorter newsletters/blogs, to round out coverage
const MAX_ITEM_CHARS = 40_000; // a transcript's substance, per call
/** How many discovery calls run at once — fast enough overall, gentle on limits. */
const DISCOVERY_CONCURRENCY = 6;

function textOf(payload: unknown): { title: string; text: string; source: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const title = (typeof p.title === 'string' && p.title) || (typeof p.subject === 'string' && p.subject) || '';
  const text = (typeof p.text === 'string' && p.text) || (typeof p.bodyText === 'string' && p.bodyText) || (typeof p.excerpt === 'string' && p.excerpt) || '';
  const source = (typeof p.sourceName === 'string' && p.sourceName) || (typeof p.author === 'string' && p.author) || 'research';
  return { title, text, source };
}

/** Long-form discussion (a podcast transcript) is where the single-stock ideas
 * live, so it's covered first and most heavily. */
function isTranscript(source: string): boolean {
  return /transcript/i.test(source);
}

/** Run `fn` over `xs` with at most `limit` in flight. */
async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

/**
 * The research to hand discovery: recent items with real text — the meatiest
 * transcripts first, then some newsletters to round out coverage. Each item's
 * text is capped; each will be read in its own call.
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

  const byLen = (a: { text: string }, b: { text: string }) => b.text.length - a.text.length;
  const transcripts = usable.filter((it) => isTranscript(it.source)).sort(byLen).slice(0, MAX_TRANSCRIPTS);
  const letters = usable.filter((it) => !isTranscript(it.source)).sort(byLen).slice(0, MAX_LETTERS);

  return [...transcripts, ...letters].map((it) => ({
    id: it.id,
    source: it.source,
    title: it.title,
    text: it.text.slice(0, MAX_ITEM_CHARS),
  }));
}

/** Run discovery over the current research feed. Each returned name carries the
 * human-readable source it came from (the newsletter/podcast), resolved from the
 * cited item — so the brief can show where the idea originated, not just an id. */
export async function discover(): Promise<DiscoveredTicker[]> {
  const items = await loadResearchItems();
  const chars = items.reduce((s, i) => s + i.text.length, 0);
  console.log(`[discovery] reading ${items.length} research items (${Math.round(chars / 1000)}k chars) from ${new Set(items.map((i) => i.source)).size} sources`);
  if (items.length === 0) return [];

  // One focused call per item — a transcript read in full, in parallel. A slow or
  // failed single call can't stall or sink the batch.
  const perItem = await mapLimit(items, DISCOVERY_CONCURRENCY, async (item) => {
    const found = await discoverTickers([item]); // one item, cited as [1]
    return found.map((d) => ({ ...d, evidenceId: item.id, source: item.source }));
  });

  // Merge across items, keeping the most confident mention of each symbol.
  const bySymbol = new Map<string, DiscoveredTicker>();
  for (const d of perItem.flat()) {
    const existing = bySymbol.get(d.symbol);
    if (!existing || d.confidence > existing.confidence) bySymbol.set(d.symbol, d);
  }
  const result = [...bySymbol.values()].sort((a, b) => b.confidence - a.confidence);
  console.log(`[discovery] surfaced ${result.length} tickers: ${result.map((d) => d.symbol).join(', ') || '(none)'}`);
  return result;
}
