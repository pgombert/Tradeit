import { describe, expect, it } from 'vitest';
import {
  accessTokenExpiryFrom,
  basicAuthHeader,
  buildAuthorizeUrl,
  decStr,
  firstAccountHash,
  isExpired,
  maskAccountNumber,
  refreshTokenExpiryFrom,
  REFRESH_TOKEN_TTL_MS,
  toAccountOption,
  toAccountSnapshot,
  toPositionDto,
  type SchwabAccount,
  type SchwabTokenResponse,
} from '../services/schwab.parse.js';

describe('basicAuthHeader', () => {
  it('base64-encodes client:secret for the token endpoint', () => {
    // "id:secret" → aWQ6c2VjcmV0
    expect(basicAuthHeader('id', 'secret')).toBe('Basic aWQ6c2VjcmV0');
  });
});

describe('buildAuthorizeUrl', () => {
  it('requests read-only scope and carries the state nonce', () => {
    const url = new URL(buildAuthorizeUrl('APPKEY', 'https://trade.example/api/schwab/callback', 'st8'));
    expect(url.origin + url.pathname).toBe('https://api.schwabapi.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('APPKEY');
    expect(url.searchParams.get('redirect_uri')).toBe('https://trade.example/api/schwab/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('readonly');
    expect(url.searchParams.get('state')).toBe('st8');
  });
});

describe('token expiry maths', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  const resp: SchwabTokenResponse = {
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 1800,
  };

  it('sets the access-token expiry from expires_in seconds', () => {
    expect(accessTokenExpiryFrom(resp, now).toISOString()).toBe('2026-08-17T12:30:00.000Z');
  });

  it('sets the refresh-token expiry a fixed seven days out', () => {
    const expected = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    expect(refreshTokenExpiryFrom(now).toISOString()).toBe(expected.toISOString());
    expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('treats a token past its expiry (with skew) as expired', () => {
    const expiresAt = new Date('2026-08-17T12:00:30Z'); // 30s ahead
    expect(isExpired(expiresAt, now)).toBe(false);
    // With a 60s skew it should be considered expired already.
    expect(isExpired(expiresAt, now, 60_000)).toBe(true);
  });
});

describe('decStr', () => {
  it('turns a number into a string and passes null/NaN through as null', () => {
    expect(decStr(1234.56)).toBe('1234.56');
    expect(decStr(0)).toBe('0');
    expect(decStr(null)).toBeNull();
    expect(decStr(undefined)).toBeNull();
    expect(decStr(Number.NaN)).toBeNull();
  });
});

describe('firstAccountHash', () => {
  it('takes the first account hash, the only one this user holds', () => {
    expect(
      firstAccountHash([
        { accountNumber: '123', hashValue: 'HASH1' },
        { accountNumber: '456', hashValue: 'HASH2' },
      ]),
    ).toBe('HASH1');
  });

  it('returns null when there are no accounts', () => {
    expect(firstAccountHash([])).toBeNull();
  });
});

describe('toPositionDto', () => {
  it('maps a long position, keeping every amount as a string', () => {
    const dto = toPositionDto({
      instrument: { symbol: 'spy', assetType: 'ETF' },
      longQuantity: 100,
      averagePrice: 500.25,
      marketValue: 52000,
      longOpenProfitLoss: 1975,
    });
    expect(dto).toEqual({
      symbol: 'SPY',
      description: null,
      quantity: '100',
      averagePrice: '500.25',
      marketValue: '52000',
      unrealizedPnl: '1975',
    });
  });

  it('carries the instrument description for a coded symbol like a Treasury CUSIP', () => {
    const dto = toPositionDto({
      instrument: { symbol: '91282CLW9', assetType: 'FIXED_INCOME', description: 'US TREASURY NOTE 4.0% 2027' },
      longQuantity: 250,
      averagePrice: 97.51,
      marketValue: 243486.33,
      longOpenProfitLoss: -283.2,
    });
    expect(dto?.symbol).toBe('91282CLW9');
    expect(dto?.description).toBe('US TREASURY NOTE 4.0% 2027');
    expect(dto?.unrealizedPnl).toBe('-283.2');
  });

  it('drops a position with no symbol or zero size rather than inventing one', () => {
    expect(toPositionDto({ instrument: {}, longQuantity: 10 })).toBeNull();
    expect(toPositionDto({ instrument: { symbol: 'QQQ' }, longQuantity: 0 })).toBeNull();
  });
});

describe('maskAccountNumber', () => {
  it('shows only the last four digits', () => {
    expect(maskAccountNumber('12345678')).toBe('•••5678');
    expect(maskAccountNumber('....9012')).toBe('•••9012');
  });

  it('degrades gracefully when there is nothing to mask', () => {
    expect(maskAccountNumber(undefined)).toBe('account');
    expect(maskAccountNumber('12')).toBe('12');
  });
});

describe('toAccountOption', () => {
  it('summarizes an account for the picker: masked number, type, total value', () => {
    const option = toAccountOption('HASH-IRA', {
      securitiesAccount: {
        accountNumber: '55554321',
        type: 'CASH',
        currentBalances: { liquidationValue: 100000 },
      },
    });
    expect(option).toEqual({
      token: 'HASH-IRA',
      accountLabel: '•••4321',
      type: 'CASH',
      totalValue: '100000',
    });
  });
});

describe('toAccountSnapshot', () => {
  const asOf = new Date('2026-08-17T20:00:00Z');

  it('maps balances and positions into a connected snapshot', () => {
    const account: SchwabAccount = {
      securitiesAccount: {
        type: 'CASH',
        currentBalances: {
          liquidationValue: 101234.5,
          cashAvailableForTrading: 25000,
          cashBalance: 30000,
          unsettledCash: 5000,
        },
        positions: [
          {
            instrument: { symbol: 'QQQ' },
            longQuantity: 50,
            averagePrice: 400,
            marketValue: 21000,
            longOpenProfitLoss: 1000,
          },
        ],
      },
    };

    const snap = toAccountSnapshot(account, asOf);
    expect(snap.status).toBe('CONNECTED');
    expect(snap.connected).toBe(true);
    expect(snap.asOf).toBe('2026-08-17T20:00:00.000Z');
    expect(snap.totalValue).toBe('101234.5');
    // Settled cash is the cleared cash balance, NOT cashAvailableForTrading
    // (which reports margin buying power on the taxable account).
    expect(snap.settledCash).toBe('30000');
    expect(snap.unsettledCash).toBe('5000');
    expect(snap.positions).toHaveLength(1);
    expect(snap.positions[0]?.symbol).toBe('QQQ');
  });

  it('reports unknown balances as null, never as zero', () => {
    const snap = toAccountSnapshot({ securitiesAccount: { currentBalances: {} } }, asOf);
    expect(snap.totalValue).toBeNull();
    expect(snap.settledCash).toBeNull();
    // Unsettled is only reported when Schwab states it — never derived by hand.
    expect(snap.unsettledCash).toBeNull();
    expect(snap.positions).toEqual([]);
  });
});
