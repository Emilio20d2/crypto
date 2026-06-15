export type FearGreedState = "live" | "cached" | "fallback" | "unavailable";

export interface FearGreedValue {
  value: number;
  label: string;
  timestamp: number;
  fetchedAt: number;
  source: "alternative.me";
}

export interface FearGreedServiceResult {
  value: number | null;
  label: string;
  timestamp: number | null;
  fetchedAt: number;
  isCached: boolean;
  source: "alternative.me";
  state: FearGreedState;
  error?: string;
}

export interface FearGreedLogger {
  debug?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface FearGreedServiceOptions {
  ttlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: FearGreedLogger;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function parseAlternativeMeFearGreed(payload: unknown, fetchedAt = Date.now()): FearGreedValue {
  const root = asRecord(payload);
  const data = Array.isArray(root?.data) ? root.data : null;
  const entry = data?.[0] ? asRecord(data[0]) : null;
  if (!entry) throw new Error("alternative.me/fng no devolvió data[0].");

  const rawValue = entry.value;
  const value = typeof rawValue === "string" || typeof rawValue === "number" ? Number(rawValue) : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Valor Fear & Greed inválido: ${String(rawValue)}`);
  }

  const rawTimestamp = entry.timestamp;
  const timestampSeconds = typeof rawTimestamp === "string" || typeof rawTimestamp === "number" ? Number(rawTimestamp) : NaN;
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error(`Timestamp Fear & Greed inválido: ${String(rawTimestamp)}`);
  }

  const label = typeof entry.value_classification === "string" && entry.value_classification.trim()
    ? entry.value_classification.trim()
    : "Sin clasificación";

  return {
    value,
    label,
    timestamp: timestampSeconds * 1000,
    fetchedAt,
    source: "alternative.me",
  };
}

function toResult(value: FearGreedValue, state: Exclude<FearGreedState, "unavailable">, error?: string): FearGreedServiceResult {
  return {
    ...value,
    isCached: state === "cached" || state === "fallback",
    state,
    error,
  };
}

export class FearGreedService {
  private lastValid: FearGreedValue | null = null;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly logger?: FearGreedLogger;

  constructor(options: FearGreedServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
  }

  getLastValidValue(maxAgeMs = Infinity): number | null {
    if (!this.lastValid) return null;
    if (this.now() - this.lastValid.fetchedAt > maxAgeMs) return null;
    return this.lastValid.value;
  }

  async get(): Promise<FearGreedServiceResult> {
    const now = this.now();
    if (this.lastValid && now - this.lastValid.fetchedAt < this.ttlMs) {
      this.logger?.debug?.("usando caché en memoria", { value: this.lastValid.value, fetchedAt: this.lastValid.fetchedAt });
      return toResult(this.lastValid, "cached");
    }

    this.logger?.debug?.("petición iniciada", { endpoint: "https://api.alternative.me/fng/" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl("https://api.alternative.me/fng/", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      this.logger?.debug?.("respuesta recibida", { ok: response.ok, status: response.status });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const parsed = parseAlternativeMeFearGreed(json, this.now());
      this.logger?.debug?.("valor parseado", { value: parsed.value, label: parsed.label, timestamp: parsed.timestamp });
      this.lastValid = parsed;
      return toResult(parsed, "live");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn?.("error exacto", message);
      if (this.lastValid) {
        this.logger?.warn?.("usando fallback con último valor válido", { value: this.lastValid.value, fetchedAt: this.lastValid.fetchedAt });
        return toResult(this.lastValid, "fallback", message);
      }
      this.logger?.warn?.("sin último valor válido; estado unavailable");
      return {
        value: null,
        label: "No disponible",
        timestamp: null,
        fetchedAt: this.now(),
        isCached: false,
        source: "alternative.me",
        state: "unavailable",
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
