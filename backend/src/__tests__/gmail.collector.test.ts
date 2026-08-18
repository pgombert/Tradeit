import { describe, expect, it } from 'vitest';
import {
  attributeSender,
  buildGmailQuery,
  decodeBase64Url,
  extractDisplayName,
  extractFromAddress,
  extractPlainText,
  headerValue,
  MAX_BODY_CHARS,
  messageObservedAt,
  toLetterItem,
  type GmailMessage,
} from '../collectors/gmail.parse.js';

/** Gmail hands back URL-safe base64; this mirrors how a body is encoded on the wire. */
function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

describe('decodeBase64Url', () => {
  it('decodes URL-safe base64 back to the original text', () => {
    const text = 'Rates ↑ and credit spreads — wider? 100% sure';
    expect(decodeBase64Url(b64url(text))).toBe(text);
  });
});

describe('headerValue', () => {
  const headers = [
    { name: 'From', value: 'Torsten Slok <spark@apolloacademy.com>' },
    { name: 'Subject', value: 'The Daily Spark' },
  ];

  it('matches case-insensitively', () => {
    expect(headerValue(headers, 'from')).toBe('Torsten Slok <spark@apolloacademy.com>');
    expect(headerValue(headers, 'SUBJECT')).toBe('The Daily Spark');
  });

  it('returns empty string for a missing header', () => {
    expect(headerValue(headers, 'Reply-To')).toBe('');
    expect(headerValue(undefined, 'From')).toBe('');
  });
});

describe('extractFromAddress', () => {
  it('pulls the address out of an angle-bracketed From', () => {
    expect(extractFromAddress('Torsten Slok <Spark@ApolloAcademy.com>')).toBe(
      'spark@apolloacademy.com',
    );
  });

  it('returns a bare address lower-cased', () => {
    expect(extractFromAddress('Research@VerdadCap.com')).toBe('research@verdadcap.com');
  });
});

describe('extractPlainText', () => {
  it('prefers the text/plain part of a multipart message', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain body') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html body</p>') } },
      ],
    };
    expect(extractPlainText(payload)).toBe('plain body');
  });

  it('walks nested multipart parts to find the text', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [{ mimeType: 'text/plain', body: { data: b64url('nested plain') } }],
        },
      ],
    };
    expect(extractPlainText(payload)).toBe('nested plain');
  });

  it('falls back to stripped HTML when there is no plain part', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: b64url('<h1>Title</h1><p>Line one</p><p>Line two</p>') },
    };
    expect(extractPlainText(payload)).toBe('Title\nLine one\nLine two');
  });

  it('returns empty string when there is no textual body', () => {
    expect(extractPlainText({ mimeType: 'image/png', body: { data: b64url('x') } })).toBe('');
    expect(extractPlainText(undefined)).toBe('');
  });
});

describe('messageObservedAt', () => {
  const fallback = new Date('2026-08-17T12:00:00Z');

  it('uses internalDate when present', () => {
    const ms = Date.UTC(2026, 7, 15, 9, 30); // 2026-08-15 09:30 UTC
    const msg: GmailMessage = { id: 'm1', internalDate: String(ms) };
    expect(messageObservedAt(msg, fallback).toISOString()).toBe('2026-08-15T09:30:00.000Z');
  });

  it('falls back to the Date header when internalDate is missing', () => {
    const msg: GmailMessage = {
      id: 'm1',
      payload: { headers: [{ name: 'Date', value: 'Fri, 14 Aug 2026 06:00:00 +0000' }] },
    };
    expect(messageObservedAt(msg, fallback).toISOString()).toBe('2026-08-14T06:00:00.000Z');
  });

  it('falls back to the run time when nothing is parseable', () => {
    const msg: GmailMessage = { id: 'm1', internalDate: 'not-a-number' };
    expect(messageObservedAt(msg, fallback)).toBe(fallback);
  });
});

describe('toLetterItem', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  function messageFrom(from: string, body = 'body text'): GmailMessage {
    return {
      id: 'msg-123',
      threadId: 'thr-9',
      internalDate: String(Date.UTC(2026, 7, 16)),
      snippet: 'a snippet',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'Subject', value: 'Weekly note' },
        ],
        body: { data: b64url(body) },
      },
    };
  }

  it('attributes a known sender to its registry source', () => {
    const item = toLetterItem(messageFrom('Torsten Slok <spark@apolloacademy.com>'), now);
    expect(item.attribution.recognized).toBe(true);
    expect(item.attribution.sourceKey).toBe('apollo-daily-spark');
    expect(item.messageId).toBe('msg-123');
    expect(item.subject).toBe('Weekly note');
    expect(item.bodyText).toBe('body text');
    expect(item.truncated).toBe(false);
  });

  it('captures a sender not yet in the registry instead of dropping it', () => {
    // The inbox is subscription-only, so an unrecognized sender is a newsletter
    // we have not named yet — keep it, grouped by its own address.
    const item = toLetterItem(messageFrom('The Diff <byrne@thediff.co>'), now);
    expect(item.attribution.recognized).toBe(false);
    expect(item.attribution.sourceKey).toBe('byrne@thediff.co');
    expect(item.attribution.sourceName).toBe('The Diff');
    expect(item.fromAddress).toBe('byrne@thediff.co');
  });

  it('flags and caps an over-long body rather than storing it whole', () => {
    const huge = 'x'.repeat(MAX_BODY_CHARS + 500);
    const item = toLetterItem(messageFrom('research@verdadcap.com', huge), now);
    expect(item.truncated).toBe(true);
    expect(item.bodyText.length).toBe(MAX_BODY_CHARS);
  });
});

describe('extractDisplayName', () => {
  it('pulls the name before the angle brackets, unquoted', () => {
    expect(extractDisplayName('"Torsten Slok" <spark@apolloacademy.com>')).toBe('Torsten Slok');
    expect(extractDisplayName('Callum Thomas <callum@topdowncharts.com>')).toBe('Callum Thomas');
  });

  it('returns empty for a bare address', () => {
    expect(extractDisplayName('spark@apolloacademy.com')).toBe('');
  });
});

describe('attributeSender', () => {
  it('recognizes a registry sender with its curated fields', () => {
    const a = attributeSender('Callum Thomas <callum@topdowncharts.com>');
    expect(a).toMatchObject({ recognized: true, sourceKey: 'topdown-charts', stage: 'INTERNALS' });
  });

  it('keeps an unknown sender, keyed and named by its own address', () => {
    const a = attributeSender('Matt Levine <moneystuff@bloomberg.net>');
    expect(a.recognized).toBe(false);
    expect(a.sourceKey).toBe('moneystuff@bloomberg.net');
    expect(a.sourceName).toBe('Matt Levine');
    expect(a.stage).toBe('UNCLASSIFIED');
    expect(a.tier).toBeNull();
  });

  it('handles a From with no name or address gracefully', () => {
    const a = attributeSender('');
    expect(a.recognized).toBe(false);
    expect(a.sourceKey).toBe('unknown-sender');
  });
});

describe('buildGmailQuery', () => {
  it('captures all recent mail in the inbox', () => {
    // Capture-everything: no sender filter, so a newly subscribed letter flows
    // in with no code change.
    expect(buildGmailQuery(14)).toBe('newer_than:14d');
  });
});
