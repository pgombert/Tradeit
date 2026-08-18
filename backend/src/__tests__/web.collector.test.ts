import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, parseFeed, recentItems } from '../collectors/feed.parse.js';
import { extractArticle, extractLinks } from '../collectors/extract.js';

describe('canonicalizeUrl', () => {
  it('drops the fragment and tracking params but keeps real query keys', () => {
    expect(canonicalizeUrl('https://Example.com/post?id=7&utm_source=rss&ref=twitter#top')).toBe(
      'https://example.com/post?id=7',
    );
  });

  it('removes a trailing slash but never the bare-root slash', () => {
    expect(canonicalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns an unparseable string untouched rather than throwing', () => {
    expect(canonicalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('parseFeed — RSS', () => {
  const rss = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>Test Blog</title>
      <item>
        <title>First Post</title>
        <link>https://blog.example/first?utm_medium=email</link>
        <pubDate>Sat, 16 Aug 2026 10:00:00 +0000</pubDate>
        <content:encoded><![CDATA[<p>Full body of the first post.</p>]]></content:encoded>
      </item>
      <item>
        <title>Second Post</title>
        <link>https://blog.example/second</link>
        <pubDate>Fri, 15 Aug 2026 09:00:00 +0000</pubDate>
        <description>Just a summary.</description>
      </item>
    </channel></rss>`;

  it('normalizes items, canonicalizing links and preferring full content', () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'First Post', url: 'https://blog.example/first' });
    expect(items[0]?.contentHtml).toContain('Full body');
    expect(items[0]?.publishedAt?.toISOString()).toBe('2026-08-16T10:00:00.000Z');
    expect(items[1]?.contentHtml).toBe('Just a summary.');
  });
});

describe('parseFeed — Atom', () => {
  const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Blog</title>
      <entry>
        <title>Atom Post</title>
        <link rel="alternate" href="https://atom.example/post-1"/>
        <link rel="edit" href="https://atom.example/edit/1"/>
        <published>2026-08-14T08:00:00Z</published>
        <content type="html">The atom body.</content>
      </entry>
    </feed>`;

  it('reads the alternate link, not the edit link, and the published date', () => {
    const items = parseFeed(atom);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://atom.example/post-1');
    expect(items[0]?.publishedAt?.toISOString()).toBe('2026-08-14T08:00:00.000Z');
    expect(items[0]?.contentHtml).toBe('The atom body.');
  });
});

describe('parseFeed — resilience', () => {
  it('returns an empty list for junk rather than throwing', () => {
    expect(parseFeed('<html><body>not a feed</body></html>')).toEqual([]);
    expect(parseFeed('')).toEqual([]);
  });
});

describe('recentItems', () => {
  const mk = (iso: string | null) => ({ title: 't', url: 'u', publishedAt: iso ? new Date(iso) : null, contentHtml: '' });

  it('keeps items on or after the cutoff, and all undated items', () => {
    const cutoff = new Date('2026-08-10T00:00:00Z');
    const items = [mk('2026-08-12T00:00:00Z'), mk('2026-08-01T00:00:00Z'), mk(null)];
    const kept = recentItems(items, cutoff).map((i) => i.publishedAt?.toISOString() ?? 'undated');
    expect(kept).toEqual(['2026-08-12T00:00:00.000Z', 'undated']);
  });
});

describe('extractArticle', () => {
  it('pulls the readable article text out of a page full of chrome', () => {
    const html = `<html><head><title>Site — Post Title</title></head><body>
      <nav>Home About Contact</nav>
      <header>A masthead</header>
      <article>
        <h1>The Real Headline</h1>
        <p>This is the first substantial paragraph of the actual essay, long enough that the reader-mode extractor treats it as the main content of the document.</p>
        <p>And here is a second paragraph continuing the argument with more real sentences so the article body is clearly the densest text on the page.</p>
      </article>
      <footer>Copyright 2026</footer>
    </body></html>`;
    const out = extractArticle(html, 'https://site.example/post');
    expect(out.text).toContain('first substantial paragraph');
    expect(out.text).toContain('second paragraph');
    expect(out.text).not.toContain('Copyright 2026');
    expect(out.truncated).toBe(false);
  });

  it('falls back to body text when there is no article structure', () => {
    const out = extractArticle('<html><body><div>Bare body words here.</div></body></html>', 'https://x.example');
    expect(out.text).toContain('Bare body words here');
  });
});

describe('extractLinks', () => {
  const listing = `<html><body>
    <a href="/insights/notes-on-the-week-ahead/what-lies-beneath/">What Lies Beneath</a>
    <a href="https://am.example/insights/notes-on-the-week-ahead/prior-note/">Prior Note</a>
    <a href="/about">About Us</a>
    <a href="/insights/notes-on-the-week-ahead/what-lies-beneath/#top">Dup fragment</a>
  </body></html>`;

  it('keeps only matching links, resolves relatives, and de-dupes', () => {
    const links = extractLinks(listing, 'https://am.example/', '/notes-on-the-week-ahead/');
    expect(links.map((l) => l.url)).toEqual([
      'https://am.example/insights/notes-on-the-week-ahead/what-lies-beneath',
      'https://am.example/insights/notes-on-the-week-ahead/prior-note',
    ]);
    expect(links[0]?.title).toBe('What Lies Beneath');
  });
});
