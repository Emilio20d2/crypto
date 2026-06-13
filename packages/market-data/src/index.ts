import { MarketDataProvider, HistoricalPriceData, MarketCacheRepository } from "./interfaces";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { getAssetMetadata } from "./mapping";
import { MarketNotFoundError } from "./errors";
import { retryWithBackoff } from "./utils";

export * from "./interfaces";
export * from "./coinbase";
export * from "./coingecko";
export * from "./mapping";
export * from "./errors";
export * from "./utils";

export class MarketService {
  private coinbase = new CoinbaseProvider();
  private coingecko = new CoinGeckoProvider();

  constructor(private cache?: MarketCacheRepository) {}

  async getCurrentPrice(assetId: string, signal?: AbortSignal): Promise<{ price: number; state: "live" | "cached" | "unavailable" }> {
    const meta = getAssetMetadata(assetId);
    if (!meta) return { price: 0, state: "unavailable" };

    if (this.cache) {
      const cached = await this.cache.getCurrentPrice(assetId, meta.quoteCurrency);
      if (cached && Date.now() - cached.fetchedAt < 60000) { // 1 min cache
        return { price: cached.price, state: "cached" };
      }
    }

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const price = await retryWithBackoff(() => this.coinbase.getCurrentPrice(meta, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "coinbase");
        return { price, state: "live" };
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        console.warn(`Coinbase getCurrentPrice failed for ${assetId}:`, e instanceof Error ? e.message : String(e), "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      try {
        const price = await retryWithBackoff(() => this.coingecko.getCurrentPrice(meta, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "coingecko");
        return { price, state: "live" };
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        console.warn(`CoinGecko getCurrentPrice failed for ${assetId}:`, e instanceof Error ? e.message : String(e));
      }
    }

    return { price: 0, state: "unavailable" };
  }

  // Adapter for PortfolioService
  async getCurrentPriceEur(assetId: string): Promise<{ price: number; state: "live" | "cached" | "unavailable" }> {
    return this.getCurrentPrice(assetId);
  }

  async getHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    const meta = getAssetMetadata(assetId);
    if (!meta) throw new MarketNotFoundError(`Asset mapping not found for ${assetId}`);

    if (this.cache) {
      const cached = await this.cache.getHistoricalPrices(assetId, meta.quoteCurrency, period);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const data = await retryWithBackoff(() => this.coinbase.getHistoricalPrices(meta, period, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveHistoricalPrices(assetId, meta.quoteCurrency, period, data, "coinbase");
        return data;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        console.warn(`Coinbase getHistoricalPrices failed for ${assetId}:`, e instanceof Error ? e.message : String(e), "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      const data = await retryWithBackoff(() => this.coingecko.getHistoricalPrices(meta, period, signal), 3, 1000, signal);
      if (this.cache) await this.cache.saveHistoricalPrices(assetId, meta.quoteCurrency, period, data, "coingecko");
      return data;
    }

    throw new MarketNotFoundError(`No providers available for ${assetId} historical data`);
  }
}
