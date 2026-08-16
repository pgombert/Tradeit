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

export interface AccountSnapshot {
  /** Null until the Schwab credentials are supplied — see docs/PLAN.md §2. */
  asOf: string | null;
  connected: boolean;
  totalValue: string | null;
  settledCash: string | null;
  unsettledCash: string | null;
  positions: PositionDto[];
}
