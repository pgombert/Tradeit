import type { AccountSnapshot, PositionDto, SchwabAccountOption } from '@tradeit/shared';

/**
 * Pure Schwab helpers — no network, no database, so they can be tested against
 * fixtures. The network calls live in schwab.oauth.ts; the token store in
 * schwab.tokens.ts. Read paths only: nothing here builds an order.
 *
 * Money arrives from Schwab as JSON numbers. Per CLAUDE.md we never let a market
 * value live as a JavaScript `number` — every amount is turned into a string at
 * this boundary and handed on as a string, so no float arithmetic ever touches
 * a balance or a price.
 */

export const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
export const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
export const SCHWAB_TRADER_BASE = 'https://api.schwabapi.com/trader/v1';

/**
 * Schwab's refresh token is valid for seven days from the moment it is minted,
 * and refreshing the access token does NOT extend that window — so a reconnect
 * is due about weekly (docs/PLAN.md §2).
 */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Refresh the access token a little early, so a call never races the expiry. */
export const ACCESS_TOKEN_SKEW_MS = 60_000;

/** The token response Schwab returns from both grant types. */
export interface SchwabTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds; the access token, ~1800
  token_type?: string;
  scope?: string;
  id_token?: string;
}

/** The Authorization header value for the token endpoint (Basic client:secret). */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * The URL Schwab sends the user to in order to grant access. `state` is our
 * signed nonce; the callback verifies it, so a stray call to the callback can't
 * plant a token.
 */
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(SCHWAB_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'readonly');
  url.searchParams.set('state', state);
  return url.toString();
}

/** When the access token in this response stops being valid. */
export function accessTokenExpiryFrom(resp: SchwabTokenResponse, now: Date): Date {
  return new Date(now.getTime() + resp.expires_in * 1000);
}

/** When the refresh token minted now stops being valid — a fixed 7-day window. */
export function refreshTokenExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}

/** True when `expiresAt` is close enough that we should refresh before using it. */
export function isExpired(expiresAt: Date, now: Date, skewMs = 0): boolean {
  return expiresAt.getTime() - skewMs <= now.getTime();
}

/** A market value from Schwab as a string, or null — never a JS number downstream. */
export function decStr(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return String(value);
}

// ---- Account response mapping ------------------------------------------------
//
// The shapes below cover the fields we read from
//   GET /trader/v1/accounts/{hash}?fields=positions
// Schwab wraps the account in `securitiesAccount`; a cash IRA reports its money
// under `currentBalances`. We read defensively — Schwab omits zero-valued fields
// on some accounts — and only touch read-only balance and position data.

export interface SchwabInstrument {
  symbol?: string;
  assetType?: string;
  /** A readable name — Schwab supplies this for bonds and funds. */
  description?: string;
}

export interface SchwabPosition {
  instrument?: SchwabInstrument;
  longQuantity?: number;
  shortQuantity?: number;
  averagePrice?: number;
  marketValue?: number;
  longOpenProfitLoss?: number;
  currentDayProfitLoss?: number;
}

export interface SchwabBalances {
  liquidationValue?: number;
  cashBalance?: number;
  totalCash?: number;
  cashAvailableForTrading?: number;
  availableFunds?: number;
  unsettledCash?: number;
  cashAvailableForWithdrawal?: number;
  // Margin-account fields — present on the taxable account, absent on a cash
  // IRA. We do not treat buying power as cash.
  buyingPower?: number;
}

export interface SchwabAccount {
  securitiesAccount?: {
    accountNumber?: string;
    type?: string;
    currentBalances?: SchwabBalances;
    positions?: SchwabPosition[];
  };
}

export interface AccountNumberEntry {
  accountNumber: string;
  hashValue: string;
}

/** Pick the hashed id for the first account, which is all this single user holds. */
export function firstAccountHash(entries: AccountNumberEntry[]): string | null {
  return entries[0]?.hashValue ?? null;
}

/** Show only the last four digits of an account number. */
export function maskAccountNumber(accountNumber: string | undefined): string {
  const digits = (accountNumber ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : accountNumber ?? 'account';
}

/** One account's summary for the picker: masked number, type, and total value. */
export function toAccountOption(hashValue: string, account: SchwabAccount): SchwabAccountOption {
  const acct = account.securitiesAccount;
  return {
    token: hashValue,
    accountLabel: maskAccountNumber(acct?.accountNumber),
    type: acct?.type ?? null,
    totalValue: decStr(acct?.currentBalances?.liquidationValue),
  };
}

/** One Schwab position → the DTO, dropping anything with no symbol or no size. */
export function toPositionDto(p: SchwabPosition): PositionDto | null {
  const symbol = p.instrument?.symbol?.trim().toUpperCase();
  if (!symbol) return null;

  // IRAs are long-only (docs/PLAN.md §2); a long-inverse-ETF still reports as a
  // long quantity, so `longQuantity` is the size we care about.
  const quantity = p.longQuantity ?? 0;
  if (quantity === 0) return null;

  return {
    symbol,
    description: p.instrument?.description?.trim() || null,
    quantity: String(quantity),
    averagePrice: decStr(p.averagePrice) ?? '0',
    marketValue: decStr(p.marketValue) ?? '0',
    unrealizedPnl: decStr(p.longOpenProfitLoss) ?? '0',
  };
}

/**
 * A raw Schwab account payload → the connected AccountSnapshot the dashboard
 * reads. Settled vs. unsettled cash matters for the T+1 ledger (docs/PLAN.md §2):
 * `cashAvailableForTrading` is what has settled and can be traded now; the rest
 * of the cash balance is still settling.
 */
export function toAccountSnapshot(account: SchwabAccount, asOf: Date): AccountSnapshot {
  const acct = account.securitiesAccount;
  const bal = acct?.currentBalances ?? {};

  // Settled cash is the actual cash that has cleared — NOT buying power. On the
  // taxable margin account `cashAvailableForTrading` reports margin buying power
  // (which inflated the figure Pete saw); `cashBalance`/`totalCash` is the real
  // settled cash on both account types.
  const settled = bal.cashBalance ?? bal.totalCash ?? null;
  // Report only what Schwab states outright. Deriving unsettled = total − settled
  // would mean float arithmetic on money (CLAUDE.md forbids it); "unknown" stays
  // honest rather than a wrong or zero figure.
  const unsettled = bal.unsettledCash ?? null;

  const positions = (acct?.positions ?? [])
    .map(toPositionDto)
    .filter((p): p is PositionDto => p !== null);

  return {
    status: 'CONNECTED',
    connected: true,
    asOf: asOf.toISOString(),
    totalValue: decStr(bal.liquidationValue),
    settledCash: decStr(settled),
    unsettledCash: decStr(unsettled),
    positions,
    reauthAfter: null,
    message: null,
    accounts: [],
    selectedAccountLabel: maskAccountNumber(acct?.accountNumber),
  };
}
