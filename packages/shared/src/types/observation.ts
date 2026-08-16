/**
 * Every collector writes into one Observation stream. Structured domains
 * (prices, economic series) also get their own tables — the Observation row is
 * the provenance record that lets a dossier line cite its origin.
 */
export type ObservationSource =
  | 'FRED'
  | 'SCHWAB'
  | 'SEC_EDGAR'
  | 'FINNHUB'
  | 'CBOE'
  | 'FINRA'
  | 'AAII'
  | 'NAAIM'
  | 'NEWSLETTER'
  | 'DERIVED';

export type ObservationKind =
  | 'ECON_RELEASE'
  | 'PRICE_BAR'
  | 'FILING'
  | 'EARNINGS_EVENT'
  | 'SENTIMENT_READING'
  | 'SHORT_INTEREST'
  | 'LETTER_ITEM';

export interface ObservationDto {
  id: string;
  source: ObservationSource;
  /** The source's own stable id. Collectors upsert on (source, sourceRef). */
  sourceRef: string;
  /** A ticker, a sector, or MARKET for anything index-wide. */
  scope: string;
  kind: ObservationKind;
  observedAt: string;
  ingestedAt: string;
  url: string | null;
}

export type CollectorStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface CollectorRunDto {
  id: string;
  collector: string;
  status: CollectorStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsWritten: number;
  error: string | null;
}
