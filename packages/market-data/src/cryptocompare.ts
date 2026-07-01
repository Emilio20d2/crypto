import { MarketDataProvider, HistoricalPriceData } from "./interfaces";
import { MarketTimeoutError, MarketRateLimitError, MarketInvalidResponseError, MarketNotFoundError } from "./errors";
import { AssetMetadata } from "./mapping";
import { parseRetryAfter } from "./utils";

const CRYPTOCOMPARE_API_URL = "https://min-api.cryptocompare.com";

type CryptoCompareHistoryEndpoint = "histominute" | "histohour" | "histoday";

function historyConfig(period: string): { endpoint: CryptoCompareHistoryEndpoint; aggregate: number; limit: number } {
  if (period === "1h") return { endpoint: "histominute", aggregate: 1, limit: 60 };
  if (period === "24h") return { endpoint: "histominute", aggregate: 15, limit: 96 };
  if (period === "7d") return { endpoint: "histohour", aggregate: 1, limit: 168 };
  if (period === "30d") return { endpoint: "histohour", aggregate: 6, limit: 120 };
  if (period === "1y") return { endpoint: "histoday", aggregate: 1, limit: 365 };
  return { endpoint: "histoday", aggregate: 1, limit: 2000 };
}

function extractHistoryRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = root.Data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).Data)) {
    return (data as Record<string, unknown>).Data as unknown[];
  }
  return [];
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const raw = record[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

export class CryptoCompareProvider implements MarketDataProvider {
  readonly name = "cryptocompare";
  private readonly apiKey?: string;

  constructor(apiKey = process.env.CRYPTOCOMPARE_API_KEY) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private async fetchWithTimeout(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 6_000);
    const abortFromCaller = () => controller.abort();

    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(this.apiKey ? { authorization: `Apikey ${this.apiKey}` } : {}),
        },
      });

      if (response.status === 404) throw new MarketNotFoundError(`Asset not found at ${url}`);
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
        throw new MarketRateLimitError(retryAfter, "Rate limit exceeded for CryptoCompare");
      }
      if (!response.ok) throw new MarketInvalidResponseError(`CryptoCompare API error: ${response.status} ${response.statusText}`);

      const json = await response.json();
      if (json && typeof json === "object") {
        const payload = json as Record<string, unknown>;
        if (payload.Response === "Error") {
          throw new MarketInvalidResponseError(typeof payload.Message === "string" ? payload.Message : "CryptoCompare returned an error");
        }
      }
      return json;
    } catch (error: unknown) {
      const aborted = error instanceof DOMException && error.name === "AbortError"
        || error instanceof Error && error.name === "AbortError";
      if (aborted && signal?.aborted) throw error;
      if (aborted && timedOut) throw new MarketTimeoutError("CryptoCompare API timed out");
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async getCurrentPrice(meta: AssetMetadata, signal?: AbortSignal): Promise<number> {
    if (!this.isConfigured()) throw new MarketInvalidResponseError("CryptoCompare API key not configured");
    const params = new URLSearchParams({ fsym: meta.symbol, tsyms: meta.quoteCurrency });
    const data = await this.fetchWithTimeout(`${CRYPTOCOMPARE_API_URL}/data/price?${params.toString()}`, signal);
    const record = data && typeof data === "object" ? data as Record<string, unknown> : null;
    const raw = record?.[meta.quoteCurrency];
    const price = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(price) && price > 0) return price;
    throw new MarketInvalidResponseError("Invalid current price data from CryptoCompare");
  }

  async getHistoricalPrices(meta: AssetMetadata, period: string, signal?: AbortSignal): Promise<HistoricalPriceData[]> {
    if (!this.isConfigured()) throw new MarketInvalidResponseError("CryptoCompare API key not configured");
    const { endpoint, aggregate, limit } = historyConfig(period);
    const params = new URLSearchParams({
      fsym: meta.symbol,
      tsym: meta.quoteCurrency,
      limit: String(limit),
      aggregate: String(aggregate),
    });
    const data = await this.fetchWithTimeout(`${CRYPTOCOMPARE_API_URL}/data/v2/${endpoint}?${params.toString()}`, signal);
    const rows = extractHistoryRows(data);
    const points = rows.flatMap((row): HistoricalPriceData[] => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const time = numberValue(record, "time") ?? NaN;
      const close = numberValue(record, "close") ?? NaN;
      if (!Number.isFinite(time) || !Number.isFinite(close) || time <= 0 || close <= 0) return [];
      return [{
        timestamp: time * 1000,
        price: close,
        open: numberValue(record, "open"),
        high: numberValue(record, "high"),
        low: numberValue(record, "low"),
        volume: numberValue(record, "volumeto") ?? numberValue(record, "volumefrom"),
        source: this.name,
        confidence: 0.85,
      }];
    });

    if (points.length === 0) throw new MarketInvalidResponseError("Invalid historical data from CryptoCompare");
    return points.sort((a, b) => a.timestamp - b.timestamp);
  }
}
