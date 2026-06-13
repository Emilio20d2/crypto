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

export interface MarketCacheRepository {
  getHistoricalPrices(assetId: string, quoteCurrency: string, period: string): Promise<HistoricalPriceData[] | null>;
  saveHistoricalPrices(assetId: string, quoteCurrency: string, period: string, data: HistoricalPriceData[], provider: string): Promise<void>;
  
  getCurrentPrice(assetId: string, quoteCurrency: string): Promise<{ price: number, fetchedAt: number } | null>;
  saveCurrentPrice(assetId: string, quoteCurrency: string, price: number, provider: string): Promise<void>;
}
