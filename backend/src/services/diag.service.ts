/**
 * A read-only inventory of the research feed, for diagnosing why discovery does
 * or doesn't surface ideas. Logs counts, recency, and text health of LETTER_ITEM
 * observations — the exact rows discovery reads — so we can see whether the
 * transcripts are present, recent enough, and carry real text. Never writes.
 */
import { prisma } from '../lib/prisma.js';

function textLen(payload: unknown): number {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = (typeof p.text === 'string' && p.text) || (typeof p.bodyText === 'string' && p.bodyText) || (typeof p.excerpt === 'string' && p.excerpt) || '';
  return text.length;
}

function sourceName(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  return (typeof p.sourceName === 'string' && p.sourceName) || (typeof p.author === 'string' && p.author) || 'unknown';
}

export async function runDiagnostics(): Promise<void> {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14); // discovery's window

  const total = await prisma.observation.count({ where: { kind: 'LETTER_ITEM' } });
  const recent = await prisma.observation.count({ where: { kind: 'LETTER_ITEM', observedAt: { gte: cutoff } } });
  console.log(`[diag] LETTER_ITEM total=${total}, within-14-days(observedAt)=${recent}`);

  // Everything discovery would actually load: recent LETTER_ITEMs, newest first.
  const rows = await prisma.observation.findMany({
    where: { kind: 'LETTER_ITEM', observedAt: { gte: cutoff } },
    orderBy: { observedAt: 'desc' },
    select: { observedAt: true, payload: true },
    take: 500,
  });
  const withText = rows.filter((r) => textLen(r.payload) >= 200).length;
  console.log(`[diag] of the recent ones, ${withText}/${rows.length} have >=200 chars of text (discovery's floor)`);

  // Per-source breakdown of the recent set.
  const bySource = new Map<string, { n: number; withText: number; newest: string }>();
  for (const r of rows) {
    const s = sourceName(r.payload);
    const e = bySource.get(s) ?? { n: 0, withText: 0, newest: '' };
    e.n += 1;
    if (textLen(r.payload) >= 200) e.withText += 1;
    const d = r.observedAt.toISOString().slice(0, 10);
    if (d > e.newest) e.newest = d;
    bySource.set(s, e);
  }
  for (const [s, e] of [...bySource.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`[diag]   ${s}: ${e.n} recent (${e.withText} with text), newest ${e.newest}`);
  }

  // The Compound specifically, ignoring the date window — how old are they, real text?
  const all = await prisma.observation.findMany({
    where: { kind: 'LETTER_ITEM' },
    orderBy: { observedAt: 'desc' },
    select: { observedAt: true, payload: true },
    take: 2000,
  });
  const compound = all.filter((r) => /compound/i.test(sourceName(r.payload)));
  console.log(`[diag] The Compound: ${compound.length} total transcripts held`);
  for (const r of compound.slice(0, 6)) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const title = typeof p.title === 'string' ? p.title.slice(0, 70) : '(no title)';
    console.log(`[diag]   dated ${r.observedAt.toISOString().slice(0, 10)}, ${textLen(r.payload)} chars — ${title}`);
  }
  console.log(`[diag] today=${now.toISOString().slice(0, 10)}, discovery cutoff=${cutoff.toISOString().slice(0, 10)}`);
}
