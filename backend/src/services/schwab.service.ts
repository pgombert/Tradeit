import type { AccountSnapshot } from '@tradeit/shared';
import { env } from '../config/environment.js';
import {
  firstAccountHash,
  SCHWAB_TRADER_BASE,
  toAccountSnapshot,
  type AccountNumberEntry,
  type SchwabAccount,
} from './schwab.parse.js';
import {
  getValidAccessToken,
  loadToken,
  saveAccountHash,
  SchwabAuthError,
} from './schwab.tokens.js';

/**
 * Schwab Trader API — read paths only.
 *
 * The trading endpoints exist on this API. We do not call them, and nothing in
 * this file may ever POST an order. Tradeit produces a brief; Pete places the
 * orders himself (docs/PLAN.md §0). The one account call we make is the
 * read-only `GET /trader/v1/accounts/{hash}?fields=positions`.
 */

export function isConfigured(): boolean {
  return Boolean(env.SCHWAB_CLIENT_ID && env.SCHWAB_CLIENT_SECRET && env.SCHWAB_REDIRECT_URI);
}

/** A disconnected snapshot — honest nulls, never a $0 for an unknown balance. */
function disconnected(message: string | null): AccountSnapshot {
  return {
    status: 'DISCONNECTED',
    connected: false,
    asOf: null,
    totalValue: null,
    settledCash: null,
    unsettledCash: null,
    positions: [],
    reauthAfter: null,
    message,
  };
}

async function schwabGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Schwab GET ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * The hashed account id Schwab requires in account URLs. Cached on the token row
 * after the first lookup; re-fetched if a reconnect cleared it.
 */
async function resolveAccountHash(accessToken: string): Promise<string> {
  const stored = await loadToken();
  if (stored?.accountHash) return stored.accountHash;

  const entries = await schwabGet<AccountNumberEntry[]>('/accounts/accountNumbers', accessToken);
  const hash = firstAccountHash(entries);
  if (!hash) throw new Error('Schwab returned no accounts for this login.');

  await saveAccountHash(hash);
  return hash;
}

/**
 * The live account snapshot for the dashboard. Every failure maps to an honest,
 * non-zero state rather than a thrown error:
 *  - credentials not set / never connected → DISCONNECTED
 *  - the 7-day login expired → EXPIRED (with a reconnect-by date)
 *  - Schwab reachable but erroring → ERROR (message shown, no invented number)
 */
export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  if (!isConfigured()) return disconnected('Schwab credentials are not set on the server.');

  try {
    const accessToken = await getValidAccessToken();
    const hash = await resolveAccountHash(accessToken);
    const account = await schwabGet<SchwabAccount>(
      `/accounts/${hash}?fields=positions`,
      accessToken,
    );
    return toAccountSnapshot(account, new Date());
  } catch (error) {
    if (error instanceof SchwabAuthError) {
      return {
        ...disconnected(error.message),
        status: error.kind === 'EXPIRED' ? 'EXPIRED' : 'DISCONNECTED',
        reauthAfter: error.reauthAfter?.toISOString() ?? null,
      };
    }
    // Reachable but failing — surface the reason, keep the balances null.
    console.error('[schwab] account snapshot failed:', error);
    return {
      ...disconnected(error instanceof Error ? error.message : String(error)),
      status: 'ERROR',
    };
  }
}
