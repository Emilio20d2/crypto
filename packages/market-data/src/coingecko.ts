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

function mapVolumes(prices: Array<[number, number]>, volumes: Array<[number, number]>): HistoricalPriceData[] {
  const sortedPrices = [...prices].sort((a, b) => a[0] - b[0]);
  const sortedVolumes = [...volumes].sort((a, b) => a[0] - b[0]);
  let volumeIndex = 0;

  return sortedPrices.flatMap((priceRow): HistoricalPriceData[] => {
    const timestamp = priceRow[0];
    const price = priceRow[1];
    if (!Number.isFinite(timestamp) || !Number.isFinite(price) || timestamp <= 0 || price <= 0) return [];

    while (
      volumeIndex + 1 < sortedVolumes.length
      && Math.abs(sortedVolumes[volumeIndex + 1][0] - timestamp) <= Math.abs(sortedVolumes[volumeIndex][0] - timestamp)
    ) {
      volumeIndex += 1;
    }

    const candidate = sortedVolumes[volumeIndex];
    const volume = candidate && Number.isFinite(candidate[1]) && candidate[1] >= 0 ? candidate[1] : undefined;
    return [{ timestamp, price, volume, source: "coingecko", confidence: 0.9 }];
  });
}

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = "coingecko";

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
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        throw new MarketRateLimitError(retryAfter, "Rate limit exceeded for CoinGecko");
      }
      if (!response.ok) throw new MarketInvalidResponseError(`CoinGecko API error: ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error: unknown) {
      const aborted = error instanceof DOMException && error.name === "AbortError"
        || error instanceof Error && error.name === "AbortError";
      if (aborted && signal?.aborted) throw error;
      if (aborted && timedOut) throw new MarketTimeoutError("CoinGecko API timed out");
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    const currencyLower = meta.quoteCurrency.toLowerCase();
    const data = await this.fetchWithTimeout(
      `${COINGECKO_API_URL}/simple/price?ids=${meta.coinGeckoId}&vs_currencies=${currencyLower}`,
      signal,
    );
    const raw = data && typeof data === "object"
      ? (data as Record<string, Record<string, unknown>>)[meta.coinGeckoId]?.[currencyLower]
      : undefined;
    const price = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(price) && price > 0) return price;
    throw new MarketInvalidResponseError("Invalid current price data from CoinGecko");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    let days = "1";
    if (period === "7d") days = "7";
    else if (period === "30d") days = "30";
    else if (period === "1y") days = "365";
    else if (period === "all") days = "max";

    const currencyLower = meta.quoteCurrency.toLowerCase();
    const data = await this.fetchWithTimeout(
      `${COINGECKO_API_URL}/coins/${meta.coinGeckoId}/market_chart?vs_currency=${currencyLower}&days=${days}`,
      signal,
    );

    if (data && typeof data === "object" && Array.isArray((data as { prices?: unknown }).prices)) {
      const payload = data as { prices: unknown[]; total_volumes?: unknown[] };
      const prices = payload.prices.filter((row: unknown): row is [number, number] => Array.isArray(row) && row.length >= 2);
      const volumes = Array.isArray(payload.total_volumes)
        ? payload.total_volumes.filter((row: unknown): row is [number, number] => Array.isArray(row) && row.length >= 2)
        : [];
      const points = mapVolumes(prices, volumes);
      if (points.length > 0) return scopeToPeriod(points, period);
    }

    throw new MarketInvalidResponseError("Invalid historical data from CoinGecko");
  }
}
