import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";
import { parseRetryAfter } from "./utils";

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = "coingecko";

  private async fetchWithTimeout(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      if (response.status === 404) throw new MarketNotFoundError(`Asset not found at ${url}`);
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        throw new MarketRateLimitError(retryAfter, "Rate limit exceeded for CoinGecko");
      }
      if (!response.ok) throw new MarketInvalidResponseError(`CoinGecko API error: ${response.status} ${response.statusText}`);

      return await response.json();
    } catch (error: unknown) {
      clearTimeout(id);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error && (error.name === "AbortError" || error.message?.includes("timeout"))) {
        throw new MarketTimeoutError("CoinGecko API timed out");
      }
      throw error;
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    const currencyLower = meta.quoteCurrency.toLowerCase();
    const data = await this.fetchWithTimeout(
      `${COINGECKO_API_URL}/simple/price?ids=${meta.coinGeckoId}&vs_currencies=${currencyLower}`,
      signal
    );

    if (data && data[meta.coinGeckoId] && data[meta.coinGeckoId][currencyLower]) {
      return data[meta.coinGeckoId][currencyLower];
    }
    throw new MarketInvalidResponseError("Invalid current price data from CoinGecko");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    let days = "1";
    if (period === "1h") days = "1";
    else if (period === "7d") days = "7";
    else if (period === "30d") days = "30";
    else if (period === "1y") days = "365";
    else if (period === "all") days = "max";

    const currencyLower = meta.quoteCurrency.toLowerCase();
    const data = await this.fetchWithTimeout(
      `${COINGECKO_API_URL}/coins/${meta.coinGeckoId}/market_chart?vs_currency=${currencyLower}&days=${days}`,
      signal
    );

    if (data && Array.isArray(data.prices)) {
      return data.prices.map((p: [number, number]) => ({
        timestamp: p[0],
        price: p[1]
      }));
    }
    
    throw new MarketInvalidResponseError("Invalid historical data from CoinGecko");
  }
}
