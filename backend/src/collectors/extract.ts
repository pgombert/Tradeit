/**
 * HTML → content, for the web engine. Two jobs, both pure (a string in, a value
 * out — no network): pull the readable article out of a page, and pull the
 * article links out of a listing page for the scrape sources.
 *
 * Kept apart from the collector so the extraction can be tested against fixture
 * HTML without fetching anything. Uses jsdom, which Readability is built and
 * tested against — a lighter DOM (linkedom) mis-extracts real pages.
 */
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { canonicalizeUrl } from './feed.parse.js';

/** Article bodies can be long; cap what we store, and flag when we trimmed. */
export const WEB_MAX_BODY_CHARS = 200_000;

export interface ExtractedArticle {
  title: string;
  text: string;
  excerpt: string;
  truncated: boolean;
}

/** A DOM shape covering only what we touch — the backend tsconfig has no DOM lib. */
type Anchor = { getAttribute(name: string): string | null; textContent: string | null };
interface MinimalDoc {
  querySelector(sel: string): { textContent: string | null } | null;
  querySelectorAll(sel: string): ArrayLike<Anchor> & Iterable<Anchor>;
  body: { textContent: string | null } | null;
}

/** jsdom needs a valid absolute URL; fall back to a placeholder if one isn't. */
function safeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return 'https://article.invalid/';
  }
}

function documentFor(html: string, url: string): { doc: MinimalDoc; readabilityDoc: unknown } {
  const dom = new JSDOM(html, { url: safeUrl(url) });
  return { doc: dom.window.document as unknown as MinimalDoc, readabilityDoc: dom.window.document };
}

/** Collapse runaway whitespace a DOM text dump leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract the readable article from a page. Readability does the work; if it
 * returns nothing usable (a paywall shell, an app skeleton) we fall back to the
 * page's body text rather than storing nothing. Never throws — extraction
 * failure yields empty text, and the collector decides what to do with it.
 */
export function extractArticle(html: string, url: string): ExtractedArticle {
  let title = '';
  let text = '';
  let excerpt = '';

  try {
    const { doc, readabilityDoc } = documentFor(html, url);
    title = (doc.querySelector('title')?.textContent ?? '').trim();

    try {
      // Readability mutates the document, so this is always a fresh parse.
      const article = new Readability(readabilityDoc as ConstructorParameters<typeof Readability>[0]).parse();
      if (article?.textContent && article.textContent.trim()) {
        title = (article.title || title).trim();
        text = tidy(article.textContent);
        excerpt = (article.excerpt ?? '').trim();
      }
    } catch {
      // Readability threw on an odd document — fall through to body text.
    }

    if (!text) text = tidy(doc.body?.textContent ?? '');
  } catch {
    // jsdom itself failed on malformed input; return what little we have.
  }

  const truncated = text.length > WEB_MAX_BODY_CHARS;
  return {
    title,
    text: truncated ? text.slice(0, WEB_MAX_BODY_CHARS) : text,
    excerpt: excerpt || text.slice(0, 280).trim(),
    truncated,
  };
}

export interface ArticleLink {
  url: string;
  title: string;
}

/**
 * Pull candidate article links out of a listing page: anchors whose resolved
 * URL contains `match`, canonicalized and de-duplicated, keeping the first
 * (usually the most prominent) anchor's text as the title. Relative hrefs are
 * resolved against `baseUrl`. This is the scrape sources' fragile step — a firm
 * redesign changes the markup — so it is deliberately simple and inspectable.
 */
export function extractLinks(html: string, baseUrl: string, match: string): ArticleLink[] {
  const out: ArticleLink[] = [];
  const seen = new Set<string>();
  let anchors: Iterable<Anchor>;
  try {
    const { doc } = documentFor(html, baseUrl);
    anchors = doc.querySelectorAll('a[href]');
  } catch {
    return out;
  }

  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!resolved.includes(match)) continue;
    const url = canonicalizeUrl(resolved);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: (a.textContent ?? '').trim() });
  }
  return out;
}
