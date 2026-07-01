import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";
import { parseRetryAfter } from "./utils";

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

function periodWindowMs(period: string): number | null {
  if (period === "1h") return 60 * 60 * 1000;
  if (period === "24h") return 24 * 60 * 60 * 1000;
  if (period === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (period === "30d") return 30 * 24 * 60 * 60 * 1000;
  if (period === "1y") return 365 * 24 * 60 * 60 * 1000;
  return null;
}

function scopeToPeriod(points: HistoricalPriceData[], period: string): HistoricalPriceData[] {
  const windowMs = periodWindowMs(period);
  if (windowMs === null || points.length === 0) return points;
  const latest = points[points.length - 1].timestamp;
  const cutoff = latest - windowMs;
  return points.filter((point) => point.timestamp >= cutoff);
}

function nearestVolume(volumes: Array<[number, number]>, timestamp: number): number | undefined {
  if (volumes.length === 0) return undefined;
  let best: [number, number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of volumes) {
    const distance = Math.abs(row[0] - timestamp);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best && Number.isFinite(best[1]) && best[1] >= 0 ? best[1] : undefined;
}

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = "coingecko";

  private async fetchWithTimeout(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);

    if (signal) signal.addEventListener("abort", () => controller.abort());

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
      if (error instanceof DOMException && error.name === "AbortError") throw error;
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
      const volumes: Array<[number, number]> = Array.isArray(data.total_volumes)
        ? data.total_volumes.filter((row: unknown): row is [number, number] => Array.isArray(row) && row.length >= 2)
        : [];
      const points = data.prices.map((p: [number, number]) => ({
        timestamp: p[0],
        price: p[1],
        volume: nearestVolume(volumes, p[0]),
        source: this.name,
        confidence: 0.9,
      })).sort((a: HistoricalPriceData, b: HistoricalPriceData) => a.timestamp - b.timestamp);
      return scopeToPeriod(points, period);
    }

    throw new MarketInvalidResponseError("Invalid historical data from CoinGecko");
  }
}
