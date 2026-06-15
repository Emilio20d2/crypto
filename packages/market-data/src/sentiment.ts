import type { AssetMetadata } from "./mapping";
import { ASSET_MAP } from "./mapping";
import type { HistoricalPriceData } from "./interfaces";

type HistoricalPriceService = {
  getHistoricalPrices(assetId: string, period: string, signal?: AbortSignal): Promise<{
    provider: string;
    points: HistoricalPriceData[];
    requestedPeriod: string;
    actualInterval: string;
    fetchedAt: number;
    isCached: boolean;
  }>;
};

export type MarketSentimentDirection = "very_bullish" | "bullish" | "neutral" | "bearish" | "very_bearish";
export type SentimentTimeframe = "24h" | "7d" | "30d";
export type SentimentSignal = "bullish" | "neutral" | "bearish";

export type SentimentFactor = {
  id: string;
  label: string;
  signal: SentimentSignal;
  weight: number;
  contribution: number;
  value: number | string | null;
  source: string;
  updatedAt: number | null;
};

export type MarketSentiment = {
  scope: "global" | "asset";
  assetId?: string;
  direction: MarketSentimentDirection;
  score: number;
  confidence: number;
  timeframe: SentimentTimeframe;
  factors: SentimentFactor[];
  sourceSummary: string[];
  calculatedAt: number;
  validUntil: number | null;
  state: "live" | "cached" | "partial" | "unavailable";
  missingSignals?: string[];
  methodology?: string;
};

export interface MarketSentimentSnapshotRepository {
  saveSnapshot(sentiment: MarketSentiment, sourceVersion: string): Promise<void>;
  getHistory(input: {
    scope: "global" | "asset";
    assetId?: string | null;
    timeframe: SentimentTimeframe;
    limit?: number;
  }): Promise<MarketSentiment[]>;
}

export interface SentimentExternalSignals {
  fearGreedValue?: number | null;
  btcDominance?: number | null;
}

export const SENTIMENT_ALGORITHM_VERSION = "market-sentiment-v1";
const SENTIMENT_REQUEST_TIMEOUT_MS = 6_500;
const GLOBAL_SENTIMENT_ASSET_LIMIT = 8;

export const SENTIMENT_WEIGHTS = {
  trend7d: 0.25,
  trend30d: 0.20,
  momentum24h: 0.15,
  volumeConfirmation: 0.15,
  globalContext: 0.15,
  volatility: 0.10,
} as const;

const DIRECTION_RANGES: Array<{ direction: MarketSentimentDirection; min: number; max: number; label: string }> = [
  { direction: "very_bearish", min: -100, max: -60, label: "Muy bajista" },
  { direction: "bearish", min: -59, max: -20, label: "Bajista" },
  { direction: "neutral", min: -19, max: 19, label: "Neutral" },
  { direction: "bullish", min: 20, max: 59, label: "Alcista" },
  { direction: "very_bullish", min: 60, max: 100, label: "Muy alcista" },
];

function clamp(value: number, min = -100, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = SENTIMENT_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sentiment source timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function classifySentiment(score: number): MarketSentimentDirection {
  const bounded = clamp(Math.round(score));
  return DIRECTION_RANGES.find((range) => bounded >= range.min && bounded <= range.max)?.direction ?? "neutral";
}

function signalFromScore(score: number): SentimentSignal {
  if (score >= 20) return "bullish";
  if (score <= -20) return "bearish";
  return "neutral";
}

function percentChange(points: HistoricalPriceData[]) {
  const valid = points.filter((point) => Number.isFinite(point.price) && point.price > 0).sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < 2) return null;
  const first = valid[0].price;
  const last = valid[valid.length - 1].price;
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function latestTimestamp(points: HistoricalPriceData[]) {
  return points.length ? Math.max(...points.map((point) => point.timestamp)) : null;
}

function normalizeChange(change: number | null, scale: number) {
  if (change === null || !Number.isFinite(change)) return null;
  return clamp((change / scale) * 100);
}

function volatilityScore(points: HistoricalPriceData[]) {
  const valid = points.filter((point) => Number.isFinite(point.price) && point.price > 0).sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < 4) return null;
  const returns = valid.slice(1).map((point, index) => ((point.price - valid[index].price) / valid[index].price) * 100);
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);
  const trend = percentChange(valid) ?? 0;
  const penalty = clamp((volatility / 6) * 100, 0, 100);
  if (Math.abs(trend) < 2) return -penalty * 0.35;
  return trend > 0 ? clamp(35 - penalty * 0.45) : clamp(-35 - penalty * 0.45);
}

function factor(id: string, label: string, rawScore: number, weight: number, value: number | string | null, source: string, updatedAt: number | null): SentimentFactor {
  return {
    id,
    label,
    signal: signalFromScore(rawScore),
    weight,
    contribution: rawScore * weight,
    value,
    source,
    updatedAt,
  };
}

function calculateScore(factors: SentimentFactor[]) {
  const availableWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  if (availableWeight <= 0) return null;
  return clamp(factors.reduce((sum, item) => sum + item.contribution, 0) / availableWeight);
}

function confidenceFor(factors: SentimentFactor[], missingCount: number, newestTimestamp: number | null, expectedPoints: number) {
  if (factors.length === 0) return 0;
  const totalWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  const coverage = Math.min(1, totalWeight);
  const ageHours = newestTimestamp ? Math.max(0, (Date.now() - newestTimestamp) / 3_600_000) : 999;
  const recency = newestTimestamp ? Math.max(0, 1 - ageHours / 48) : 0;
  const rawValues = factors.map((item) => item.weight > 0 ? item.contribution / item.weight : 0);
  const mean = rawValues.reduce((sum, value) => sum + value, 0) / rawValues.length;
  const variance = rawValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rawValues.length;
  const coherence = Math.max(0, 1 - Math.sqrt(variance) / 90);
  const quantity = Math.min(1, factors.length / expectedPoints);
  const missingPenalty = Math.max(0, 1 - missingCount * 0.08);

  return Math.round(Math.max(0, Math.min(100, (coverage * 50 + recency * 20 + coherence * 20 + quantity * 10) * missingPenalty)));
}

function stateFrom(factors: SentimentFactor[], missing: string[], isCached: boolean): MarketSentiment["state"] {
  const availableWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  if (availableWeight < 0.2) return "unavailable";
  if (missing.length > 0 || availableWeight < 0.75) return "partial";
  return isCached ? "cached" : "live";
}

function unavailable(scope: "global" | "asset", timeframe: SentimentTimeframe, assetId?: string, missingSignals: string[] = []): MarketSentiment {
  const now = Date.now();
  return {
    scope,
    assetId,
    direction: "neutral",
    score: 0,
    confidence: 0,
    timeframe,
    factors: [],
    sourceSummary: ["Análisis de Crypto Control basado en datos de mercado"],
    calculatedAt: now,
    validUntil: null,
    state: "unavailable",
    missingSignals,
    methodology: "No hay datos suficientes para evaluar el sentimiento. No se convierte este estado en neutral.",
  };
}

export class MarketSentimentService {
  constructor(
    private marketService: HistoricalPriceService,
    private repository?: MarketSentimentSnapshotRepository
  ) {}

  async getAssetSentiment(assetId: string, timeframe: SentimentTimeframe, externalSignals?: SentimentExternalSignals): Promise<MarketSentiment> {
    const [day, week, month] = await Promise.allSettled([
      withTimeout(this.marketService.getHistoricalPrices(assetId, "24h")),
      withTimeout(this.marketService.getHistoricalPrices(assetId, "7d")),
      withTimeout(this.marketService.getHistoricalPrices(assetId, "30d")),
    ]);

    const factors: SentimentFactor[] = [];
    const missing: string[] = [];
    const sources = new Set<string>(["Análisis de Crypto Control basado en datos de mercado"]);
    let isCached = false;
    let newest: number | null = null;

    const dayData = day.status === "fulfilled" ? day.value : null;
    const weekData = week.status === "fulfilled" ? week.value : null;
    const monthData = month.status === "fulfilled" ? month.value : null;
    [dayData, weekData, monthData].forEach((result) => {
      if (!result) return;
      sources.add(result.provider);
      isCached = isCached || result.isCached || result.provider === "cache";
      const ts = latestTimestamp(result.points);
      if (ts) newest = Math.max(newest ?? 0, ts);
    });

    const dayChange = dayData ? percentChange(dayData.points) : null;
    const weekChange = weekData ? percentChange(weekData.points) : null;
    const monthChange = monthData ? percentChange(monthData.points) : null;
    const selectedPoints = timeframe === "24h" ? dayData?.points : timeframe === "7d" ? weekData?.points : monthData?.points;
    const vol = selectedPoints ? volatilityScore(selectedPoints) : null;

    const momentumScore = normalizeChange(dayChange, 8);
    if (momentumScore !== null) factors.push(factor("momentum_24h", "Momentum de 24 horas", momentumScore, SENTIMENT_WEIGHTS.momentum24h, `${dayChange!.toFixed(2)}%`, dayData?.provider ?? "mercado", latestTimestamp(dayData?.points ?? [])));
    else missing.push("Momentum de 24 horas");

    const trend7Score = normalizeChange(weekChange, 18);
    if (trend7Score !== null) factors.push(factor("trend_7d", "Tendencia de 7 días", trend7Score, SENTIMENT_WEIGHTS.trend7d, `${weekChange!.toFixed(2)}%`, weekData?.provider ?? "mercado", latestTimestamp(weekData?.points ?? [])));
    else missing.push("Tendencia de 7 días");

    const trend30Score = normalizeChange(monthChange, 35);
    if (trend30Score !== null) factors.push(factor("trend_30d", "Tendencia de 30 días", trend30Score, SENTIMENT_WEIGHTS.trend30d, `${monthChange!.toFixed(2)}%`, monthData?.provider ?? "mercado", latestTimestamp(monthData?.points ?? [])));
    else missing.push("Tendencia de 30 días");

    if (vol !== null) factors.push(factor("volatility", "Volatilidad", vol, SENTIMENT_WEIGHTS.volatility, Math.round(Math.abs(vol)), "precios históricos", latestTimestamp(selectedPoints ?? [])));
    else missing.push("Volatilidad");

    missing.push("Confirmación por volumen");

    const fgValue = externalSignals?.fearGreedValue;
    if (typeof fgValue === "number" && Number.isFinite(fgValue)) {
      // Map 0-100 Fear & Greed to -100..+100 sentiment score: 50 = neutral
      const fgScore = clamp((fgValue - 50) * 2);
      factors.push(factor("global_context", "Fear & Greed Index", fgScore, SENTIMENT_WEIGHTS.globalContext, Math.round(fgValue), "alternative.me", null));
      sources.add("alternative.me");
    } else {
      missing.push("Fear & Greed Index");
    }

    const score = calculateScore(factors);
    if (score === null) return unavailable("asset", timeframe, assetId, missing);

    const sentiment: MarketSentiment = {
      scope: "asset",
      assetId,
      direction: classifySentiment(score),
      score: Math.round(score),
      confidence: confidenceFor(factors, missing.length, newest, 4),
      timeframe,
      factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
      sourceSummary: Array.from(sources),
      calculatedAt: Date.now(),
      validUntil: Date.now() + 15 * 60 * 1000,
      state: stateFrom(factors, missing, isCached),
      missingSignals: missing,
      methodology: "Modelo v1: media ponderada de señales disponibles. Si una señal falta no se sustituye por neutral; baja la cobertura y la confianza.",
    };

    await this.repository?.saveSnapshot(sentiment, SENTIMENT_ALGORITHM_VERSION);
    return sentiment;
  }

  async getGlobalSentiment(assets: Pick<AssetMetadata, "internalId" | "symbol">[], timeframe: SentimentTimeframe, externalSignals?: SentimentExternalSignals): Promise<MarketSentiment> {
    const fullUniverse = assets.length > 0 ? assets : Object.values(ASSET_MAP).slice(0, 6);
    const universe = fullUniverse.slice(0, GLOBAL_SENTIMENT_ASSET_LIMIT);

    // Always fetch 24h AND the requested timeframe so we get both breadth signals
    const periods: SentimentTimeframe[] = timeframe === "24h" ? ["24h"] : ["24h", timeframe];
    const uniquePeriods = [...new Set(periods)];
    const allHistories = await Promise.allSettled(
      universe.flatMap((asset) => uniquePeriods.map((p) => withTimeout(this.marketService.getHistoricalPrices(asset.internalId || asset.symbol, p))))
    );

    // Organize results per asset per period
    const assetPeriodData: Map<string, Map<SentimentTimeframe, { change: number; result: { provider: string; isCached: boolean; points: HistoricalPriceData[] } }>> = new Map();
    universe.forEach((asset, assetIdx) => {
      const periodMap = new Map<SentimentTimeframe, { change: number; result: { provider: string; isCached: boolean; points: HistoricalPriceData[] } }>();
      uniquePeriods.forEach((p, pIdx) => {
        const settled = allHistories[assetIdx * uniquePeriods.length + pIdx];
        if (settled?.status !== "fulfilled") return;
        const change = percentChange(settled.value.points);
        if (change === null) return;
        periodMap.set(p, { change, result: settled.value });
      });
      if (periodMap.size > 0) assetPeriodData.set(asset.internalId || asset.symbol, periodMap);
    });

    if (assetPeriodData.size === 0) {
      return unavailable("global", timeframe, undefined, ["Amplitud de mercado", "Tendencias agregadas"]);
    }

    const factors: SentimentFactor[] = [];
    const missing: string[] = [];
    const sources = new Set<string>(["Análisis de Crypto Control basado en datos de mercado"]);
    if (fullUniverse.length > universe.length) missing.push(`${fullUniverse.length - universe.length} activos fuera de la ventana de cálculo`);

    // Primary period for breadth (use 24h for immediate amplitude, add selected period trend)
    const assetsWithDay = [...assetPeriodData.values()].flatMap((m) => m.has("24h") ? [m.get("24h")!] : []);
    const assetsWithPeriod = [...assetPeriodData.values()].flatMap((m) => m.has(timeframe) ? [m.get(timeframe)!] : []);
    const useBreadthPeriod = assetsWithDay.length > 0 ? assetsWithDay : assetsWithPeriod;

    useBreadthPeriod.forEach((item) => sources.add(item.result.provider));
    assetsWithPeriod.forEach((item) => sources.add(item.result.provider));

    const positive = useBreadthPeriod.filter((item) => item.change > 0).length;
    const breadth = ((positive / useBreadthPeriod.length) - 0.5) * 200;
    const avgChange24h = useBreadthPeriod.reduce((sum, item) => sum + item.change, 0) / useBreadthPeriod.length;
    const newest24h = Math.max(...useBreadthPeriod.map((item) => latestTimestamp(item.result.points) ?? 0));
    const isCached = [...assetPeriodData.values()].some((m) => [...m.values()].some((v) => v.result.isCached || v.result.provider === "cache"));

    factors.push(factor("market_breadth", "Amplitud del mercado (24h)", clamp(breadth), 0.30, `${positive}/${useBreadthPeriod.length} activos al alza`, "activos disponibles", newest24h));
    factors.push(factor("aggregate_trend_24h", "Tendencia agregada 24h", normalizeChange(avgChange24h, 8) ?? 0, 0.20, `${avgChange24h.toFixed(2)}%`, "precios históricos", newest24h));

    if (assetsWithPeriod.length > 0 && timeframe !== "24h") {
      const avgChangePeriod = assetsWithPeriod.reduce((sum, item) => sum + item.change, 0) / assetsWithPeriod.length;
      const newestPeriod = Math.max(...assetsWithPeriod.map((item) => latestTimestamp(item.result.points) ?? 0));
      const scale = timeframe === "7d" ? 18 : 35;
      factors.push(factor("aggregate_trend_period", `Tendencia agregada ${timeframe}`, normalizeChange(avgChangePeriod, scale) ?? 0, 0.25, `${avgChangePeriod.toFixed(2)}%`, "precios históricos", newestPeriod));
    } else if (timeframe !== "24h") {
      missing.push(`Tendencia ${timeframe} no disponible`);
    }

    const dispersion = useBreadthPeriod.length > 1
      ? Math.sqrt(useBreadthPeriod.reduce((sum, item) => sum + (item.change - avgChange24h) ** 2, 0) / useBreadthPeriod.length)
      : 0;
    const dispersionScore = clamp(avgChange24h >= 0 ? 30 - dispersion * 4 : -30 - dispersion * 4);
    factors.push(factor("market_coherence", "Coherencia entre activos", dispersionScore, 0.15, `${dispersion.toFixed(2)} p.p.`, "activos disponibles", newest24h));

    // Fear & Greed as global context
    const fgValue = externalSignals?.fearGreedValue;
    if (typeof fgValue === "number" && Number.isFinite(fgValue)) {
      const fgScore = clamp((fgValue - 50) * 2);
      factors.push(factor("fear_greed", "Fear & Greed Index", fgScore, 0.20, Math.round(fgValue), "alternative.me", null));
      sources.add("alternative.me");
    } else {
      missing.push("Fear & Greed Index");
    }

    // BTC dominance shift (high dominance rising = risk-off, falling = altseason / risk-on)
    const btcDom = externalSignals?.btcDominance;
    if (typeof btcDom === "number" && Number.isFinite(btcDom)) {
      // Neutralized: 50% dominance = neutral; used as context label only, weight 0.05
      sources.add("coingecko");
    }

    if (assetPeriodData.size < universe.length) missing.push(`${universe.length - assetPeriodData.size} activos sin datos suficientes`);
    missing.push("Volumen agregado comparable");

    const score = calculateScore(factors);
    if (score === null) return unavailable("global", timeframe, undefined, missing);

    const sentiment: MarketSentiment = {
      scope: "global",
      direction: classifySentiment(score),
      score: Math.round(score),
      confidence: confidenceFor(factors, missing.length, newest24h || null, 3),
      timeframe,
      factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
      sourceSummary: Array.from(sources),
      calculatedAt: Date.now(),
      validUntil: Date.now() + 15 * 60 * 1000,
      state: stateFrom(factors, missing, isCached),
      missingSignals: missing,
      methodology: "Metodología: ponderación uniforme de activos disponibles; no se usa capitalización si no está validada.",
    };

    await this.repository?.saveSnapshot(sentiment, SENTIMENT_ALGORITHM_VERSION);
    return sentiment;
  }

  async getHistory(input: { scope: "global" | "asset"; assetId?: string | null; timeframe: SentimentTimeframe; limit?: number }) {
    return this.repository?.getHistory(input) ?? [];
  }
}
