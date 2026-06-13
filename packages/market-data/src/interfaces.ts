export interface AssetMetadata {
  id: string;
  symbol: string;
  name: string;
  logoUrl?: string;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface MarketDataProvider {
  getCurrentPrice(assetId: string, currency?: string): Promise<number>;
  getHistoricalPrices(assetId: string, period: string, currency?: string): Promise<PricePoint[]>;
  getAssetMetadata(assetId: string): Promise<AssetMetadata | null>;
  healthCheck(): Promise<boolean>;
}

// Periodos: "1h", "24h", "7d", "30d", "1y", "all"
