import type { AccountSnapshot } from '@tradeit/shared';
import { env } from '../config/environment.js';

/**
 * Schwab Trader API — read paths only.
 *
 * The trading endpoints exist on this API. We do not call them, and nothing in
 * this file may ever POST an order. Tradeit produces a brief; Pete places the
 * orders himself (docs/PLAN.md §0).
 *
 * Phase 0 wires the shape and the credential check. The OAuth exchange lands in
 * Phase 1, once Pete's developer app at developer.schwab.com reaches
 * "Ready for use" and the callback URL is registered.
 */

export function isConfigured(): boolean {
  return Boolean(env.SCHWAB_CLIENT_ID && env.SCHWAB_CLIENT_SECRET && env.SCHWAB_REDIRECT_URI);
}

const DISCONNECTED: AccountSnapshot = {
  asOf: null,
  connected: false,
  totalValue: null,
  settledCash: null,
  unsettledCash: null,
  positions: [],
};

/**
 * Returns a disconnected snapshot until credentials exist, so the dashboard can
 * render an honest "not connected yet" state rather than zeros. Never returns
 * $0 for an unknown balance — see the loading-state rule in CLAUDE.md.
 */
export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  if (!isConfigured()) return DISCONNECTED;

  // Phase 1: OAuth token exchange + GET /trader/v1/accounts?fields=positions
  return DISCONNECTED;
}
