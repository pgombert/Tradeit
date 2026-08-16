/**
 * The FRED series the regime classifier is built from.
 *
 * `role` groups them by the input they feed in Stage 0 (see docs/PLAN.md §5).
 * Adding a series here is all that's needed for the collector to start pulling
 * it — the collector iterates this list.
 */
export type EconRole = 'RATES' | 'CREDIT' | 'VOLATILITY' | 'GROWTH' | 'INFLATION' | 'CONDITIONS';

export interface FredSeriesDef {
  /** FRED series id, e.g. "DGS10". */
  readonly id: string;
  readonly title: string;
  readonly role: EconRole;
  readonly units: string;
  /** How often FRED publishes it — used to decide staleness. */
  readonly frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
}

export const FRED_SERIES: readonly FredSeriesDef[] = [
  // Rates and the curve
  { id: 'DGS2', title: '2-Year Treasury Yield', role: 'RATES', units: '%', frequency: 'DAILY' },
  { id: 'DGS10', title: '10-Year Treasury Yield', role: 'RATES', units: '%', frequency: 'DAILY' },
  { id: 'T10Y2Y', title: '10Y minus 2Y Spread', role: 'RATES', units: '%', frequency: 'DAILY' },
  { id: 'DFII10', title: '10-Year Real Yield (TIPS)', role: 'RATES', units: '%', frequency: 'DAILY' },
  { id: 'T10YIE', title: '10-Year Breakeven Inflation', role: 'INFLATION', units: '%', frequency: 'DAILY' },

  // Credit
  { id: 'BAMLH0A0HYM2', title: 'High Yield Option-Adjusted Spread', role: 'CREDIT', units: '%', frequency: 'DAILY' },
  { id: 'BAMLC0A0CM', title: 'Investment Grade Option-Adjusted Spread', role: 'CREDIT', units: '%', frequency: 'DAILY' },

  // Volatility
  { id: 'VIXCLS', title: 'CBOE Volatility Index', role: 'VOLATILITY', units: 'index', frequency: 'DAILY' },

  // Financial conditions
  { id: 'NFCI', title: 'Chicago Fed National Financial Conditions Index', role: 'CONDITIONS', units: 'index', frequency: 'WEEKLY' },

  // Growth and labour
  { id: 'ICSA', title: 'Initial Jobless Claims', role: 'GROWTH', units: 'persons', frequency: 'WEEKLY' },
  { id: 'UNRATE', title: 'Unemployment Rate', role: 'GROWTH', units: '%', frequency: 'MONTHLY' },

  // Inflation
  { id: 'CPIAUCSL', title: 'CPI, All Urban Consumers', role: 'INFLATION', units: 'index', frequency: 'MONTHLY' },
] as const;

export const FRED_SERIES_IDS: readonly string[] = FRED_SERIES.map((s) => s.id);

export function fredSeriesById(id: string): FredSeriesDef | undefined {
  return FRED_SERIES.find((s) => s.id === id);
}
