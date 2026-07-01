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
    cacheStatus?: "fresh" | "partial" | "stale" | "miss";
    reason?: string;
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

export const SENTIMENT_ALGORITHM_VERSION = "market-sentiment-v2-ohlcv";
const SENTIMENT_REQUEST_TIMEOUT_MS = 6_500;
const GLOBAL_SENTIMENT_ASSET_LIMIT = 12;

export const SENTIMENT_WEIGHTS = {
  trend7d: 0.22,
  trend30d: 0.18,
  momentum24h: 0.14,
  volumeConfirmation: 0.18,
  globalContext: 0.18,
  volatility: 0.10,
} as const;

const DIRECTION_RANGES: Array<{ direction: MarketSentimentDirection; min: number; max: number }> = [
  { direction: "very_bearish", min: -100, max: -60 },
  { direction: "bearish", min: -59, max: -20 },
  { direction: "neutral", min: -19, max: 19 },
  { direction: "bullish", min: 20, max: 59 },
  { direction: "very_bullish", min: 60, max: 100 },
];

function clamp(value: number, min = -100, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = SENTIMENT_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sentiment source timeout")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
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

function validPoints(points: HistoricalPriceData[]): HistoricalPriceData[] {
  return points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.timestamp > 0 && point.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function percentChange(points: HistoricalPriceData[]): number | null {
  const valid = validPoints(points);
  if (valid.length < 2) return null;
  return ((valid.at(-1)!.price - valid[0].price) / valid[0].price) * 100;
}

function latestTimestamp(points: HistoricalPriceData[]): number | null {
  const valid = validPoints(points);
  return valid.length ? valid.at(-1)!.timestamp : null;
}

function normalizeChange(change: number | null, scale: number): number | null {
  if (change === null || !Number.isFinite(change)) return null;
  return clamp((change / scale) * 100);
}

function volatilityScore(points: HistoricalPriceData[]): number | null {
  const valid = validPoints(points);
  if (valid.length < 4) return null;
  const returns = valid.slice(1).map((point, index) => ((point.price - valid[index].price) / valid[index].price) * 100);
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);
  const trend = percentChange(valid) ?? 0;
  const penalty = clamp((volatility / 6) * 100, 0, 100);
  if (Math.abs(trend) < 2) return -penalty * 0.35;
  return trend > 0 ? clamp(35 - penalty * 0.45) : clamp(-35 - penalty * 0.45);
}

function volumeConfirmation(points: HistoricalPriceData[]): { score: number; label: string } | null {
  const valid = validPoints(points).filter((point) => typeof point.volume === "number" && Number.isFinite(point.volume) && point.volume! >= 0);
  if (valid.length < 6) return null;
  const split = Math.max(2, Math.floor(valid.length * 0.7));
  const previous = valid.slice(0, split);
  const recent = valid.slice(split);
  if (recent.length < 2) return null;
  const previousAverage = previous.reduce((sum, point) => sum + (point.volume ?? 0), 0) / previous.length;
  const recentAverage = recent.reduce((sum, point) => sum + (point.volume ?? 0), 0) / recent.length;
  if (!(previousAverage > 0)) return null;
  const volumeChange = ((recentAverage - previousAverage) / previousAverage) * 100;
  const priceChange = percentChange(recent) ?? 0;
  const intensity = clamp(Math.abs(volumeChange) * 1.5, 0, 100);
  let score = 0;
  if (priceChange > 0.25) score = volumeChange >= 0 ? intensity : -intensity * 0.35;
  else if (priceChange < -0.25) score = volumeChange >= 0 ? -intensity : intensity * 0.25;
  else score = -Math.min(35, intensity * 0.35);
  return { score: clamp(score), label: `${volumeChange >= 0 ? "+" : ""}${volumeChange.toFixed(1)}% volumen; ${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}% precio` };
}

function factor(id: string, label: string, rawScore: number, weight: number, value: number | string | null, source: string, updatedAt: number | null): SentimentFactor {
  return { id, label, signal: signalFromScore(rawScore), weight, contribution: rawScore * weight, value, source, updatedAt };
}

function calculateScore(factors: SentimentFactor[]): number | null {
  const availableWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  if (availableWeight <= 0) return null;
  return clamp(factors.reduce((sum, item) => sum + item.contribution, 0) / availableWeight);
}

function confidenceFor(factors: SentimentFactor[], missingCount: number, newestTimestamp: number | null, expectedFactors: number): number {
  if (factors.length === 0) return 0;
  const totalWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  const coverage = Math.min(1, totalWeight);
  const ageHours = newestTimestamp ? Math.max(0, (Date.now() - newestTimestamp) / 3_600_000) : 999;
  const recency = newestTimestamp ? Math.max(0, 1 - ageHours / 48) : 0;
  const rawValues = factors.map((item) => item.weight > 0 ? item.contribution / item.weight : 0);
  const mean = rawValues.reduce((sum, value) => sum + value, 0) / rawValues.length;
  const variance = rawValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rawValues.length;
  const coherence = Math.max(0, 1 - Math.sqrt(variance) / 90);
  const quantity = Math.min(1, factors.length / expectedFactors);
  const missingPenalty = Math.max(0, 1 - missingCount * 0.08);
  return Math.round(Math.max(0, Math.min(100, (coverage * 50 + recency * 20 + coherence * 20 + quantity * 10) * missingPenalty)));
}

function stateFrom(factors: SentimentFactor[], missing: string[], isCached: boolean): MarketSentiment["state"] {
  const availableWeight = factors.reduce((sum, item) => sum + item.weight, 0);
  if (availableWeight < 0.2) return "unavailable";
  if (missing.length > 0 || availableWeight < 0.85) return "partial";
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
    sourceSummary: ["Crypto Control: datos insuficientes"],
    calculatedAt: now,
    validUntil: null,
    state: "unavailable",
    missingSignals,
    methodology: "No hay datos suficientes. El estado no se convierte artificialmente en neutral.",
  };
}

export class MarketSentimentService {
  constructor(private marketService: HistoricalPriceService, private repository?: MarketSentimentSnapshotRepository) {}

  async getAssetSentiment(assetId: string, timeframe: SentimentTimeframe, externalSignals?: SentimentExternalSignals): Promise<MarketSentiment> {
    const [day, week, month] = await Promise.allSettled([
      withTimeout(this.marketService.getHistoricalPrices(assetId, "24h")),
      withTimeout(this.marketService.getHistoricalPrices(assetId, "7d")),
      withTimeout(this.marketService.getHistoricalPrices(assetId, "30d")),
    ]);

    const dayData = day.status === "fulfilled" ? day.value : null;
    const weekData = week.status === "fulfilled" ? week.value : null;
    const monthData = month.status === "fulfilled" ? month.value : null;
    const selected = timeframe === "24h" ? dayData : timeframe === "7d" ? weekData : monthData;
    const factors: SentimentFactor[] = [];
    const missing: string[] = [];
    const sources = new Set<string>(["Crypto Control OHLCV"]);
    let isCached = false;
    let newest: number | null = null;

    for (const result of [dayData, weekData, monthData]) {
      if (!result) continue;
      sources.add(result.provider);
      isCached = isCached || result.isCached || result.cacheStatus === "stale";
      const timestamp = latestTimestamp(result.points);
      if (timestamp) newest = Math.max(newest ?? 0, timestamp);
    }

    const dayChange = dayData ? percentChange(dayData.points) : null;
    const weekChange = weekData ? percentChange(weekData.points) : null;
    const monthChange = monthData ? percentChange(monthData.points) : null;
    const momentum = normalizeChange(dayChange, 8);
    const trend7 = normalizeChange(weekChange, 18);
    const trend30 = normalizeChange(monthChange, 35);
    const volatility = selected ? volatilityScore(selected.points) : null;
    const volume = selected ? volumeConfirmation(selected.points) : null;

    if (momentum !== null) factors.push(factor("momentum_24h", "Momentum de 24 horas", momentum, SENTIMENT_WEIGHTS.momentum24h, `${dayChange!.toFixed(2)}%`, dayData?.provider ?? "mercado", latestTimestamp(dayData?.points ?? [])));
    else missing.push("Momentum de 24 horas");
    if (trend7 !== null) factors.push(factor("trend_7d", "Tendencia de 7 días", trend7, SENTIMENT_WEIGHTS.trend7d, `${weekChange!.toFixed(2)}%`, weekData?.provider ?? "mercado", latestTimestamp(weekData?.points ?? [])));
    else missing.push("Tendencia de 7 días");
    if (trend30 !== null) factors.push(factor("trend_30d", "Tendencia de 30 días", trend30, SENTIMENT_WEIGHTS.trend30d, `${monthChange!.toFixed(2)}%`, monthData?.provider ?? "mercado", latestTimestamp(monthData?.points ?? [])));
    else missing.push("Tendencia de 30 días");
    if (volatility !== null) factors.push(factor("volatility", "Volatilidad", volatility, SENTIMENT_WEIGHTS.volatility, Math.round(Math.abs(volatility)), selected?.provider ?? "mercado", latestTimestamp(selected?.points ?? [])));
    else missing.push("Volatilidad");
    if (volume) factors.push(factor("volume_confirmation", "Confirmación por volumen", volume.score, SENTIMENT_WEIGHTS.volumeConfirmation, volume.label, selected?.provider ?? "mercado", latestTimestamp(selected?.points ?? [])));
    else missing.push("Confirmación por volumen");

    const fearGreed = externalSignals?.fearGreedValue;
    if (typeof fearGreed === "number" && Number.isFinite(fearGreed)) {
      factors.push(factor("global_context", "Fear & Greed Index", clamp((fearGreed - 50) * 2), SENTIMENT_WEIGHTS.globalContext, Math.round(fearGreed), "alternative.me", null));
      sources.add("alternative.me");
    } else missing.push("Fear & Greed Index");

    const score = calculateScore(factors);
    if (score === null) return unavailable("asset", timeframe, assetId, missing);
    const sentiment: MarketSentiment = {
      scope: "asset",
      assetId,
      direction: classifySentiment(score),
      score: Math.round(score),
      confidence: confidenceFor(factors, missing.length, newest, 6),
      timeframe,
      factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
      sourceSummary: [...sources],
      calculatedAt: Date.now(),
      validUntil: Date.now() + 15 * 60_000,
      state: stateFrom(factors, missing, isCached),
      missingSignals: missing,
      methodology: "Modelo v2: precios y volumen OHLCV persistidos. Las señales ausentes reducen cobertura y confianza; nunca se rellenan con neutral.",
    };
    await this.repository?.saveSnapshot(sentiment, SENTIMENT_ALGORITHM_VERSION);
    return sentiment;
  }

  async getGlobalSentiment(assets: Pick<AssetMetadata, "internalId" | "symbol">[], timeframe: SentimentTimeframe, externalSignals?: SentimentExternalSignals): Promise<MarketSentiment> {
    const fullUniverse = assets.length > 0 ? assets : Object.values(ASSET_MAP);
    const universe = fullUniverse.slice(0, GLOBAL_SENTIMENT_ASSET_LIMIT);
    const periods: SentimentTimeframe[] = timeframe === "24h" ? ["24h"] : ["24h", timeframe];
    const uniquePeriods = [...new Set(periods)];
    const settled = await Promise.allSettled(universe.flatMap((asset) => uniquePeriods.map((period) => withTimeout(this.marketService.getHistoricalPrices(asset.internalId || asset.symbol, period)))));

    const rows: Array<{ assetId: string; period: SentimentTimeframe; change: number; result: Awaited<ReturnType<HistoricalPriceService["getHistoricalPrices"]>> }> = [];
    universe.forEach((asset, assetIndex) => {
      uniquePeriods.forEach((period, periodIndex) => {
        const item = settled[assetIndex * uniquePeriods.length + periodIndex];
        if (item?.status !== "fulfilled") return;
        const change = percentChange(item.value.points);
        if (change !== null) rows.push({ assetId: asset.internalId || asset.symbol, period, change, result: item.value });
      });
    });

    const dayRows = rows.filter((row) => row.period === "24h");
    const periodRows = rows.filter((row) => row.period === timeframe);
    const breadthRows = dayRows.length ? dayRows : periodRows;
    if (breadthRows.length === 0) return unavailable("global", timeframe, undefined, ["Amplitud de mercado", "Tendencias agregadas"]);

    const factors: SentimentFactor[] = [];
    const missing: string[] = [];
    const sources = new Set<string>(["Crypto Control OHLCV"]);
    rows.forEach((row) => sources.add(row.result.provider));
    const positive = breadthRows.filter((row) => row.change > 0).length;
    const breadth = ((positive / breadthRows.length) - 0.5) * 200;
    const average24h = breadthRows.reduce((sum, row) => sum + row.change, 0) / breadthRows.length;
    const newest = Math.max(...breadthRows.map((row) => latestTimestamp(row.result.points) ?? 0));
    const isCached = rows.some((row) => row.result.isCached || row.result.cacheStatus === "stale");
    factors.push(factor("market_breadth", "Amplitud del mercado", clamp(breadth), 0.30, `${positive}/${breadthRows.length} activos al alza`, "universo disponible", newest));
    factors.push(factor("aggregate_trend_24h", "Tendencia agregada 24h", normalizeChange(average24h, 8) ?? 0, 0.20, `${average24h.toFixed(2)}%`, "precios históricos", newest));

    if (timeframe !== "24h" && periodRows.length) {
      const average = periodRows.reduce((sum, row) => sum + row.change, 0) / periodRows.length;
      factors.push(factor("aggregate_trend_period", `Tendencia agregada ${timeframe}`, normalizeChange(average, timeframe === "7d" ? 18 : 35) ?? 0, 0.20, `${average.toFixed(2)}%`, "precios históricos", Math.max(...periodRows.map((row) => latestTimestamp(row.result.points) ?? 0))));
    } else if (timeframe !== "24h") missing.push(`Tendencia ${timeframe}`);

    const volumeRows = breadthRows.flatMap((row) => {
      const confirmation = volumeConfirmation(row.result.points);
      return confirmation ? [confirmation.score] : [];
    });
    if (volumeRows.length >= Math.max(2, Math.ceil(breadthRows.length * 0.5))) {
      const volumeScore = volumeRows.reduce((sum, value) => sum + value, 0) / volumeRows.length;
      factors.push(factor("aggregate_volume", "Confirmación agregada por volumen", volumeScore, 0.15, `${volumeRows.length}/${breadthRows.length} activos`, "OHLCV", newest));
    } else missing.push("Volumen agregado comparable");

    const fearGreed = externalSignals?.fearGreedValue;
    if (typeof fearGreed === "number" && Number.isFinite(fearGreed)) {
      factors.push(factor("fear_greed", "Fear & Greed Index", clamp((fearGreed - 50) * 2), 0.15, Math.round(fearGreed), "alternative.me", null));
      sources.add("alternative.me");
    } else missing.push("Fear & Greed Index");

    if (rows.filter((row) => row.period === "24h").length < universe.length) missing.push(`${universe.length - dayRows.length} activos sin 24h completo`);
    if (fullUniverse.length > universe.length) missing.push(`${fullUniverse.length - universe.length} activos fuera del límite de cálculo`);
    const score = calculateScore(factors);
    if (score === null) return unavailable("global", timeframe, undefined, missing);

    const sentiment: MarketSentiment = {
      scope: "global",
      direction: classifySentiment(score),
      score: Math.round(score),
      confidence: confidenceFor(factors, missing.length, newest || null, 5),
      timeframe,
      factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
      sourceSummary: [...sources],
      calculatedAt: Date.now(),
      validUntil: Date.now() + 15 * 60_000,
      state: stateFrom(factors, missing, isCached),
      missingSignals: missing,
      methodology: "Modelo global v2: amplitud, tendencias y volumen del universo disponible. Los huecos se declaran y reducen la confianza.",
    };
    await this.repository?.saveSnapshot(sentiment, SENTIMENT_ALGORITHM_VERSION);
    return sentiment;
  }

  async getHistory(input: { scope: "global" | "asset"; assetId?: string | null; timeframe: SentimentTimeframe; limit?: number }) {
    return this.repository?.getHistory(input) ?? [];
  }
}
