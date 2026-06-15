import { AssetMetadata } from "./mapping";

export interface HistoricalPriceData {
  timestamp: number;
  price: number;
  source?: string;
  confidence?: number;
}

export interface MarketDataProvider {
  readonly name: string;
  getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number>;
  getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]>;
}

export interface MarketCacheRepository {
  getHistoricalPrices(assetId: string, quoteCurrency: string, period: string, options?: { allowStale?: boolean }): Promise<HistoricalPriceData[] | null>;
  saveHistoricalPrices(assetId: string, quoteCurrency: string, period: string, data: HistoricalPriceData[], provider: string): Promise<void>;
  
  getCurrentPrice(assetId: string, quoteCurrency: string, options?: { allowStale?: boolean }): Promise<{ price: number, fetchedAt: number, provider: string } | null>;
  saveCurrentPrice(assetId: string, quoteCurrency: string, price: number, provider: string): Promise<void>;
}
