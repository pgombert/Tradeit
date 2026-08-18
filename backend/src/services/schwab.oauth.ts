import { env } from '../config/environment.js';
import { basicAuthHeader, SCHWAB_TOKEN_URL, type SchwabTokenResponse } from './schwab.parse.js';

/**
 * The two Schwab token-endpoint calls. Read-only OAuth: we exchange a code for
 * tokens and refresh the access token, and that is all. Nothing here places,
 * cancels, or replaces an order — the credentials could, and no line ever will
 * (docs/PLAN.md §0).
 */

function requireCredentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  const { SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, SCHWAB_REDIRECT_URI } = env;
  if (!SCHWAB_CLIENT_ID || !SCHWAB_CLIENT_SECRET || !SCHWAB_REDIRECT_URI) {
    throw new Error(
      'Schwab is not configured — set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET and SCHWAB_REDIRECT_URI (docs/SETUP.md).',
    );
  }
  return {
    clientId: SCHWAB_CLIENT_ID,
    clientSecret: SCHWAB_CLIENT_SECRET,
    redirectUri: SCHWAB_REDIRECT_URI,
  };
}

async function postToken(body: URLSearchParams): Promise<SchwabTokenResponse> {
  const { clientId, clientSecret } = requireCredentials();

  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json().catch(() => ({}))) as SchwabTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`Schwab token exchange failed: ${detail}`);
  }
  return json;
}

/** Exchange the authorization code from the callback for the first token pair. */
export function exchangeAuthCode(code: string): Promise<SchwabTokenResponse> {
  const { redirectUri } = requireCredentials();
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  );
}

/** Trade a still-valid refresh token for a fresh access token. */
export function refreshAccessToken(refreshToken: string): Promise<SchwabTokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  );
}
