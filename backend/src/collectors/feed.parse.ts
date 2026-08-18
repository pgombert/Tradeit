/**
 * Pure helpers for the web content engine's feed side. XML in, normalized items
 * out — no network, no DOM, no config — so parsing and URL canonicalization can
 * be tested against fixture feeds without fetching anything.
 */
import { XMLParser } from 'fast-xml-parser';

/** A normalized feed entry, whichever dialect it came from. */
export interface FeedItem {
  title: string;
  /** Canonical article URL — the observation's stable id. */
  url: string;
  /** When the item was published, or null if the feed gave no usable date. */
  publishedAt: Date | null;
  /** The richest inline HTML the feed carried: content if present, else summary. */
  contentHtml: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Feeds wrap HTML in CDATA; keep it as text rather than trying to parse it.
  cdataPropName: '__cdata',
});

/** Coerce fast-xml-parser's "one-or-many" shape into an array. */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** A node may be a bare string, a { '#text' } object, or carry CDATA. */
function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.__cdata === 'string') return o.__cdata;
    if (typeof o['#text'] === 'string') return o['#text'];
  }
  return '';
}

/**
 * Strip a URL to a stable canonical form so the same article never lands twice:
 * drop the fragment and common tracking params, lower-case the host, and remove
 * a trailing slash. A URL that will not parse is returned trimmed, unchanged.
 */
export function canonicalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const drop = [...u.searchParams.keys()].filter(
    (k) => /^utm_/i.test(k) || ['ref', 'source', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(k.toLowerCase()),
  );
  drop.forEach((k) => u.searchParams.delete(k));
  let out = u.toString();
  if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
  return out;
}

function parseDate(raw: string): Date | null {
  if (!raw.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The alternate/permalink URL out of an Atom entry's `link` (one or many). */
function atomLink(entry: Record<string, unknown>): string {
  const links = toArray(entry.link) as Array<Record<string, unknown> | string>;
  const hrefs = links.map((l) => (typeof l === 'string' ? l : String(l['@_href'] ?? '')));
  const rels = links.map((l) => (typeof l === 'string' ? '' : String(l['@_rel'] ?? '')));
  const alt = hrefs.find((_, i) => rels[i] === 'alternate' || rels[i] === '');
  return alt ?? hrefs[0] ?? '';
}

/**
 * Parse an RSS 2.0 or Atom feed into normalized items. Unknown or malformed
 * shapes yield an empty list rather than throwing — one bad feed must not take
 * down a run of many. Items with no usable link are dropped: with no URL there
 * is nothing to key or cite.
 */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  // RSS 2.0: rss > channel > item[]
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    return toArray(channel.item as unknown)
      .map((raw) => {
        const item = raw as Record<string, unknown>;
        const url = canonicalizeUrl(text(item.link));
        return {
          title: text(item.title).trim(),
          url,
          publishedAt: parseDate(text(item.pubDate) || text(item['dc:date'])),
          contentHtml: text(item['content:encoded']) || text(item.description),
        };
      })
      .filter((i) => i.url);
  }

  // Atom: feed > entry[]
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return toArray(feed.entry as unknown)
      .map((raw) => {
        const entry = raw as Record<string, unknown>;
        const url = canonicalizeUrl(atomLink(entry));
        return {
          title: text(entry.title).trim(),
          url,
          publishedAt: parseDate(text(entry.published) || text(entry.updated)),
          contentHtml: text(entry.content) || text(entry.summary),
        };
      })
      .filter((i) => i.url);
  }

  return [];
}

/** Keep only items published on or after `cutoff`. Undated items are kept — a
 * feed that omits dates should not vanish; the idempotent upsert dedupes them. */
export function recentItems(items: FeedItem[], cutoff: Date): FeedItem[] {
  return items.filter((i) => i.publishedAt === null || i.publishedAt >= cutoff);
}
