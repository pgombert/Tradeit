import type { AssetClass } from '../types/market.js';

/**
 * The tradable universe. Stocks and ETFs only — no options (docs/PLAN.md §1).
 *
 * Two things make this table load-bearing rather than reference material:
 *
 *  1. The AI-validation rule needs somewhere to resolve a ticker to. A verdict
 *     naming a symbol that isn't here is discarded.
 *  2. Stage 5 translates a *direction* into an instrument. The account cannot
 *     short (§2), so a bearish view becomes a long position in an inverse ETF,
 *     and that mapping lives here.
 */

export interface InstrumentDef {
  readonly symbol: string;
  readonly name: string;
  readonly class: AssetClass;
  /** 1 for unleveraged, 2 or 3 for leveraged products. */
  readonly leverageFactor: 1 | 2 | 3;
  readonly isInverse: boolean;
  /** What this expresses a view on — used to pair long and inverse exposures. */
  readonly exposure: string;
  /** Liquid enough for the §1 floor of roughly $5M average daily dollar volume. */
  readonly liquid: boolean;
}

export const INSTRUMENTS: readonly InstrumentDef[] = [
  // ---- Core index exposure --------------------------------------------
  { symbol: 'SPY', name: 'S&P 500', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'SP500', liquid: true },
  { symbol: 'QQQ', name: 'Nasdaq 100', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'NASDAQ100', liquid: true },
  { symbol: 'IWM', name: 'Russell 2000', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'RUSSELL2000', liquid: true },

  // ---- Sectors --------------------------------------------------------
  { symbol: 'XLK', name: 'Technology', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'TECH', liquid: true },
  { symbol: 'XLF', name: 'Financials', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'FINANCIALS', liquid: true },
  { symbol: 'XLE', name: 'Energy', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'ENERGY', liquid: true },
  { symbol: 'XLV', name: 'Health Care', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'HEALTHCARE', liquid: true },
  { symbol: 'XLI', name: 'Industrials', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'INDUSTRIALS', liquid: true },
  { symbol: 'XLY', name: 'Consumer Discretionary', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'DISCRETIONARY', liquid: true },
  { symbol: 'XLP', name: 'Consumer Staples', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'STAPLES', liquid: true },
  { symbol: 'XLU', name: 'Utilities', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'UTILITIES', liquid: true },
  { symbol: 'SMH', name: 'Semiconductors', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'SEMIS', liquid: true },
  { symbol: 'XBI', name: 'Biotech', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'BIOTECH', liquid: true },

  // ---- Rates, credit, commodities -------------------------------------
  { symbol: 'TLT', name: '20+ Year Treasuries', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'LONG_TREASURIES', liquid: true },
  { symbol: 'IEF', name: '7-10 Year Treasuries', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'MID_TREASURIES', liquid: true },
  { symbol: 'HYG', name: 'High Yield Credit', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'HIGH_YIELD', liquid: true },
  { symbol: 'GLD', name: 'Gold', class: 'ETF', leverageFactor: 1, isInverse: false, exposure: 'GOLD', liquid: true },

  // ---- Unleveraged inverse — a bearish tilt without 3x -----------------
  { symbol: 'SH', name: 'Inverse S&P 500', class: 'INVERSE_ETF', leverageFactor: 1, isInverse: true, exposure: 'SP500', liquid: true },
  { symbol: 'PSQ', name: 'Inverse Nasdaq 100', class: 'INVERSE_ETF', leverageFactor: 1, isInverse: true, exposure: 'NASDAQ100', liquid: true },
  { symbol: 'RWM', name: 'Inverse Russell 2000', class: 'INVERSE_ETF', leverageFactor: 1, isInverse: true, exposure: 'RUSSELL2000', liquid: true },

  // ---- Leveraged: only in Risk-On Trend, capped at 20% of book ---------
  { symbol: 'TQQQ', name: '3x Nasdaq 100', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'NASDAQ100', liquid: true },
  { symbol: 'SQQQ', name: '3x Inverse Nasdaq 100', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'NASDAQ100', liquid: true },
  { symbol: 'UPRO', name: '3x S&P 500', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'SP500', liquid: true },
  { symbol: 'SPXU', name: '3x Inverse S&P 500', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'SP500', liquid: true },
  { symbol: 'TNA', name: '3x Russell 2000', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'RUSSELL2000', liquid: true },
  { symbol: 'TZA', name: '3x Inverse Russell 2000', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'RUSSELL2000', liquid: true },

  // High-beta sector 3x — where §1 argues the return actually comes from.
  { symbol: 'SOXL', name: '3x Semiconductors', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'SEMIS', liquid: true },
  { symbol: 'SOXS', name: '3x Inverse Semiconductors', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'SEMIS', liquid: true },
  { symbol: 'LABU', name: '3x Biotech', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'BIOTECH', liquid: true },
  { symbol: 'LABD', name: '3x Inverse Biotech', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'BIOTECH', liquid: true },
  { symbol: 'FAS', name: '3x Financials', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: false, exposure: 'FINANCIALS', liquid: true },
  { symbol: 'FAZ', name: '3x Inverse Financials', class: 'LEVERAGED_ETF', leverageFactor: 3, isInverse: true, exposure: 'FINANCIALS', liquid: true },
] as const;

export function instrumentBySymbol(symbol: string): InstrumentDef | undefined {
  const upper = symbol.trim().toUpperCase();
  return INSTRUMENTS.find((i) => i.symbol === upper);
}

/** Everything that expresses a view on the same underlying. */
export function instrumentsForExposure(exposure: string): InstrumentDef[] {
  return INSTRUMENTS.filter((i) => i.exposure === exposure);
}

/** The GICS-sector exposures (as opposed to index, rates, credit, commodity). */
export const SECTOR_EXPOSURES: readonly string[] = [
  'TECH', 'FINANCIALS', 'ENERGY', 'HEALTHCARE', 'INDUSTRIALS',
  'DISCRETIONARY', 'STAPLES', 'UTILITIES', 'SEMIS', 'BIOTECH',
];

export function isSectorExposure(exposure: string): boolean {
  return SECTOR_EXPOSURES.includes(exposure);
}

/** True when a tradable inverse product exists for this exposure — the account
 * can't short, so a bearish view is only expressible where this holds. */
export function hasInverseFor(exposure: string): boolean {
  return INSTRUMENTS.some((i) => i.exposure === exposure && i.isInverse);
}

/**
 * The securities Stage 1 actually screens: the base long, unleveraged ETFs.
 * Inverse and leveraged products are *expression vehicles* chosen at Stage 5
 * from a candidate's direction — never screened directly.
 */
export function screenableInstruments(): InstrumentDef[] {
  return INSTRUMENTS.filter((i) => i.leverageFactor === 1 && !i.isInverse);
}
