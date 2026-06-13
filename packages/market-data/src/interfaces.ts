import { AssetMetadata } from "./mapping";

export interface HistoricalPriceData {
  timestamp: number;
  price: number;
}

export interface MarketDataProvider {
  readonly name: string;
  getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number>;
  getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]>;
}
