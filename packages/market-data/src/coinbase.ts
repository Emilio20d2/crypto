import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";
import { parseRetryAfter } from "./utils";
import { z } from "zod";

const COINBASE_API_URL = "https://api.exchange.coinbase.com";

const CoinbaseTickerSchema = z.object({
  price: z.string(),
}).passthrough();

const CoinbaseCandlesSchema = z.array(
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
);

export class CoinbaseProvider implements MarketDataProvider {
  readonly name = "coinbase";

  private async fetchWithTimeout(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 5_000);
    const abortFromCaller = () => controller.abort();

    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 404) throw new MarketNotFoundError(`Asset not found at ${url}`);
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
        throw new MarketRateLimitError(retryAfter, "Rate limit exceeded for Coinbase");
      }
      if (!response.ok) throw new MarketInvalidResponseError(`Coinbase API error: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: unknown) {
      const aborted = error instanceof DOMException && error.name === "AbortError"
        || error instanceof Error && error.name === "AbortError";
      if (aborted && signal?.aborted) throw error;
      if (aborted && timedOut) throw new MarketTimeoutError("Coinbase API timed out");
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    const rawData = await this.fetchWithTimeout(`${COINBASE_API_URL}/products/${meta.coinbaseProductId}/ticker`, signal);
    const parsed = CoinbaseTickerSchema.safeParse(rawData);
    if (parsed.success) {
      const price = Number(parsed.data.price);
      if (Number.isFinite(price) && price > 0) return price;
    }
    throw new MarketInvalidResponseError("Invalid current price data from Coinbase");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    let granularity = 86_400;
    const end = new Date();
    const start = new Date(end.getTime());

    if (period === "1h") {
      granularity = 60;
      start.setHours(start.getHours() - 1);
    } else if (period === "24h") {
      granularity = 900;
      start.setDate(start.getDate() - 1);
    } else if (period === "7d") {
      granularity = 3_600;
      start.setDate(start.getDate() - 7);
    } else if (period === "30d") {
      granularity = 21_600;
      start.setDate(start.getDate() - 30);
    } else if (period === "1y") {
      granularity = 86_400;
      start.setFullYear(start.getFullYear() - 1);
    } else {
      granularity = 86_400;
      start.setFullYear(start.getFullYear() - 10);
    }

    const allCandles: HistoricalPriceData[] = [];
    let currentEnd = new Date(end.getTime());
    const maxCandlesPerRequest = 300;
    const chunkMs = (maxCandlesPerRequest - 1) * granularity * 1_000;

    while (currentEnd > start) {
      const currentStart = new Date(Math.max(currentEnd.getTime() - chunkMs, start.getTime()));
      const url = `${COINBASE_API_URL}/products/${meta.coinbaseProductId}/candles?granularity=${granularity}&start=${currentStart.toISOString()}&end=${currentEnd.toISOString()}`;
      const rawData = await this.fetchWithTimeout(url, signal);
      const parsed = CoinbaseCandlesSchema.safeParse(rawData);
      if (!parsed.success) throw new MarketInvalidResponseError("Invalid historical data format from Coinbase");

      allCandles.push(...parsed.data.map((candle) => ({
        timestamp: candle[0] * 1_000,
        low: candle[1],
        high: candle[2],
        open: candle[3],
        price: candle[4],
        volume: candle[5],
        source: this.name,
        confidence: 1,
      })));

      if (parsed.data.length === 0 || currentStart.getTime() <= start.getTime()) break;
      currentEnd = currentStart;
    }

    const byTimestamp = new Map<number, HistoricalPriceData>();
    for (const point of allCandles) byTimestamp.set(point.timestamp, point);
    return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  }
}
