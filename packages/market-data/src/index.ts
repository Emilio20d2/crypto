import { MarketDataProvider, HistoricalPriceData, MarketCacheRepository } from "./interfaces";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { CryptoCompareProvider } from "./cryptocompare";
import { getAssetMetadata } from "./mapping";
import { MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { retryWithBackoff } from "./utils";

export * from "./interfaces";
export * from "./coinbase";
export * from "./coingecko";
export * from "./cryptocompare";
export * from "./mapping";
export * from "./errors";
export * from "./utils";
export * from "./sentiment";
export * from "./fear-greed";
export * from "./global-metrics";
export * from "./market-phase";
export * from "./asset-health";

type CurrentPriceResult = {
  price: number | null;
  state: "live" | "cached" | "unavailable";
  provider: string;
  fetchedAt: number;
  reason?: string;
};

type HistoricalPricesResult = {
  provider: string;
  points: HistoricalPriceData[];
  requestedPeriod: string;
  actualInterval: string;
  fetchedAt: number;
  isCached: boolean;
  cacheStatus?: "fresh" | "partial" | "stale" | "miss";
  reason?: string;
};

const CURRENT_PRICE_CACHE_MS = 5_000;
const MIN_HISTORICAL_POINTS = 2;

function historicalWindowMs(period: string): number | null {
  if (period === "1h") return 60 * 60 * 1000;
  if (period === "24h") return 24 * 60 * 60 * 1000;
  if (period === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (period === "30d") return 30 * 24 * 60 * 60 * 1000;
  if (period === "1y") return 365 * 24 * 60 * 60 * 1000;
  return null;
}

function maxExpectedGapMs(period: string): number | null {
  if (period === "1h") return 5 * 60 * 1000;
  if (period === "24h") return 30 * 60 * 1000;
  if (period === "7d") return 3 * 60 * 60 * 1000;
  if (period === "30d") return 12 * 60 * 60 * 1000;
  if (period === "1y") return 3 * 24 * 60 * 60 * 1000;
  return null;
}

function confidenceForProvider(provider: string): number {
  if (provider === "coinbase") return 1;
  if (provider === "coingecko") return 0.9;
  if (provider === "cryptocompare") return 0.85;
  return 0.6;
}

export class MarketService {
  private coinbase = new CoinbaseProvider();
  private coingecko = new CoinGeckoProvider();
  private cryptocompare = new CryptoCompareProvider();
  private currentPriceRequests = new Map<string, Promise<CurrentPriceResult>>();
  private historicalRequests = new Map<string, Promise<HistoricalPricesResult>>();

  constructor(private cache?: MarketCacheRepository) {}

  async getCurrentPrice(assetId: string, signal?: AbortSignal): Promise<CurrentPriceResult> {
    if (signal) return this.loadCurrentPrice(assetId, signal);

    const key = assetId.toUpperCase();
    const pending = this.currentPriceRequests.get(key);
    if (pending) return pending;

    const request = this.loadCurrentPrice(assetId).finally(() => {
      this.currentPriceRequests.delete(key);
    });
    this.currentPriceRequests.set(key, request);
    return request;
  }

  private async loadCurrentPrice(assetId: string, signal?: AbortSignal): Promise<CurrentPriceResult> {
    const meta = getAssetMetadata(assetId);
    if (!meta) return { price: null, state: "unavailable", reason: "Asset metadata not found", provider: "none", fetchedAt: Date.now() };

    let cached: { price: number, fetchedAt: number, provider: string } | null = null;
    if (this.cache) {
      cached = await this.cache.getCurrentPrice(assetId, meta.quoteCurrency);
      if (cached && Date.now() - cached.fetchedAt < CURRENT_PRICE_CACHE_MS) {
        return { price: cached.price, state: "cached", provider: cached.provider, fetchedAt: cached.fetchedAt };
      }
    }

    let lastError: string | undefined;

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const price = await retryWithBackoff(() => this.coinbase.getCurrentPrice(meta, signal), 3, 1000, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "coinbase");
        return { price, state: "live", provider: "coinbase", fetchedAt: Date.now() };
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
        return { price, state: "live", provider: "coingecko", fetchedAt: Date.now() };
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`CoinGecko getCurrentPrice failed for ${assetId}:`, lastError);
      }
    }

    if (meta.supportedProviders.includes("cryptocompare") && this.cryptocompare.isConfigured()) {
      try {
        const price = await retryWithBackoff(() => this.cryptocompare.getCurrentPrice(meta, signal), 2, 750, signal);
        if (this.cache) await this.cache.saveCurrentPrice(assetId, meta.quoteCurrency, price, "cryptocompare");
        return { price, state: "live", provider: "cryptocompare", fetchedAt: Date.now() };
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`CryptoCompare getCurrentPrice failed for ${assetId}:`, lastError);
      }
    }

    if (!cached && this.cache) {
      cached = await this.cache.getCurrentPrice(assetId, meta.quoteCurrency, { allowStale: true });
    }

    if (cached) {
      console.info(`[MarketService] getCurrentPrice ${assetId}: using last valid cache from ${cached.provider}`);
      return {
        price: cached.price,
        state: "cached",
        provider: cached.provider,
        fetchedAt: cached.fetchedAt,
        reason: lastError ? `Último dato válido en caché: ${lastError}` : "Último dato válido en caché",
      };
    }

    return { price: null, state: "unavailable", reason: lastError || "All providers failed", provider: "none", fetchedAt: Date.now() };
  }

  // Adapter for PortfolioService
  async getCurrentPriceEur(assetId: string): Promise<{ price: number | null; state: "live" | "cached" | "unavailable"; provider: string; fetchedAt: number; reason?: string }> {
    return this.getCurrentPrice(assetId);
  }

  async getHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<HistoricalPricesResult> {
    if (signal) return this.loadHistoricalPrices(assetId, period, signal);

    const key = `${assetId.toUpperCase()}:${period}`;
    const pending = this.historicalRequests.get(key);
    if (pending) return pending;

    const request = this.loadHistoricalPrices(assetId, period).finally(() => {
      this.historicalRequests.delete(key);
    });
    this.historicalRequests.set(key, request);
    return request;
  }

  private async loadHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<HistoricalPricesResult> {
    const meta = getAssetMetadata(assetId);
    if (!meta) throw new MarketNotFoundError(`Asset mapping not found for ${assetId}`);

    if (this.cache) {
      const cached = await this.cache.getHistoricalPrices(assetId, meta.quoteCurrency, period);
      const scopedCached = cached ? this.prepareHistoricalData(cached, this.providerFromPoints(cached), period) : null;
      if (scopedCached && this.hasUsableHistoricalData(scopedCached) && this.hasExpectedResolution(scopedCached, period)) {
        const provider = this.providerFromPoints(scopedCached);
        return {
          provider,
          points: scopedCached,
          requestedPeriod: period,
          actualInterval: "auto",
          fetchedAt: Date.now(),
          isCached: true,
          cacheStatus: "fresh"
        };
      }
    }

    let lastError: string | undefined;

    if (meta.supportedProviders.includes("coinbase")) {
      try {
        const data = this.prepareHistoricalData(
          await retryWithBackoff(() => this.coinbase.getHistoricalPrices(meta, period, signal), 3, 1000, signal),
          "coinbase",
          period
        );
        if (!this.hasUsableHistoricalData(data)) {
          throw new MarketInvalidResponseError(`Coinbase returned insufficient historical data for ${assetId}`);
        }
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
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`Coinbase getHistoricalPrices failed for ${assetId}:`, lastError, "- Fallback to CoinGecko");
      }
    }

    if (meta.supportedProviders.includes("coingecko")) {
      try {
        const data = this.prepareHistoricalData(
          await retryWithBackoff(() => this.coingecko.getHistoricalPrices(meta, period, signal), 3, 1000, signal),
          "coingecko",
          period
        );
        if (!this.hasUsableHistoricalData(data)) {
          throw new MarketInvalidResponseError(`CoinGecko returned insufficient historical data for ${assetId}`);
        }
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
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`CoinGecko getHistoricalPrices failed for ${assetId}:`, lastError);
      }
    }

    if (meta.supportedProviders.includes("cryptocompare") && this.cryptocompare.isConfigured()) {
      try {
        const data = this.prepareHistoricalData(
          await retryWithBackoff(() => this.cryptocompare.getHistoricalPrices(meta, period, signal), 2, 750, signal),
          "cryptocompare",
          period
        );
        if (!this.hasUsableHistoricalData(data)) {
          throw new MarketInvalidResponseError(`CryptoCompare returned insufficient historical data for ${assetId}`);
        }
        if (this.cache) await this.cache.saveHistoricalPrices(assetId, meta.quoteCurrency, period, data, "cryptocompare");
        return {
          provider: "cryptocompare",
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
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`CryptoCompare getHistoricalPrices failed for ${assetId}:`, lastError);
      }
    }

    if (this.cache) {
      const stale = await this.cache.getHistoricalPrices(assetId, meta.quoteCurrency, period, { allowStale: true });
      const scopedStale = stale ? this.prepareHistoricalData(stale, this.providerFromPoints(stale), period) : null;
      if (scopedStale && this.hasUsableHistoricalData(scopedStale)) {
        const provider = this.providerFromPoints(scopedStale);
        console.info(`[MarketService] getHistoricalPrices ${assetId} ${period}: using stale cache from ${provider}`);
        return {
          provider,
          points: scopedStale,
          requestedPeriod: period,
          actualInterval: "auto",
          fetchedAt: Date.now(),
          isCached: true,
          cacheStatus: "stale",
          reason: lastError ? `Último histórico válido en caché: ${lastError}` : "Último histórico válido en caché",
        };
      }
    }

    throw new MarketNotFoundError(lastError || `No providers available for ${assetId} historical data`);
  }

  private normalizeHistoricalData(data: HistoricalPriceData[], provider: string): HistoricalPriceData[] {
    return data
      .map((point) => ({
        timestamp: point.timestamp,
        price: point.price,
        source: point.source ?? provider,
        confidence: point.confidence ?? confidenceForProvider(provider)
      }))
      .filter((point) =>
        Number.isFinite(point.timestamp) &&
        Number.isFinite(point.price) &&
        point.timestamp > 0 &&
        point.price > 0
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  private prepareHistoricalData(data: HistoricalPriceData[], provider: string, period: string): HistoricalPriceData[] {
    const normalized = this.normalizeHistoricalData(data, provider);
    const windowMs = historicalWindowMs(period);
    if (windowMs === null || normalized.length === 0) return normalized;
    const latest = normalized[normalized.length - 1].timestamp;
    const cutoff = latest - windowMs;
    return normalized.filter((point) => point.timestamp >= cutoff);
  }

  private hasUsableHistoricalData(data: HistoricalPriceData[]): boolean {
    return this.normalizeHistoricalData(data, data[0]?.source ?? "cache").length >= MIN_HISTORICAL_POINTS;
  }

  private hasExpectedResolution(data: HistoricalPriceData[], period: string): boolean {
    const maxGap = maxExpectedGapMs(period);
    if (maxGap === null || data.length < 3) return true;
    const gaps: number[] = [];
    for (let i = 1; i < data.length; i += 1) {
      const gap = data[i].timestamp - data[i - 1].timestamp;
      if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
    }
    if (gaps.length === 0) return false;
    gaps.sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)];
    return medianGap <= maxGap;
  }

  private providerFromPoints(points: HistoricalPriceData[]): string {
    return points.find((point) => point.source)?.source ?? "cache";
  }
}
