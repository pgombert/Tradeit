/**
 * The single-stock screening universe: liquid, large-cap US names a swing
 * trader would actually put through Stage 1.
 *
 * This is the equity counterpart to the ETF table in `instruments.ts`. Where
 * that table maps a *direction* to an expression vehicle, this one is a flat
 * screening list — each name is a candidate the screener resolves and ranks
 * directly. Only genuinely liquid names belong here (roughly the §1 floor of
 * $5M average daily dollar volume), so a fill assumption never becomes fiction.
 *
 * `sector` is one of the 11 GICS strings. The first eight line up with the
 * sector ETF exposures already in `instruments.ts`; COMMUNICATION, MATERIALS
 * and REAL_ESTATE round the set out to the full GICS taxonomy.
 */

export interface StockDef {
  readonly symbol: string;
  readonly name: string;
  /** One of the 11 GICS sectors. */
  readonly sector: string;
}

export const STOCK_UNIVERSE: readonly StockDef[] = [
  // ---- Technology -----------------------------------------------------
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'TECH' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'TECH' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'TECH' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'TECH' },
  { symbol: 'ORCL', name: 'Oracle Corp.', sector: 'TECH' },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'TECH' },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'TECH' },
  { symbol: 'AMD', name: 'Advanced Micro Devices Inc.', sector: 'TECH' },
  { symbol: 'CSCO', name: 'Cisco Systems Inc.', sector: 'TECH' },
  { symbol: 'ACN', name: 'Accenture plc', sector: 'TECH' },
  { symbol: 'IBM', name: 'International Business Machines Corp.', sector: 'TECH' },
  { symbol: 'TXN', name: 'Texas Instruments Inc.', sector: 'TECH' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', sector: 'TECH' },
  { symbol: 'INTU', name: 'Intuit Inc.', sector: 'TECH' },
  { symbol: 'NOW', name: 'ServiceNow Inc.', sector: 'TECH' },
  { symbol: 'AMAT', name: 'Applied Materials Inc.', sector: 'TECH' },
  { symbol: 'MU', name: 'Micron Technology Inc.', sector: 'TECH' },
  { symbol: 'ADI', name: 'Analog Devices Inc.', sector: 'TECH' },
  { symbol: 'LRCX', name: 'Lam Research Corp.', sector: 'TECH' },
  { symbol: 'KLAC', name: 'KLA Corp.', sector: 'TECH' },
  { symbol: 'PANW', name: 'Palo Alto Networks Inc.', sector: 'TECH' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings Inc.', sector: 'TECH' },

  // ---- Financials -----------------------------------------------------
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'FINANCIALS' },
  { symbol: 'BAC', name: 'Bank of America Corp.', sector: 'FINANCIALS' },
  { symbol: 'WFC', name: 'Wells Fargo & Co.', sector: 'FINANCIALS' },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc.', sector: 'FINANCIALS' },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'FINANCIALS' },
  { symbol: 'BRKB', name: 'Berkshire Hathaway Inc. Class B', sector: 'FINANCIALS' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'FINANCIALS' },
  { symbol: 'MA', name: 'Mastercard Inc.', sector: 'FINANCIALS' },
  { symbol: 'AXP', name: 'American Express Co.', sector: 'FINANCIALS' },
  { symbol: 'C', name: 'Citigroup Inc.', sector: 'FINANCIALS' },
  { symbol: 'SCHW', name: 'Charles Schwab Corp.', sector: 'FINANCIALS' },
  { symbol: 'BLK', name: 'BlackRock Inc.', sector: 'FINANCIALS' },
  { symbol: 'SPGI', name: 'S&P Global Inc.', sector: 'FINANCIALS' },
  { symbol: 'COF', name: 'Capital One Financial Corp.', sector: 'FINANCIALS' },
  { symbol: 'ICE', name: 'Intercontinental Exchange Inc.', sector: 'FINANCIALS' },

  // ---- Health Care ----------------------------------------------------
  { symbol: 'UNH', name: 'UnitedHealth Group Inc.', sector: 'HEALTHCARE' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'HEALTHCARE' },
  { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'HEALTHCARE' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'HEALTHCARE' },
  { symbol: 'MRK', name: 'Merck & Co. Inc.', sector: 'HEALTHCARE' },
  { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'HEALTHCARE' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific Inc.', sector: 'HEALTHCARE' },
  { symbol: 'ABT', name: 'Abbott Laboratories', sector: 'HEALTHCARE' },
  { symbol: 'DHR', name: 'Danaher Corp.', sector: 'HEALTHCARE' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb Co.', sector: 'HEALTHCARE' },
  { symbol: 'AMGN', name: 'Amgen Inc.', sector: 'HEALTHCARE' },
  { symbol: 'GILD', name: 'Gilead Sciences Inc.', sector: 'HEALTHCARE' },
  { symbol: 'ISRG', name: 'Intuitive Surgical Inc.', sector: 'HEALTHCARE' },

  // ---- Energy ---------------------------------------------------------
  { symbol: 'XOM', name: 'Exxon Mobil Corp.', sector: 'ENERGY' },
  { symbol: 'CVX', name: 'Chevron Corp.', sector: 'ENERGY' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'ENERGY' },
  { symbol: 'SLB', name: 'SLB (Schlumberger Ltd.)', sector: 'ENERGY' },
  { symbol: 'EOG', name: 'EOG Resources Inc.', sector: 'ENERGY' },
  { symbol: 'MPC', name: 'Marathon Petroleum Corp.', sector: 'ENERGY' },
  { symbol: 'PSX', name: 'Phillips 66', sector: 'ENERGY' },
  { symbol: 'VLO', name: 'Valero Energy Corp.', sector: 'ENERGY' },

  // ---- Industrials ----------------------------------------------------
  { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'INDUSTRIALS' },
  { symbol: 'HON', name: 'Honeywell International Inc.', sector: 'INDUSTRIALS' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'INDUSTRIALS' },
  { symbol: 'BA', name: 'Boeing Co.', sector: 'INDUSTRIALS' },
  { symbol: 'UPS', name: 'United Parcel Service Inc.', sector: 'INDUSTRIALS' },
  { symbol: 'RTX', name: 'RTX Corp.', sector: 'INDUSTRIALS' },
  { symbol: 'UNP', name: 'Union Pacific Corp.', sector: 'INDUSTRIALS' },
  { symbol: 'DE', name: 'Deere & Co.', sector: 'INDUSTRIALS' },
  { symbol: 'LMT', name: 'Lockheed Martin Corp.', sector: 'INDUSTRIALS' },
  { symbol: 'GD', name: 'General Dynamics Corp.', sector: 'INDUSTRIALS' },
  { symbol: 'ETN', name: 'Eaton Corp. plc', sector: 'INDUSTRIALS' },

  // ---- Consumer Discretionary -----------------------------------------
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'HD', name: 'Home Depot Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'MCD', name: "McDonald's Corp.", sector: 'DISCRETIONARY' },
  { symbol: 'NKE', name: 'Nike Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'LOW', name: "Lowe's Companies Inc.", sector: 'DISCRETIONARY' },
  { symbol: 'SBUX', name: 'Starbucks Corp.', sector: 'DISCRETIONARY' },
  { symbol: 'BKNG', name: 'Booking Holdings Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'TJX', name: 'TJX Companies Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'GM', name: 'General Motors Co.', sector: 'DISCRETIONARY' },
  { symbol: 'MAR', name: 'Marriott International Inc.', sector: 'DISCRETIONARY' },
  { symbol: 'CMG', name: 'Chipotle Mexican Grill Inc.', sector: 'DISCRETIONARY' },

  // ---- Consumer Staples -----------------------------------------------
  { symbol: 'PG', name: 'Procter & Gamble Co.', sector: 'STAPLES' },
  { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'STAPLES' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'STAPLES' },
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'STAPLES' },
  { symbol: 'COST', name: 'Costco Wholesale Corp.', sector: 'STAPLES' },
  { symbol: 'MDLZ', name: 'Mondelez International Inc.', sector: 'STAPLES' },
  { symbol: 'PM', name: 'Philip Morris International Inc.', sector: 'STAPLES' },
  { symbol: 'MO', name: 'Altria Group Inc.', sector: 'STAPLES' },
  { symbol: 'CL', name: 'Colgate-Palmolive Co.', sector: 'STAPLES' },

  // ---- Communication Services -----------------------------------------
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', sector: 'COMMUNICATION' },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'COMMUNICATION' },
  { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'COMMUNICATION' },
  { symbol: 'DIS', name: 'Walt Disney Co.', sector: 'COMMUNICATION' },
  { symbol: 'VZ', name: 'Verizon Communications Inc.', sector: 'COMMUNICATION' },
  { symbol: 'T', name: 'AT&T Inc.', sector: 'COMMUNICATION' },
  { symbol: 'CMCSA', name: 'Comcast Corp.', sector: 'COMMUNICATION' },
  { symbol: 'TMUS', name: 'T-Mobile US Inc.', sector: 'COMMUNICATION' },
  { symbol: 'CHTR', name: 'Charter Communications Inc.', sector: 'COMMUNICATION' },

  // ---- Utilities ------------------------------------------------------
  { symbol: 'NEE', name: 'NextEra Energy Inc.', sector: 'UTILITIES' },
  { symbol: 'DUK', name: 'Duke Energy Corp.', sector: 'UTILITIES' },
  { symbol: 'SO', name: 'Southern Co.', sector: 'UTILITIES' },
  { symbol: 'D', name: 'Dominion Energy Inc.', sector: 'UTILITIES' },
  { symbol: 'AEP', name: 'American Electric Power Co. Inc.', sector: 'UTILITIES' },
  { symbol: 'EXC', name: 'Exelon Corp.', sector: 'UTILITIES' },

  // ---- Materials ------------------------------------------------------
  { symbol: 'LIN', name: 'Linde plc', sector: 'MATERIALS' },
  { symbol: 'APD', name: 'Air Products and Chemicals Inc.', sector: 'MATERIALS' },
  { symbol: 'SHW', name: 'Sherwin-Williams Co.', sector: 'MATERIALS' },
  { symbol: 'FCX', name: 'Freeport-McMoRan Inc.', sector: 'MATERIALS' },
  { symbol: 'ECL', name: 'Ecolab Inc.', sector: 'MATERIALS' },
  { symbol: 'NEM', name: 'Newmont Corp.', sector: 'MATERIALS' },

  // ---- Real Estate ----------------------------------------------------
  { symbol: 'PLD', name: 'Prologis Inc.', sector: 'REAL_ESTATE' },
  { symbol: 'AMT', name: 'American Tower Corp.', sector: 'REAL_ESTATE' },
  { symbol: 'EQIX', name: 'Equinix Inc.', sector: 'REAL_ESTATE' },
  { symbol: 'CCI', name: 'Crown Castle Inc.', sector: 'REAL_ESTATE' },
  { symbol: 'PSA', name: 'Public Storage', sector: 'REAL_ESTATE' },
  { symbol: 'O', name: 'Realty Income Corp.', sector: 'REAL_ESTATE' },
] as const;

export function stockBySymbol(symbol: string): StockDef | undefined {
  const upper = symbol.trim().toUpperCase();
  return STOCK_UNIVERSE.find((s) => s.symbol === upper);
}
