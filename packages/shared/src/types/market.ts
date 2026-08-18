export type AssetClass = 'EQUITY' | 'ETF' | 'LEVERAGED_ETF' | 'INVERSE_ETF';

export interface SecurityDto {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** 1 for unleveraged, 2 or 3 for leveraged products. */
  leverageFactor: number;
  isInverse: boolean;
}

export interface PriceBarDto {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface PositionDto {
  symbol: string;
  quantity: string;
  averagePrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

/**
 * Where the Schwab connection stands, so the dashboard can show the right thing
 * without ever inventing a number:
 *  - DISCONNECTED — never linked; show "Connect Schwab".
 *  - CONNECTED    — a live snapshot below.
 *  - EXPIRED      — the ~7-day login lapsed; show "Reconnect Schwab".
 *  - ERROR        — Schwab was reached but errored; show the message, not a $0.
 */
export type SchwabConnectionStatus = 'DISCONNECTED' | 'CONNECTED' | 'EXPIRED' | 'ERROR';

export interface AccountSnapshot {
  status: SchwabConnectionStatus;
  /** Convenience mirror of `status === 'CONNECTED'` for existing callers. */
  connected: boolean;
  /** Null until the Schwab credentials are supplied — see docs/PLAN.md §2. */
  asOf: string | null;
  totalValue: string | null;
  settledCash: string | null;
  unsettledCash: string | null;
  positions: PositionDto[];
  /** When the current login expires and a reconnect is due (ISO), if known. */
  reauthAfter: string | null;
  /** A human note for any non-connected state. Never carries a token. */
  message: string | null;
}
