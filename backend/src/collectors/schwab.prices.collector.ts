import { prisma } from '../lib/prisma.js';
import { getValidAccessToken } from '../services/schwab.tokens.js';
import {
  averageDollarVolume,
  buildPriceHistoryPath,
  historyStartMs,
  SCHWAB_MARKETDATA_BASE,
  securitySeeds,
  toBars,
  type ParsedBar,
  type PriceHistoryResponse,
} from './schwab.prices.parse.js';

/**
 * Daily price history for the tradable universe, pulled from Schwab's market
 * data API into the price_bars table. Market data only — a read path, the same
 * feed the account trades against, which is what makes it good for the later
 * reconciliation (docs/PLAN.md §2). Nothing here places an order.
 *
 * Idempotent, like the FRED collector: bars upsert on (security, date) and each
 * run re-requests a short tail behind the last bar, so a crash mid-run plus a
 * re-run reaches the same end state.
 */

const UPSERT_CHUNK = 500;

export interface PriceCollectionResult {
  symbol: string;
  barsWritten: number;
  latestDate: string | null;
}

async function fetchDailyHistory(
  symbol: string,
  accessToken: string,
  startMs: number,
  endMs: number,
): Promise<ParsedBar[]> {
  const url = `${SCHWAB_MARKETDATA_BASE}${buildPriceHistoryPath(symbol, startMs, endMs)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Schwab pricehistory ${symbol} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as PriceHistoryResponse;
  return toBars(json.candles ?? []);
}

/** Make sure every instrument in the universe has a Security row to hang bars on. */
async function ensureSecurities(): Promise<Map<string, string>> {
  const bySymbol = new Map<string, string>();
  for (const seed of securitySeeds()) {
    const security = await prisma.security.upsert({
      where: { symbol: seed.symbol },
      create: {
        symbol: seed.symbol,
        name: seed.name,
        class: seed.assetClass,
        leverageFactor: seed.leverageFactor,
        isInverse: seed.isInverse,
      },
      update: { name: seed.name, class: seed.assetClass },
      select: { id: true, symbol: true },
    });
    bySymbol.set(security.symbol, security.id);
  }
  return bySymbol;
}

async function collectOne(
  symbol: string,
  securityId: string,
  accessToken: string,
  now: Date,
): Promise<PriceCollectionResult> {
  const last = await prisma.priceBar.findFirst({
    where: { securityId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  const bars = await fetchDailyHistory(
    symbol,
    accessToken,
    historyStartMs(last?.date ?? null, now),
    now.getTime(),
  );

  for (let i = 0; i < bars.length; i += UPSERT_CHUNK) {
    const chunk = bars.slice(i, i + UPSERT_CHUNK);
    await prisma.$transaction(
      chunk.map((bar) =>
        prisma.priceBar.upsert({
          where: { securityId_date: { securityId, date: bar.date } },
          create: {
            securityId,
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            source: 'SCHWAB',
          },
          update: {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          },
        }),
      ),
    );
  }

  const latest = bars.at(-1) ?? null;
  const adv = averageDollarVolume(bars);

  if (latest) {
    await prisma.$transaction([
      // Refresh the liquidity figure the §1 floor screens on.
      prisma.security.update({
        where: { id: securityId },
        data: adv ? { avgDollarVolume: adv } : {},
      }),
      // One provenance record per symbol, citing the latest bar — the row a
      // dossier points at for "price as of".
      prisma.observation.upsert({
        where: { source_sourceRef: { source: 'SCHWAB', sourceRef: `${symbol}:latest` } },
        create: {
          source: 'SCHWAB',
          sourceRef: `${symbol}:latest`,
          scope: symbol,
          kind: 'PRICE_BAR',
          observedAt: latest.date,
          payload: {
            symbol,
            date: latest.date.toISOString().slice(0, 10),
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume.toString(),
            avgDollarVolume: adv,
          },
        },
        update: {
          observedAt: latest.date,
          payload: {
            symbol,
            date: latest.date.toISOString().slice(0, 10),
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume.toString(),
            avgDollarVolume: adv,
          },
        },
      }),
    ]);
  }

  return {
    symbol,
    barsWritten: bars.length,
    latestDate: latest ? latest.date.toISOString().slice(0, 10) : null,
  };
}

/**
 * Pulls daily history for every instrument in the universe. If Schwab is not
 * connected (or the login expired) the run fails with the actionable reconnect
 * message from the token store, rather than silently writing nothing.
 */
export async function collectSchwabPrices(): Promise<PriceCollectionResult[]> {
  const run = await prisma.collectorRun.create({
    data: { collector: 'prices', status: 'RUNNING' },
  });

  const results: PriceCollectionResult[] = [];

  try {
    const accessToken = await getValidAccessToken();
    const securities = await ensureSecurities();
    const now = new Date();

    for (const [symbol, securityId] of securities) {
      const result = await collectOne(symbol, securityId, accessToken, now);
      results.push(result);
      console.log(
        `[prices] ${symbol.padEnd(6)} ${String(result.barsWritten).padStart(4)} bars, latest ${result.latestDate ?? 'none'}`,
      );
    }

    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        recordsWritten: results.reduce((sum, r) => sum + r.barsWritten, 0),
      },
    });

    return results;
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        recordsWritten: results.reduce((sum, r) => sum + r.barsWritten, 0),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
