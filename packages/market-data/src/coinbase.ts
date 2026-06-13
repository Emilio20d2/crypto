import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";

const COINBASE_API_URL = "https://api.exchange.coinbase.com";

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
    } catch (error: any) {
      clearTimeout(id);
      if (error.name === "AbortError" || error.message?.includes("timeout")) {
        throw new MarketTimeoutError("Coinbase API timed out");
      }
      throw error;
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    const data = await this.fetchWithTimeout(`${COINBASE_API_URL}/products/${meta.coinbaseProductId}/ticker`, signal);
    
    if (data && data.price) {
      return parseFloat(data.price);
    }
    throw new MarketInvalidResponseError("Invalid current price data from Coinbase");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    let granularity = 86400; // default 1 day
    let start = new Date();

    if (period === "24h") {
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

    const startIso = start.toISOString();
    const url = `${COINBASE_API_URL}/products/${meta.coinbaseProductId}/candles?granularity=${granularity}&start=${startIso}`;
    
    const data = await this.fetchWithTimeout(url, signal);

    if (!Array.isArray(data)) {
      throw new MarketInvalidResponseError("Invalid historical data format from Coinbase");
    }

    // Coinbase returns array of arrays: [time, low, high, open, close, volume]
    return data.map((candle: any) => ({
      timestamp: candle[0] * 1000,
      price: candle[4] // close price
    })).sort((a, b) => a.timestamp - b.timestamp); // Coinbase returns descending, we want ascending
  }
}
