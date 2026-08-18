import { Prisma } from '@prisma/client';
import { INSTRUMENTS, STOCK_UNIVERSE, type AssetClass } from '@tradeit/shared';

/**
 * Pure helpers for the Schwab price-history collector — no network, no database,
 * so they test against fixtures. Market data only; nothing here can trade.
 *
 * Prices arrive from Schwab as JSON numbers. We turn every price into a string
 * at this boundary (CLAUDE.md: market values are never JavaScript numbers) and
 * do the one piece of arithmetic we need — average dollar volume — with Decimal.
 */

export const SCHWAB_MARKETDATA_BASE = 'https://api.schwabapi.com/marketdata/v1';

/** How far back to reach the first time we collect a symbol. */
export const INITIAL_LOOKBACK_DAYS = 365;

/**
 * On an incremental run, re-request a small window behind the last bar we hold.
 * Daily bars settle quickly, but a late print or a split adjustment is absorbed
 * by re-upserting the tail rather than trusting the last stored date exactly.
 */
export const REVISION_WINDOW_DAYS = 5;

/** How many recent sessions feed the trailing average-dollar-volume figure. */
export const ADV_WINDOW = 20;

/** One raw daily candle from GET /marketdata/v1/pricehistory. */
export interface SchwabCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number; // epoch ms at the session date
}

export interface PriceHistoryResponse {
  symbol?: string;
  empty?: boolean;
  candles?: SchwabCandle[];
}

/** A bar ready for Prisma: prices as strings, volume as BigInt, date-only. */
export interface ParsedBar {
  date: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: bigint;
}

/** The Security rows the universe needs before any bar can be attached. */
export interface SecuritySeed {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  leverageFactor: number;
  isInverse: boolean;
}

export function securitySeeds(): SecuritySeed[] {
  return [
    // The ETF instrument universe (index, sectors, rates/credit/commodity, inverse, leveraged).
    ...INSTRUMENTS.map((i) => ({
      symbol: i.symbol,
      name: i.name,
      assetClass: i.class,
      leverageFactor: i.leverageFactor,
      isInverse: i.isInverse,
    })),
    // The single-stock screening universe — liquid large caps, all plain EQUITY.
    ...STOCK_UNIVERSE.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      assetClass: 'EQUITY' as AssetClass,
      leverageFactor: 1,
      isInverse: false,
    })),
  ];
}

/** The date portion of a candle, as UTC midnight — PriceBar.date is date-only. */
export function candleDate(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** True for a candle whose OHLCV and timestamp are all finite and present. */
export function isUsableCandle(c: SchwabCandle): boolean {
  return (
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    Number.isFinite(c.volume) &&
    Number.isFinite(c.datetime)
  );
}

/** Raw candles → bars, dropping malformed ones rather than storing a bad price. */
export function toBars(candles: SchwabCandle[]): ParsedBar[] {
  return candles.filter(isUsableCandle).map((c) => ({
    date: candleDate(c.datetime),
    open: String(c.open),
    high: String(c.high),
    low: String(c.low),
    close: String(c.close),
    // Share counts are whole; truncate any float dust before BigInt.
    volume: BigInt(Math.trunc(c.volume)),
  }));
}

/** The query path for one symbol's daily history over [startMs, endMs]. */
export function buildPriceHistoryPath(symbol: string, startMs: number, endMs: number): string {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    periodType: 'year',
    frequencyType: 'daily',
    frequency: '1',
    startDate: String(startMs),
    endDate: String(endMs),
    needExtendedHoursData: 'false',
  });
  return `/pricehistory?${params.toString()}`;
}

/** Epoch ms to request history from, given the last bar we already hold. */
export function historyStartMs(
  lastBarDate: Date | null,
  now: Date,
  initialLookbackDays = INITIAL_LOOKBACK_DAYS,
  revisionWindowDays = REVISION_WINDOW_DAYS,
): number {
  const dayMs = 24 * 60 * 60 * 1000;
  if (!lastBarDate) return now.getTime() - initialLookbackDays * dayMs;
  return lastBarDate.getTime() - revisionWindowDays * dayMs;
}

/**
 * Trailing average dollar volume over the most recent `window` bars — the figure
 * the §1 liquidity floor screens on. Decimal throughout: close × volume summed,
 * divided by the bar count, so no float drift reaches a tradability decision.
 * Returns null when there are no bars to average.
 */
export function averageDollarVolume(bars: ParsedBar[], window = ADV_WINDOW): string | null {
  const recent = bars.slice(-window);
  if (recent.length === 0) return null;

  let sum = new Prisma.Decimal(0);
  for (const bar of recent) {
    sum = sum.add(new Prisma.Decimal(bar.close).mul(new Prisma.Decimal(bar.volume.toString())));
  }
  return sum.div(recent.length).toFixed(2);
}
