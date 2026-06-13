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

  async getCurrentPrice(assetId: string, signal?: AbortSignal): Promise<{ price: number | null; state: "live" | "cached" | "unavailable"; reason?: string }> {
    const meta = getAssetMetadata(assetId);
    if (!meta) return { price: null, state: "unavailable", reason: "Asset metadata not found" };

    if (this.cache) {
      const cached = await this.cache.getCurrentPrice(assetId, meta.quoteCurrency);
      if (cached && Date.now() - cached.fetchedAt < 60000) { // 1 min cache
        return { price: cached.price, state: "cached" };
      }
    }

    let lastError: string | undefined;

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const price = await retryWithBackoff(() => this.coinbase.getCurrentPrice(meta, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "coinbase");
        return { price, state: "live" };
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`Coinbase getCurrentPrice failed for ${assetId}:`, lastError, "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      try {
        const price = await retryWithBackoff(() => this.coingecko.getCurrentPrice(meta, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "coingecko");
        return { price, state: "live" };
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`CoinGecko getCurrentPrice failed for ${assetId}:`, lastError);
      }
    }

    return { price: null, state: "unavailable", reason: lastError || "All providers failed" };
  }

  // Adapter for PortfolioService
  async getCurrentPriceEur(assetId: string): Promise<{ price: number | null; state: "live" | "cached" | "unavailable"; reason?: string }> {
    return this.getCurrentPrice(assetId);
  }

  async getHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<{ provider: string, points: HistoricalPriceData[], requestedPeriod: string, actualInterval: string, fetchedAt: number, isCached: boolean, cacheStatus?: "fresh" | "partial" | "stale" | "miss" }> {
    const meta = getAssetMetadata(assetId);
    if (!meta) throw new MarketNotFoundError(`Asset mapping not found for ${assetId}`);

    if (this.cache) {
      const cached = await this.cache.getHistoricalPrices(assetId, meta.quoteCurrency, period);
      if (cached && cached.length > 0) {
        return {
          provider: "cache",
          points: cached,
          requestedPeriod: period,
          actualInterval: "auto",
          fetchedAt: Date.now(),
          isCached: true,
          cacheStatus: "fresh"
        };
      }
    }

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const data = await retryWithBackoff(() => this.coinbase.getHistoricalPrices(meta, period, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveHistoricalPrices(assetId, meta.quoteCurrency, period, data, "coinbase");
        return {
          provider: "coinbase",
          points: data,
          requestedPeriod: period,
          actualInterval: "auto",
          fetchedAt: Date.now(),
          isCached: false,
          cacheStatus: "miss"
        };
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        console.warn(`Coinbase getHistoricalPrices failed for ${assetId}:`, e instanceof Error ? e.message : String(e), "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      const data = await retryWithBackoff(() => this.coingecko.getHistoricalPrices(meta, period, signal), 3, 1000, signal);
      if (this.cache) await this.cache.saveHistoricalPrices(assetId, meta.quoteCurrency, period, data, "coingecko");
      return {
        provider: "coingecko",
        points: data,
        requestedPeriod: period,
        actualInterval: "auto",
        fetchedAt: Date.now(),
        isCached: false,
        cacheStatus: "miss"
      };
    }

    throw new MarketNotFoundError(`No providers available for ${assetId} historical data`);
  }
}
