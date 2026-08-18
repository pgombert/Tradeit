import { Prisma } from '@prisma/client';
import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';
import {
  buildGmailQuery,
  toLetterItem,
  type GmailMessage,
  type LetterItem,
} from './gmail.parse.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

/**
 * How far back to look each run. Comfortably longer than the collector's daily
 * cadence, so a missed day is caught up; idempotent upserts absorb the overlap.
 */
const LOOKBACK_DAYS = 14;

/**
 * A backstop on a runaway inbox, not an expected limit — the newsletter account
 * receives a handful of letters a day. If it is ever hit we log it rather than
 * silently ingesting a truncated set (docs/PLAN.md: no silent caps).
 */
const MAX_MESSAGES = 500;

const UPSERT_CHUNK = 100;

export interface GmailCollectionResult {
  itemsWritten: number;
  messagesScanned: number;
  hitMessageCap: boolean;
}

interface ListResponse {
  messages?: { id: string }[];
  nextPageToken?: string;
}

/**
 * Exchange the stored refresh token for a short-lived access token. A Google
 * refresh token can be revoked or expire (docs/PLAN.md §2); when it does the
 * exchange returns `invalid_grant`, and we surface a re-authorize instruction
 * rather than a raw 400 so the failure is actionable.
 */
async function getAccessToken(): Promise<string> {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error(
      'Gmail collector is not configured — set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN (see docs/SETUP.md).',
    );
  }

  const body = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };

  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') {
      throw new Error(
        'Gmail refresh token is no longer valid — re-authorize the newsletter inbox and update GMAIL_REFRESH_TOKEN (docs/SETUP.md).',
      );
    }
    throw new Error(`Gmail token exchange failed (${res.status}): ${json.error ?? 'unknown error'}`);
  }

  return json.access_token;
}

/** List message ids matching the query, following pagination up to the cap. */
async function listMessageIds(
  accessToken: string,
  query: string,
): Promise<{ ids: string[]; hitCap: boolean }> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(GMAIL_BASE);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gmail list returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as ListResponse;
    for (const m of json.messages ?? []) {
      ids.push(m.id);
      if (ids.length >= MAX_MESSAGES) return { ids, hitCap: true };
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { ids, hitCap: false };
}

/** Fetch one message in full so its body and headers can be parsed. */
async function fetchMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const url = new URL(`${GMAIL_BASE}/${id}`);
  url.searchParams.set('format', 'full');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail get ${id} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as GmailMessage;
}

function itemPayload(item: LetterItem): Prisma.InputJsonObject {
  const { attribution } = item;
  return {
    recognized: attribution.recognized,
    sourceKey: attribution.sourceKey,
    sourceName: attribution.sourceName,
    author: attribution.author,
    stage: attribution.stage,
    tier: attribution.tier,
    messageId: item.messageId,
    threadId: item.threadId,
    subject: item.subject,
    from: item.from,
    fromAddress: item.fromAddress,
    snippet: item.snippet,
    bodyText: item.bodyText,
    truncated: item.truncated,
    receivedAt: item.observedAt.toISOString(),
  };
}

/**
 * Pulls the newsletter inbox into the Observation bus as LETTER_ITEM rows.
 * Idempotent: upserts on (NEWSLETTER, Gmail message id), so overlapping windows
 * and a re-run after a crash all reach the same end state. Every message is
 * captured; the payload's `recognized` flag and `sourceKey` record whether the
 * sender matched the registry or is a newsletter we haven't named yet.
 */
export async function collectGmail(): Promise<GmailCollectionResult> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'gmail', status: 'RUNNING' },
  });

  try {
    const accessToken = await getAccessToken();
    const query = buildGmailQuery(LOOKBACK_DAYS);
    const { ids, hitCap } = await listMessageIds(accessToken, query);

    const now = new Date();
    const items: LetterItem[] = [];
    for (const id of ids) {
      items.push(toLetterItem(await fetchMessage(accessToken, id), now));
    }

    for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
      const chunk = items.slice(i, i + UPSERT_CHUNK);
      await prisma.$transaction(
        chunk.map((item) => {
          const payload = itemPayload(item);
          return prisma.observation.upsert({
            where: { source_sourceRef: { source: 'NEWSLETTER', sourceRef: item.messageId } },
            create: {
              source: 'NEWSLETTER',
              sourceRef: item.messageId,
              // Macro and market letters are index-wide; a candidate-specific
              // read is Stage 2's job, not the collector's.
              scope: 'MARKET',
              kind: 'LETTER_ITEM',
              observedAt: item.observedAt,
              payload,
            },
            update: { payload },
          });
        }),
      );
    }

    if (hitCap) {
      console.warn(
        `[gmail] hit the ${MAX_MESSAGES}-message cap — some letters were not scanned. Widen the cap or narrow the window.`,
      );
    }
    const recognized = items.filter((i) => i.attribution.recognized).length;
    console.log(
      `[gmail] ${items.length} letters captured — ${recognized} recognized, ${items.length - recognized} from senders not yet named`,
    );

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), recordsWritten: items.length },
    });

    return { itemsWritten: items.length, messagesScanned: ids.length, hitMessageCap: hitCap };
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
