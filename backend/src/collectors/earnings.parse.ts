/**
 * Pure helpers for the Finnhub earnings-calendar collector. Kept free of config
 * and Prisma imports so they can be tested without an environment or a database.
 */

/** A raw row as Finnhub returns it under `earningsCalendar`. */
export interface RawEarnings {
  date: string;
  symbol: string;
  hour?: string;
  year?: number;
  quarter?: number;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
}

/** A normalized, keyable earnings event. */
export interface EarningsEvent {
  symbol: string;
  date: string;
  /** "bmo" before open, "amc" after close, "dmh" during hours, or "" unknown. */
  hour: string;
  quarter: number | null;
  year: number | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The calendar window to request: from `now` forward `daysAhead` days. Earnings
 * inside the coming holding period are the catalysts Stage 1 cares about; a
 * short look-ahead keeps the list to events that can actually move a candidate.
 */
export function earningsWindow(now: Date, daysAhead: number): { from: string; to: string } {
  const to = new Date(now);
  to.setDate(to.getDate() + daysAhead);
  return { from: isoDate(now), to: isoDate(to) };
}

/**
 * Keep only rows we can key on and cite: a symbol and a date are both required.
 * Everything else is optional — Finnhub often has no estimate yet, and the
 * actuals stay null until the company reports. The symbol is upper-cased so the
 * scope matches a `Security.symbol` when we later resolve it.
 *
 * Nulls are preserved, never coerced: a missing EPS estimate is not a zero
 * estimate, the same reasoning as the FRED "." placeholder.
 */
export function usableEarnings(rows: RawEarnings[]): EarningsEvent[] {
  return rows
    .filter((r) => r.symbol?.trim() && r.date?.trim())
    .map((r) => ({
      symbol: r.symbol.trim().toUpperCase(),
      date: r.date.trim(),
      hour: r.hour?.trim() ?? '',
      quarter: r.quarter ?? null,
      year: r.year ?? null,
      epsEstimate: r.epsEstimate ?? null,
      epsActual: r.epsActual ?? null,
      revenueEstimate: r.revenueEstimate ?? null,
      revenueActual: r.revenueActual ?? null,
    }));
}

/**
 * Stable id for (source, sourceRef). A company reports once on a date, so
 * symbol+date is unique and lets a re-run overwrite the row in place — which is
 * exactly what we want, since estimates are revised and actuals arrive later.
 */
export function earningsRef(e: EarningsEvent): string {
  return `${e.symbol}:${e.date}`;
}
