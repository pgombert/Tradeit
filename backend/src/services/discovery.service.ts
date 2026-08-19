/**
 * News-driven discovery, wired to data. Pulls the recent research feed
 * (newsletters, podcast transcripts, web articles) and asks the model which
 * tickers are being discussed with real bullish momentum. Returns the validated,
 * source-cited names for the brief to fold in.
 */
import { prisma } from '../lib/prisma.js';
import { discoverTickers } from './llm.js';
import type { DiscoveredTicker, ResearchItem } from './discovery.parse.js';

/** How many recent letter/transcript items to read, and how far back. */
const RESEARCH_ITEMS = 16;
const RESEARCH_DAYS = 14;

function textOf(payload: unknown): { title: string; text: string; source: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const title = (typeof p.title === 'string' && p.title) || (typeof p.subject === 'string' && p.subject) || '';
  const text = (typeof p.text === 'string' && p.text) || (typeof p.bodyText === 'string' && p.bodyText) || (typeof p.excerpt === 'string' && p.excerpt) || '';
  const source = (typeof p.sourceName === 'string' && p.sourceName) || (typeof p.author === 'string' && p.author) || 'research';
  return { title, text, source };
}

/** The most recent research items with usable body text, newest first. */
async function loadResearchItems(): Promise<ResearchItem[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RESEARCH_DAYS);
  const rows = await prisma.observation.findMany({
    where: { kind: 'LETTER_ITEM', observedAt: { gte: cutoff } },
    orderBy: { observedAt: 'desc' },
    take: RESEARCH_ITEMS * 2, // over-fetch; some carry no body text
    select: { id: true, payload: true },
  });

  const items: ResearchItem[] = [];
  for (const r of rows) {
    const { title, text, source } = textOf(r.payload);
    if (!text || text.length < 200) continue; // nothing to reason from
    items.push({ id: r.id, source, title, text });
    if (items.length >= RESEARCH_ITEMS) break;
  }
  return items;
}

/** Run discovery over the current research feed. */
export async function discover(): Promise<DiscoveredTicker[]> {
  const items = await loadResearchItems();
  if (items.length === 0) return [];
  const validEvidenceIds = new Set(items.map((i) => i.id));
  return discoverTickers(items, validEvidenceIds);
}
