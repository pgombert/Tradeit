/**
 * Stage 5 wired to data. Resolves each candidate to the instrument the account
 * can actually buy (a stock direct, an ETF, an inverse for a bearish view, or a
 * leveraged product in Risk-On Trend), loads that vehicle's price, and sizes the
 * book with the pure `buildPortfolio` engine. No orders — advisory sizes only.
 *
 * v1 sizes against STARTING_CAPITAL with zero drawdown; once the settled-cash
 * ledger and equity-peak tracking land (Stage 7) this reads real equity and
 * feeds the live drawdown into the breaker ladder.
 */
import {
  buildPortfolio,
  buildRiskLimits,
  instrumentBySymbol,
  selectInstrument,
  type Candidate,
  type DossierRegime,
  type Indicators,
  type PositionInput,
  type Portfolio,
} from '@tradeit/shared';
import { env } from '../config/environment.js';
import { prisma } from '../lib/prisma.js';

/** Latest close of any seeded security, as a number (edge conversion). */
async function latestClose(symbol: string): Promise<number | null> {
  const sec = await prisma.security.findUnique({ where: { symbol }, select: { id: true } });
  if (!sec) return null;
  const bar = await prisma.priceBar.findFirst({
    where: { securityId: sec.id },
    orderBy: { date: 'desc' },
    select: { close: true },
  });
  return bar ? Number(bar.close) : null;
}

/**
 * Turn ranked candidates into a sized portfolio. Each candidate is translated to
 * a vehicle: a single stock trades as itself; an ETF exposure runs through
 * `selectInstrument` (which picks inverse for bearish, leveraged only in Risk-On
 * Trend above the conviction floor). A candidate that can't be expressed — a
 * bearish exposure with no inverse, or a crisis regime — is dropped here.
 */
/** The intended max hold in calendar days — the window we dodge earnings in. */
const HOLD_DAYS = 15;

/** Symbols with a scheduled earnings date inside the coming hold window. */
async function symbolsReportingSoon(symbols: string[]): Promise<Set<string>> {
  const now = new Date();
  const until = new Date();
  until.setDate(until.getDate() + HOLD_DAYS);
  const rows = await prisma.observation.findMany({
    where: { kind: 'EARNINGS_EVENT', scope: { in: symbols }, observedAt: { gte: now, lte: until } },
    select: { scope: true },
  });
  return new Set(rows.map((r) => r.scope));
}

export async function constructPortfolio(
  candidates: Candidate[],
  indicatorsBySymbol: Map<string, Indicators>,
  regime: DossierRegime,
  asOf: string,
): Promise<Portfolio> {
  const reportingSoon = await symbolsReportingSoon(candidates.map((c) => c.symbol));
  const inputs: PositionInput[] = [];

  for (const c of candidates) {
    const ind = indicatorsBySymbol.get(c.symbol);
    if (!ind || ind.close == null || ind.close <= 0) continue;

    let vehicleSymbol = c.symbol;
    let leverageFactor = 1;
    let isInverse = false;
    let vehiclePrice = ind.close;

    const inst = instrumentBySymbol(c.symbol);
    if (inst) {
      const sel = selectInstrument({
        exposure: c.exposure,
        direction: c.direction,
        conviction: c.conviction,
        regime: regime.regime,
      });
      if (!sel.instrument) continue; // not expressible (e.g. bearish, no inverse)
      vehicleSymbol = sel.instrument.symbol;
      leverageFactor = sel.instrument.leverageFactor;
      isInverse = sel.instrument.isInverse;
      if (vehicleSymbol !== c.symbol) {
        const price = await latestClose(vehicleSymbol);
        if (price == null || price <= 0) continue; // no price for the vehicle yet
        vehiclePrice = price;
      }
    }

    // Concentration weight: conviction amplified by 3-month momentum, so a
    // high-conviction rocket dominates a high-conviction plodder.
    const momentum = Math.max(0, ind.return3m ?? 0);
    const strength = c.conviction * (1 + 2 * momentum);

    inputs.push({
      candidate: c,
      entry: ind.close,
      atr: ind.atr14,
      vehicle: { symbol: vehicleSymbol, leverageFactor, isInverse, price: vehiclePrice },
      strength,
      earningsWithinHold: reportingSoon.has(c.symbol),
    });
  }

  const limits = buildRiskLimits(env.STARTING_CAPITAL, env.MAX_DRAWDOWN);
  return buildPortfolio(inputs, {
    capital: env.STARTING_CAPITAL,
    drawdown: 0, // until equity-peak tracking lands
    regime,
    limits,
    asOf,
  });
}
