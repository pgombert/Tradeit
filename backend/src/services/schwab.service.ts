import { Prisma } from '@prisma/client';
import type {
  AccountSnapshot,
  PortfolioSnapshot,
  PositionDto,
  SchwabAccountOption,
} from '@tradeit/shared';
import { env } from '../config/environment.js';
import {
  aggregatePositions,
  decStr,
  firstAccountHash,
  maskAccountNumber,
  SCHWAB_TRADER_BASE,
  toAccountOption,
  toAccountSnapshot,
  toPositionDto,
  type AccountNumberEntry,
  type AccountPositions,
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
 * orders himself (docs/PLAN.md §0). The account calls we make are the read-only
 * `GET /trader/v1/accounts/accountNumbers` and
 * `GET /trader/v1/accounts/{hash}?fields=positions`.
 */

export function isConfigured(): boolean {
  return Boolean(env.SCHWAB_CLIENT_ID && env.SCHWAB_CLIENT_SECRET && env.SCHWAB_REDIRECT_URI);
}

/** A non-connected snapshot — honest nulls, never a $0 for an unknown balance. */
function bareSnapshot(overrides: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    status: 'DISCONNECTED',
    connected: false,
    asOf: null,
    totalValue: null,
    settledCash: null,
    unsettledCash: null,
    positions: [],
    reauthAfter: null,
    message: null,
    accounts: [],
    selectedAccountLabel: null,
    ...overrides,
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

function listAccountNumbers(accessToken: string): Promise<AccountNumberEntry[]> {
  return schwabGet<AccountNumberEntry[]>('/accounts/accountNumbers', accessToken);
}

function fetchAccount(hash: string, accessToken: string): Promise<SchwabAccount> {
  return schwabGet<SchwabAccount>(`/accounts/${hash}?fields=positions`, accessToken);
}

/** The accounts this login exposes, summarized for the picker. */
export async function listAccounts(): Promise<SchwabAccountOption[]> {
  const accessToken = await getValidAccessToken();
  const entries = await listAccountNumbers(accessToken);
  return Promise.all(
    entries.map(async (e) => toAccountOption(e.hashValue, await fetchAccount(e.hashValue, accessToken))),
  );
}

/** Record which account to track from here on. Validates the token first. */
export async function selectAccount(token: string): Promise<void> {
  const accessToken = await getValidAccessToken();
  const entries = await listAccountNumbers(accessToken);
  if (!entries.some((e) => e.hashValue === token)) {
    throw new SchwabAuthError('NOT_CONNECTED', 'That account is no longer available on this login.');
  }
  await saveAccountHash(token);
}

/**
 * The live account snapshot for the dashboard. Every failure maps to an honest,
 * non-zero state rather than a thrown error:
 *  - credentials not set / never connected → DISCONNECTED
 *  - more than one account and none chosen → CHOOSE_ACCOUNT (with the list)
 *  - the 7-day login expired → EXPIRED (with a reconnect-by date)
 *  - Schwab reachable but erroring → ERROR (message shown, no invented number)
 */
export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  if (!isConfigured()) {
    return bareSnapshot({ message: 'Schwab credentials are not set on the server.' });
  }

  try {
    const accessToken = await getValidAccessToken();
    const stored = await loadToken();

    // An account has already been chosen (or auto-selected) — use it.
    if (stored?.accountHash) {
      const account = await fetchAccount(stored.accountHash, accessToken);
      return toAccountSnapshot(account, new Date());
    }

    // First read after connecting: which account?
    const entries = await listAccountNumbers(accessToken);
    if (entries.length === 0) {
      return bareSnapshot({ status: 'ERROR', message: 'Schwab returned no accounts for this login.' });
    }
    if (entries.length === 1) {
      const only = firstAccountHash(entries);
      if (only) await saveAccountHash(only);
      const account = await fetchAccount(only ?? '', accessToken);
      return toAccountSnapshot(account, new Date());
    }

    // More than one account — let Pete pick which to track (his IRA).
    const accounts = await Promise.all(
      entries.map(async (e) => toAccountOption(e.hashValue, await fetchAccount(e.hashValue, accessToken))),
    );
    return bareSnapshot({
      status: 'CHOOSE_ACCOUNT',
      message: 'More than one Schwab account is linked — choose which to track.',
      accounts,
    });
  } catch (error) {
    if (error instanceof SchwabAuthError) {
      return bareSnapshot({
        status: error.kind === 'EXPIRED' ? 'EXPIRED' : 'DISCONNECTED',
        message: error.message,
        reauthAfter: error.reauthAfter?.toISOString() ?? null,
      });
    }
    console.error('[schwab] account snapshot failed:', error);
    return bareSnapshot({
      status: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A not-connected portfolio — honest nulls, never a $0 for an unknown balance. */
function barePortfolio(overrides: Partial<PortfolioSnapshot>): PortfolioSnapshot {
  return {
    status: 'DISCONNECTED',
    asOf: null,
    totalValue: null,
    investedValue: null,
    positions: [],
    accounts: [],
    reauthAfter: null,
    message: null,
    ...overrides,
  };
}

/**
 * The consolidated portfolio across EVERY account on the Schwab login — the "see
 * all positions at once" view. Unlike getAccountSnapshot, it never asks which
 * account to track; it includes them all and aggregates holdings by symbol.
 * Read-only, like everything Schwab here.
 */
export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  if (!isConfigured()) {
    return barePortfolio({ message: 'Schwab credentials are not set on the server.' });
  }
  try {
    const accessToken = await getValidAccessToken();
    const entries = await listAccountNumbers(accessToken);
    if (entries.length === 0) {
      return barePortfolio({ status: 'ERROR', message: 'Schwab returned no accounts for this login.' });
    }

    const accounts: AccountPositions[] = await Promise.all(
      entries.map(async (e): Promise<AccountPositions> => {
        const acct = await fetchAccount(e.hashValue, accessToken);
        const sec = acct.securitiesAccount;
        const positions = (sec?.positions ?? [])
          .map(toPositionDto)
          .filter((p): p is PositionDto => p !== null);
        return {
          label: maskAccountNumber(sec?.accountNumber),
          type: sec?.type ?? null,
          totalValue: decStr(sec?.currentBalances?.liquidationValue),
          positions,
        };
      }),
    );

    const { positions, investedValue, accountSummaries } = aggregatePositions(accounts);
    const totalValue = accountSummaries
      .reduce((sum, a) => sum.add(new Prisma.Decimal(a.totalValue ?? '0')), new Prisma.Decimal(0))
      .toString();

    return {
      status: 'CONNECTED',
      asOf: new Date().toISOString(),
      totalValue,
      investedValue,
      positions,
      accounts: accountSummaries,
      reauthAfter: null,
      message: null,
    };
  } catch (error) {
    if (error instanceof SchwabAuthError) {
      return barePortfolio({
        status: error.kind === 'EXPIRED' ? 'EXPIRED' : 'DISCONNECTED',
        message: error.message,
        reauthAfter: error.reauthAfter?.toISOString() ?? null,
      });
    }
    console.error('[schwab] portfolio snapshot failed:', error);
    return barePortfolio({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) });
  }
}
