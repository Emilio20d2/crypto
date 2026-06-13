import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";

import { z } from "zod";

const COINBASE_API_URL = "https://api.exchange.coinbase.com";

const CoinbaseTickerSchema = z.object({
  price: z.string()
}).passthrough();

const CoinbaseCandlesSchema = z.array(
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
);

export class CoinbaseProvider implements MarketDataProvider {
  readonly name = "coinbase";

  private async fetchWithTimeout(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    
    // If external signal aborts, also abort our controller
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      if (response.status === 404) throw new MarketNotFoundError(`Asset not found at ${url}`);
      if (response.status === 429) throw new MarketRateLimitError(undefined, `Rate limit exceeded for Coinbase`);
      if (!response.ok) throw new MarketInvalidResponseError(`Coinbase API error: ${response.status} ${response.statusText}`);

      return await response.json();
    } catch (error: unknown) {
      clearTimeout(id);
      if (error instanceof Error && (error.name === "AbortError" || error.message?.includes("timeout"))) {
        throw new MarketTimeoutError("Coinbase API timed out");
      }
      throw error;
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    const rawData = await this.fetchWithTimeout(`${COINBASE_API_URL}/products/${meta.coinbaseProductId}/ticker`, signal);
    
    const parsed = CoinbaseTickerSchema.safeParse(rawData);
    if (parsed.success && parsed.data.price) {
      const price = parseFloat(parsed.data.price);
      if (!isNaN(price)) return price;
    }
    throw new MarketInvalidResponseError("Invalid current price data from Coinbase");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    let granularity = 86400; // default 1 day
    const end = new Date();
    const start = new Date(end.getTime());

    if (period === "1h") {
      granularity = 60; // 1 minute
      start.setHours(start.getHours() - 1);
    } else if (period === "24h") {
      granularity = 3600; // 1 hour
      start.setDate(start.getDate() - 1);
    } else if (period === "7d") {
      granularity = 21600; // 6 hours
      start.setDate(start.getDate() - 7);
    } else if (period === "30d") {
      granularity = 86400; // 1 day
      start.setDate(start.getDate() - 30);
    } else if (period === "1y") {
      granularity = 86400;
      start.setFullYear(start.getFullYear() - 1);
    } else {
      // all time
      granularity = 86400;
      start.setFullYear(start.getFullYear() - 10); // max 10 years for simplicity
    }

    const allCandles: HistoricalPriceData[] = [];
    let currentEnd = new Date(end.getTime());
    let currentStart = new Date(currentEnd.getTime());

    // Coinbase limit is 300 candles per request
    const maxCandlesPerRequest = 300;
    const chunkMs = maxCandlesPerRequest * granularity * 1000;

    while (currentEnd > start) {
      currentStart = new Date(Math.max(currentEnd.getTime() - chunkMs, start.getTime()));

      const startIso = currentStart.toISOString();
      const endIso = currentEnd.toISOString();
      const url = `${COINBASE_API_URL}/products/${meta.coinbaseProductId}/candles?granularity=${granularity}&start=${startIso}&end=${endIso}`;

      const rawData = await this.fetchWithTimeout(url, signal);

      const parsed = CoinbaseCandlesSchema.safeParse(rawData);
      if (!parsed.success) {
        throw new MarketInvalidResponseError("Invalid historical data format from Coinbase");
      }

      const chunk = parsed.data.map((candle: [number, number, number, number, number, number]) => ({
        timestamp: candle[0] * 1000,
        price: candle[4] // close price
      }));

      allCandles.push(...chunk);

      // If we got less than requested, we might have hit the earliest available data
      if (parsed.data.length === 0) {
        break;
      }

      // Move the end to the start of this chunk, minus one millisecond
      currentEnd = new Date(currentStart.getTime() - 1);
    }

    // Sort ascending by timestamp
    return allCandles.sort((a, b) => a.timestamp - b.timestamp);
  }
}
