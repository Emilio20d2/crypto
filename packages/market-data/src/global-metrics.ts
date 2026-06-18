export type GlobalMetricsSource = "coingecko" | "coinlore" | "coinpaprika";
export type GlobalMetricsState = "live" | "cached" | "fallback" | "unavailable";

export interface GlobalMetricsValue {
  btcDominance: number | null;
  ethDominance: number | null;
  totalMarketCapUsd: number | null;
  totalVolumeUsd: number | null;
  marketCapChangePercentage24h: number | null;
  fetchedAt: number;
  source: GlobalMetricsSource;
}

export interface GlobalMetricsServiceResult extends GlobalMetricsValue {
  isCached: boolean;
  state: GlobalMetricsState;
  error?: string;
  providersTried?: string[];
}

export interface GlobalMetricsLogger {
  debug?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface GlobalMetricsServiceOptions {
  ttlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: GlobalMetricsLogger;
}

type Parser = (payload: unknown, fetchedAt: number) => GlobalMetricsValue;

interface ProviderSpec {
  source: GlobalMetricsSource;
  url: string;
  parse: Parser;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function finiteOrNull(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function requireAnyMetric(value: GlobalMetricsValue, source: string): GlobalMetricsValue {
  const metrics = [
    value.btcDominance,
    value.ethDominance,
    value.totalMarketCapUsd,
    value.totalVolumeUsd,
    value.marketCapChangePercentage24h,
  ];
  if (!metrics.some((metric) => metric !== null)) {
    throw new Error(`${source} no devolvió métricas globales utilizables.`);
  }
  return value;
}

export function parseCoinGeckoGlobalMetrics(payload: unknown, fetchedAt = Date.now()): GlobalMetricsValue {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (!data) throw new Error("CoinGecko /global no devolvió data.");
  const marketCapPercentage = asRecord(data.market_cap_percentage);
  const totalMarketCap = asRecord(data.total_market_cap);
  const totalVolume = asRecord(data.total_volume);

  return requireAnyMetric({
    btcDominance: finiteOrNull(marketCapPercentage?.btc),
    ethDominance: finiteOrNull(marketCapPercentage?.eth),
    totalMarketCapUsd: finiteOrNull(totalMarketCap?.usd),
    totalVolumeUsd: finiteOrNull(totalVolume?.usd),
    marketCapChangePercentage24h: finiteOrNull(data.market_cap_change_percentage_24h_usd),
    fetchedAt,
    source: "coingecko",
  }, "CoinGecko");
}

export function parseCoinLoreGlobalMetrics(payload: unknown, fetchedAt = Date.now()): GlobalMetricsValue {
  const entry = Array.isArray(payload) ? asRecord(payload[0]) : null;
  if (!entry) throw new Error("CoinLore /global no devolvió el primer registro.");

  return requireAnyMetric({
    btcDominance: finiteOrNull(entry.btc_d),
    ethDominance: finiteOrNull(entry.eth_d),
    totalMarketCapUsd: finiteOrNull(entry.total_mcap),
    totalVolumeUsd: finiteOrNull(entry.total_volume),
    marketCapChangePercentage24h: finiteOrNull(entry.mcap_change),
    fetchedAt,
    source: "coinlore",
  }, "CoinLore");
}

export function parseCoinPaprikaGlobalMetrics(payload: unknown, fetchedAt = Date.now()): GlobalMetricsValue {
  const root = asRecord(payload);
  if (!root) throw new Error("CoinPaprika /global no devolvió un objeto.");
  const lastUpdatedSeconds = finiteOrNull(root.last_updated);

  return requireAnyMetric({
    btcDominance: finiteOrNull(root.bitcoin_dominance_percentage),
    ethDominance: null,
    totalMarketCapUsd: finiteOrNull(root.market_cap_usd),
    totalVolumeUsd: finiteOrNull(root.volume_24h_usd),
    marketCapChangePercentage24h: finiteOrNull(root.market_cap_change_24h),
    fetchedAt: lastUpdatedSeconds ? lastUpdatedSeconds * 1000 : fetchedAt,
    source: "coinpaprika",
  }, "CoinPaprika");
}

function toResult(value: GlobalMetricsValue, state: Exclude<GlobalMetricsState, "unavailable">, error?: string, providersTried?: string[]): GlobalMetricsServiceResult {
  return {
    ...value,
    isCached: state === "cached" || state === "fallback",
    state,
    error,
    providersTried,
  };
}

const PROVIDERS: ProviderSpec[] = [
  {
    source: "coingecko",
    url: "https://api.coingecko.com/api/v3/global",
    parse: parseCoinGeckoGlobalMetrics,
  },
  {
    source: "coinlore",
    url: "https://api.coinlore.net/api/global/",
    parse: parseCoinLoreGlobalMetrics,
  },
  {
    source: "coinpaprika",
    url: "https://api.coinpaprika.com/v1/global",
    parse: parseCoinPaprikaGlobalMetrics,
  },
];

export class GlobalMetricsService {
  private lastValid: GlobalMetricsValue | null = null;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly logger?: GlobalMetricsLogger;

  constructor(options: GlobalMetricsServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
  }

  getLastValid(maxAgeMs = Infinity): GlobalMetricsValue | null {
    if (!this.lastValid) return null;
    if (this.now() - this.lastValid.fetchedAt > maxAgeMs) return null;
    return this.lastValid;
  }

  async get(): Promise<GlobalMetricsServiceResult> {
    const now = this.now();
    if (this.lastValid && now - this.lastValid.fetchedAt < this.ttlMs) {
      this.logger?.debug?.("usando caché en memoria", { source: this.lastValid.source, fetchedAt: this.lastValid.fetchedAt });
      return toResult(this.lastValid, "cached");
    }

    const providersTried: string[] = [];
    const errors: string[] = [];

    for (const provider of PROVIDERS) {
      providersTried.push(provider.source);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        this.logger?.debug?.("petición iniciada", { source: provider.source, endpoint: provider.url });
        const response = await this.fetchImpl(provider.url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        this.logger?.debug?.("respuesta recibida", { source: provider.source, ok: response.ok, status: response.status });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const parsed = provider.parse(await response.json(), this.now());
        this.logger?.debug?.("valor parseado", { source: parsed.source, totalMarketCapUsd: parsed.totalMarketCapUsd, btcDominance: parsed.btcDominance });
        this.lastValid = parsed;
        return toResult(parsed, "live", undefined, providersTried);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.source}: ${message}`);
        this.logger?.warn?.("error exacto", { source: provider.source, message });
      } finally {
        clearTimeout(timeout);
      }
    }

    const error = errors.join(" | ") || "No hay proveedores globales disponibles.";
    if (this.lastValid) {
      this.logger?.warn?.("usando fallback con último valor válido", { source: this.lastValid.source, fetchedAt: this.lastValid.fetchedAt });
      return toResult(this.lastValid, "fallback", error, providersTried);
    }

    return {
      btcDominance: null,
      ethDominance: null,
      totalMarketCapUsd: null,
      totalVolumeUsd: null,
      marketCapChangePercentage24h: null,
      fetchedAt: this.now(),
      source: "coingecko",
      isCached: false,
      state: "unavailable",
      error,
      providersTried,
    };
  }
}
