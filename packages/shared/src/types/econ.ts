import type { EconRole } from '../constants/fred-series.js';

export interface EconSeriesSummary {
  seriesId: string;
  title: string;
  role: EconRole;
  units: string;
  /** Most recent value we hold, as a string so no precision is lost in transit. */
  latestValue: string | null;
  latestDate: string | null;
  /** Change from the observation one week before `latestDate`. */
  weekChange: string | null;
  pointCount: number;
}

export interface EconPointDto {
  date: string;
  value: string;
}

export interface EconSeriesDetail extends EconSeriesSummary {
  points: EconPointDto[];
}

/** Two-point snapshot of the curve, for the dashboard header. */
export interface YieldCurveSnapshot {
  asOf: string | null;
  twoYear: string | null;
  tenYear: string | null;
  spread: string | null;
  /** True when the 10Y sits below the 2Y. */
  inverted: boolean;
}
