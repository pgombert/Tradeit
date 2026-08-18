import { WEB_SOURCES, type WebSourceDef } from '@tradeit/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { canonicalizeUrl, parseFeed, recentItems, type FeedItem } from './feed.parse.js';
import { extractArticle, extractLinks, type ExtractedArticle } from './extract.js';

/** Look-back for feed items, and the age past which a scraped link is skipped. */
const LOOKBACK_DAYS = 14;

/** Backstops on a chatty source, so one run can't ingest an entire archive. */
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_SCRAPE_LINKS = 10;

/** Below this, a feed's inline HTML is a teaser — fetch the full page instead.
 * Full-content feeds (Substack, Blogger) carry the whole post, well above this;
 * excerpt-only feeds fall below it and get the page fetched for real text. */
const INLINE_CONTENT_MIN = 2500;

const USER_AGENT =
  'Tradeit-Research/1.0 (personal research reader; +https://trade.meadowlark.day)';

export interface WebCollectionResult {
  itemsWritten: number;
  sourcesOk: number;
  sourcesFailed: number;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** The article body for a feed item: use the feed's own HTML when it's the full
 * post, otherwise fetch the page. Saves a request on full-content feeds. */
async function feedItemText(item: FeedItem): Promise<ExtractedArticle> {
  if (item.contentHtml && item.contentHtml.length >= INLINE_CONTENT_MIN) {
    return extractArticle(item.contentHtml, item.url);
  }
  return extractArticle(await fetchText(item.url), item.url);
}

interface WebRecord {
  url: string;
  title: string;
  publishedAt: Date | null;
  article: ExtractedArticle;
}

async function collectFeed(source: WebSourceDef, cutoff: Date): Promise<WebRecord[]> {
  const xml = await fetchText(source.feed!);
  const items = recentItems(parseFeed(xml), cutoff).slice(0, MAX_ITEMS_PER_SOURCE);

  const records: WebRecord[] = [];
  for (const item of items) {
    records.push({
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      article: await feedItemText(item),
    });
  }
  return records;
}

async function collectScrape(source: WebSourceDef): Promise<WebRecord[]> {
  const listHtml = await fetchText(source.listUrl!);
  const listRef = canonicalizeUrl(source.listUrl!);
  const links = extractLinks(listHtml, source.listUrl!, source.linkMatch ?? '')
    // Drop the listing page's own link — it is the index, not an article. A
    // JS-rendered listing (an SPA) yields only this, so such a source records 0.
    .filter((l) => canonicalizeUrl(l.url) !== listRef)
    .slice(0, MAX_SCRAPE_LINKS);

  const records: WebRecord[] = [];
  for (const link of links) {
    const article = await extractArticle(await fetchText(link.url), link.url);
    records.push({
      url: link.url,
      title: article.title || link.title,
      // A listing rarely dates its links; the page is what we can cite.
      publishedAt: null,
      article,
    });
  }
  return records;
}

function payloadFor(source: WebSourceDef, rec: WebRecord): Prisma.InputJsonObject {
  return {
    channel: source.channel === 'FEED' ? 'WEB_FEED' : 'WEB_SCRAPE',
    recognized: true,
    sourceKey: source.key,
    sourceName: source.name,
    author: source.author,
    stage: source.stage,
    tier: source.tier,
    url: rec.url,
    title: rec.title,
    text: rec.article.text,
    excerpt: rec.article.excerpt,
    truncated: rec.article.truncated,
    publishedAt: rec.publishedAt ? rec.publishedAt.toISOString() : null,
  };
}

async function persist(source: WebSourceDef, records: WebRecord[], now: Date): Promise<number> {
  let written = 0;
  for (const rec of records) {
    if (!rec.article.text.trim()) continue; // nothing extracted — skip, don't store an empty shell
    const sourceRef = canonicalizeUrl(rec.url);
    const payload = payloadFor(source, rec);
    await prisma.observation.upsert({
      where: { source_sourceRef: { source: 'NEWSLETTER', sourceRef } },
      create: {
        source: 'NEWSLETTER',
        sourceRef,
        scope: 'MARKET',
        kind: 'LETTER_ITEM',
        observedAt: rec.publishedAt ?? now,
        payload,
      },
      update: { payload },
    });
    written += 1;
  }
  return written;
}

/**
 * Pulls the web sources into the Observation bus as LETTER_ITEM rows, alongside
 * the email letters — keyed on the canonical article URL, so a re-run and the
 * overlap between windows both reach the same end state. Each source is isolated:
 * a feed that 404s or a firm that redesigned its page is logged and skipped, and
 * the rest of the run proceeds.
 */
export async function collectWeb(): Promise<WebCollectionResult> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'web', status: 'RUNNING' },
  });

  const now = new Date();
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  let itemsWritten = 0;
  let sourcesOk = 0;
  const failures: string[] = [];

  try {
    for (const source of WEB_SOURCES) {
      try {
        const records =
          source.channel === 'FEED' ? await collectFeed(source, cutoff) : await collectScrape(source);
        const written = await persist(source, records, now);
        itemsWritten += written;
        sourcesOk += 1;
        console.log(`[web] ${source.key.padEnd(28)} ${String(written).padStart(3)} items`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${source.key}: ${msg}`);
        console.warn(`[web] ${source.key.padEnd(28)} FAILED — ${msg}`);
      }
    }

    console.log(
      `[web] ${itemsWritten} items from ${sourcesOk}/${WEB_SOURCES.length} sources` +
        (failures.length ? ` (${failures.length} failed)` : ''),
    );

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        // A run that reached some sources is a success; per-source failures are
        // recorded in `error` for visibility without failing the whole job.
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        recordsWritten: itemsWritten,
        error: failures.length ? failures.join(' | ').slice(0, 1000) : null,
      },
    });

    return { itemsWritten, sourcesOk, sourcesFailed: failures.length };
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        recordsWritten: itemsWritten,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
