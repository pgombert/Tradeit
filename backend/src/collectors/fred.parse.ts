/**
 * Pure parsing helpers for the FRED collector. Kept free of config and Prisma
 * imports so they can be tested without an environment or a database.
 */

export interface FredObservation {
  date: string;
  value: string;
}

/**
 * FRED writes "." for a date with no value (holidays, not-yet-published). Those
 * rows must be dropped, not coerced — a "." that reaches Prisma as 0 becomes a
 * fake zero-yield day in the middle of the curve.
 *
 * Values stay strings the whole way through; nothing here parses a float.
 */
export function usableObservations(observations: FredObservation[]): FredObservation[] {
  return observations.filter((o) => o.value !== '.' && o.value.trim() !== '');
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Where to start a request for a series.
 *
 * First run reaches back `initialLookbackYears`. Later runs re-request a window
 * behind the last date we hold, because FRED revises recent points and an
 * exact-resume would keep the stale value forever.
 */
export function startDateFor(
  lastObservedAt: Date | null,
  now: Date,
  initialLookbackYears: number,
  revisionWindowDays: number,
): string {
  if (!lastObservedAt) {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - initialLookbackYears);
    return isoDate(d);
  }

  const d = new Date(lastObservedAt);
  d.setDate(d.getDate() - revisionWindowDays);
  return isoDate(d);
}
