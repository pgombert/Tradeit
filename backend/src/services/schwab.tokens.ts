import { prisma } from '../lib/prisma.js';
import { refreshAccessToken } from './schwab.oauth.js';
import {
  accessTokenExpiryFrom,
  ACCESS_TOKEN_SKEW_MS,
  isExpired,
  refreshTokenExpiryFrom,
  type SchwabTokenResponse,
} from './schwab.parse.js';

/**
 * The Schwab connection's token store. One row — one account, one user — keyed
 * on a constant id. The refresh token is a brokerage credential, so it never
 * leaves the server and is never logged.
 */

/** Constant primary key for the single connection row. */
const SINGLETON = 'schwab';

/**
 * Why a read can't reach Schwab, in the two cases the dashboard must tell apart:
 *  - NOT_CONNECTED — no token has ever been stored; offer "Connect Schwab".
 *  - EXPIRED       — the 7-day refresh token lapsed; offer "Reconnect Schwab".
 * Any other failure is a plain Error and surfaces as the ERROR state.
 */
export type SchwabAuthErrorKind = 'NOT_CONNECTED' | 'EXPIRED';

export class SchwabAuthError extends Error {
  constructor(
    readonly kind: SchwabAuthErrorKind,
    message: string,
    /** When the login expired, for the reconnect prompt. */
    readonly reauthAfter: Date | null = null,
  ) {
    super(message);
    this.name = 'SchwabAuthError';
  }
}

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  accountHash: string | null;
}

export async function loadToken(): Promise<StoredToken | null> {
  return prisma.schwabToken.findUnique({ where: { id: SINGLETON } });
}

/**
 * Persist the token pair from a fresh connect (the authorization-code grant).
 * This is the only place the 7-day refresh-token window is (re)set — refreshing
 * the access token does not extend it, so a reconnect here is what resets the
 * weekly clock.
 */
export async function saveFromAuthCode(resp: SchwabTokenResponse, now = new Date()): Promise<void> {
  const data = {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    accessTokenExpiresAt: accessTokenExpiryFrom(resp, now),
    refreshTokenExpiresAt: refreshTokenExpiryFrom(now),
    scope: resp.scope ?? null,
  };
  await prisma.schwabToken.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data },
    // A reconnect clears the stale account hash so it is re-fetched fresh.
    update: { ...data, accountHash: null },
  });
}

/** Cache the hashed account id so each read need not re-list accounts. */
export async function saveAccountHash(accountHash: string): Promise<void> {
  await prisma.schwabToken.update({ where: { id: SINGLETON }, data: { accountHash } });
}

/**
 * A usable access token, refreshing it from the stored refresh token when it has
 * aged out. Throws a typed SchwabAuthError when there is nothing to refresh from
 * or the refresh token itself has expired, so the caller can render the right
 * connect/reconnect prompt rather than a raw failure.
 */
export async function getValidAccessToken(now = new Date()): Promise<string> {
  const token = await loadToken();
  if (!token) {
    throw new SchwabAuthError('NOT_CONNECTED', 'Schwab is not connected yet.');
  }

  if (isExpired(token.refreshTokenExpiresAt, now)) {
    throw new SchwabAuthError(
      'EXPIRED',
      'The Schwab login has expired — reconnect to resume live account data.',
      token.refreshTokenExpiresAt,
    );
  }

  if (!isExpired(token.accessTokenExpiresAt, now, ACCESS_TOKEN_SKEW_MS)) {
    return token.accessToken;
  }

  // Access token has aged out but the refresh token is still good — refresh,
  // persist, and hand back the new access token. The 7-day window is untouched.
  const refreshed = await refreshAccessToken(token.refreshToken);
  await prisma.schwabToken.update({
    where: { id: SINGLETON },
    data: {
      accessToken: refreshed.access_token,
      // Schwab returns the same refresh token on a refresh; store it verbatim.
      // The refresh-token expiry is deliberately left as-is — refreshing never
      // extends the 7-day window.
      refreshToken: refreshed.refresh_token,
      accessTokenExpiresAt: accessTokenExpiryFrom(refreshed, now),
    },
  });
  return refreshed.access_token;
}
