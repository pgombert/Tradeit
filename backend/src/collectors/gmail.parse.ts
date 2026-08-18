/**
 * Pure helpers for the Gmail newsletter collector. No config, no network, no
 * Prisma — so the decoding, sender-matching and normalization can be tested
 * against fixture messages without an inbox or a database.
 *
 * The collector's job is provenance, not interpretation: it turns a raw email
 * into one citable LETTER_ITEM observation. Pulling tickers or a thesis out of
 * the prose is Stage 2/3 work, deliberately not done here.
 */
import { newsletterSourceForFrom, type NewsletterStage } from '@tradeit/shared';

/** A header as Gmail returns it. */
export interface GmailHeader {
  name: string;
  value: string;
}

/** A message payload part — recursive, since multipart bodies nest. */
export interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

/** A message as `messages.get?format=full` returns it. */
export interface GmailMessage {
  id: string;
  threadId?: string;
  /** Milliseconds since the epoch, as a string — Gmail's own receive time. */
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

/**
 * How a message's sender was attributed. The inbox is subscription-only, so we
 * ingest everything and tag it: a sender in the registry gets its curated name
 * and stage; an unrecognized sender is kept and grouped by its own address, so
 * nothing is dropped and the nice-name mapping can be filled in later from the
 * senders we actually see. See docs/PLAN.md §3.
 */
export interface LetterAttribution {
  /** True when the sender matched a source in the registry. */
  recognized: boolean;
  /** Stable grouping key: the registry key, or the sender address for unknowns. */
  sourceKey: string;
  sourceName: string;
  author: string | null;
  stage: NewsletterStage | 'UNCLASSIFIED';
  tier: number | null;
}

/** A normalized letter, ready to become an observation. */
export interface LetterItem {
  /** Gmail's message id — globally unique and stable, so it is the sourceRef. */
  messageId: string;
  threadId: string | null;
  attribution: LetterAttribution;
  /** The bare sender address, lower-cased. */
  fromAddress: string;
  from: string;
  subject: string;
  snippet: string;
  /** Decoded plain-text body, possibly truncated. */
  bodyText: string;
  truncated: boolean;
  /** When the letter arrived. */
  observedAt: Date;
}

/**
 * Bodies are stored so Stage 2 can build a packet from them, but an email can
 * carry a very large HTML payload. Cap the stored text and flag when we did, so
 * a truncated body is never mistaken for a short one.
 */
export const MAX_BODY_CHARS = 100_000;

/** Decode Gmail's URL-safe base64 (`-`/`_`, no padding) to a UTF-8 string. */
export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Case-insensitive header lookup; returns '' when absent. */
export function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

/**
 * The bare email address out of a From header. `"Torsten Slok"
 * <spark@apolloacademy.com>` → `spark@apolloacademy.com`; a bare address is
 * returned as-is. Lower-cased so matching is stable.
 */
export function extractFromAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled?.[1] ?? from).trim().toLowerCase();
}

/**
 * The human display name from a From header: `"Torsten Slok"
 * <spark@apolloacademy.com>` → `Torsten Slok`. Returns '' when the header is a
 * bare address with no name. Surrounding quotes are stripped.
 */
export function extractDisplayName(from: string): string {
  const idx = from.indexOf('<');
  if (idx <= 0) return '';
  return from.slice(0, idx).trim().replace(/^"|"$/g, '').trim();
}

/**
 * Attribute a sender. A registry match carries the curated name, author, stage
 * and tier. An unrecognized sender is still ingested — keyed on its own address
 * so every message from it groups together, named by its display name so the
 * store is readable before anyone maps it.
 */
export function attributeSender(from: string): LetterAttribution {
  const address = extractFromAddress(from);
  const known = newsletterSourceForFrom(address);
  if (known) {
    return {
      recognized: true,
      sourceKey: known.key,
      sourceName: known.name,
      author: known.author,
      stage: known.stage,
      tier: known.tier,
    };
  }
  const displayName = extractDisplayName(from);
  return {
    recognized: false,
    sourceKey: address || 'unknown-sender',
    sourceName: displayName || address || 'Unknown sender',
    author: null,
    stage: 'UNCLASSIFIED',
    tier: null,
  };
}

/** A crude tags-to-text fallback for HTML-only emails — no plain-text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The best plain-text body we can get: the first `text/plain` part if one
 * exists, otherwise `text/html` stripped to text. Walks the multipart tree
 * depth-first. Returns '' when there is no textual body at all.
 */
export function extractPlainText(payload: GmailPart | undefined): string {
  if (!payload) return '';

  const plains: string[] = [];
  const htmls: string[] = [];

  const walk = (part: GmailPart): void => {
    const mime = part.mimeType?.toLowerCase() ?? '';
    const data = part.body?.data;
    if (data) {
      if (mime === 'text/plain') plains.push(decodeBase64Url(data));
      else if (mime === 'text/html') htmls.push(decodeBase64Url(data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  if (plains.length > 0) return plains.join('\n').trim();
  if (htmls.length > 0) return htmlToText(htmls.join('\n'));
  return '';
}

/**
 * Gmail's `internalDate` (ms epoch) is the received time and the value we key
 * ordering and dossier windows on. Falls back to the Date header, then to
 * `fallback` (the run time) so a malformed message still gets a sane timestamp
 * rather than an Invalid Date.
 */
export function messageObservedAt(msg: GmailMessage, fallback: Date): Date {
  if (msg.internalDate) {
    const ms = Number(msg.internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  const dateHeader = headerValue(msg.payload?.headers, 'Date');
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

/**
 * Normalize one Gmail message into a LetterItem. Every message is kept — the
 * inbox is subscription-only, so an unrecognized sender is a newsletter we
 * haven't named yet, not noise. Attribution records which case it is.
 */
export function toLetterItem(msg: GmailMessage, now: Date): LetterItem {
  const headers = msg.payload?.headers;
  const from = headerValue(headers, 'From');
  const full = extractPlainText(msg.payload);
  const truncated = full.length > MAX_BODY_CHARS;

  return {
    messageId: msg.id,
    threadId: msg.threadId ?? null,
    attribution: attributeSender(from),
    fromAddress: extractFromAddress(from),
    from,
    subject: headerValue(headers, 'Subject'),
    snippet: msg.snippet ?? '',
    bodyText: truncated ? full.slice(0, MAX_BODY_CHARS) : full,
    truncated,
    observedAt: messageObservedAt(msg, now),
  };
}

/**
 * The Gmail search query: all recent mail in the inbox. The inbox is dedicated
 * to newsletters, so we capture everything and attribute it rather than
 * pre-filtering by sender — that way a newly subscribed letter flows in with no
 * code change. `newer_than:Nd` is Gmail's own relative window; idempotent
 * upserts on the message id absorb any overlap between runs. Spam and trash are
 * excluded by Gmail's default list behaviour.
 */
export function buildGmailQuery(lookbackDays: number): string {
  return `newer_than:${lookbackDays}d`;
}
