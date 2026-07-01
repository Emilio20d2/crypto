import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketSentimentService } from "./sentiment";
import type { HistoricalPriceData } from "./interfaces";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

function points(count = 12, withVolume = true): HistoricalPriceData[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: NOW - (count - 1 - index) * 60 * 60_000,
    price: 100 + index * 2,
    open: 99 + index * 2,
    high: 102 + index * 2,
    low: 98 + index * 2,
    volume: withVolume ? 1_000 + index * 120 : undefined,
    source: "coinbase",
    confidence: 1,
  }));
}

function historyResult(period: string, options?: { withVolume?: boolean; cacheStatus?: "fresh" | "partial" | "stale" | "miss"; isCached?: boolean }) {
  return {
    provider: "coinbase",
    points: points(12, options?.withVolume ?? true),
    requestedPeriod: period,
    actualInterval: "auto",
    fetchedAt: NOW,
    isCached: options?.isCached ?? false,
    cacheStatus: options?.cacheStatus ?? "miss",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MarketSentimentService data quality", () => {
  it("uses volume as a real factor when all OHLCV inputs are available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const marketService = {
      getHistoricalPrices: vi.fn(async (_assetId: string, period: string) => historyResult(period)),
    };
    const service = new MarketSentimentService(marketService);

    const sentiment = await service.getAssetSentiment("BTC", "24h", { fearGreedValue: 70 });

    expect(sentiment.state).toBe("live");
    expect(sentiment.factors.some((item) => item.id === "volume_confirmation")).toBe(true);
    expect(sentiment.missingSignals).toEqual([]);
    expect(sentiment.confidence).toBeGreaterThan(0);
  });

  it("marks stale cached histories as partial instead of presenting them as complete", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const marketService = {
      getHistoricalPrices: vi.fn(async (_assetId: string, period: string) => historyResult(period, {
        cacheStatus: "stale",
        isCached: true,
      })),
    };
    const service = new MarketSentimentService(marketService);

    const sentiment = await service.getAssetSentiment("BTC", "7d", { fearGreedValue: 50 });

    expect(sentiment.state).toBe("partial");
    expect(sentiment.missingSignals?.some((item) => item.includes("caducado"))).toBe(true);
    expect(sentiment.validUntil).toBe(NOW + 5 * 60_000);
  });

  it("declares missing volume and lowers the state to partial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const marketService = {
      getHistoricalPrices: vi.fn(async (_assetId: string, period: string) => historyResult(period, { withVolume: false })),
    };
    const service = new MarketSentimentService(marketService);

    const sentiment = await service.getAssetSentiment("BTC", "30d", { fearGreedValue: 60 });

    expect(sentiment.state).toBe("partial");
    expect(sentiment.factors.some((item) => item.id === "volume_confirmation")).toBe(false);
    expect(sentiment.missingSignals).toContain("Confirmación por volumen");
  });

  it("rejects out-of-range Fear & Greed values as missing input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const marketService = {
      getHistoricalPrices: vi.fn(async (_assetId: string, period: string) => historyResult(period)),
    };
    const service = new MarketSentimentService(marketService);

    const sentiment = await service.getAssetSentiment("BTC", "24h", { fearGreedValue: 140 });

    expect(sentiment.state).toBe("partial");
    expect(sentiment.missingSignals).toContain("Fear & Greed Index");
  });
});
