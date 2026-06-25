import { z } from "zod";

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        httpStatus?: number;
        correlationId?: string;
      };
    };

import {
  PortfolioPositionSchema, type PortfolioPosition,
  PortfolioSummarySchema, type PortfolioSummary,
  AssetAllocationSchema, type AssetAllocation,
  type RealizedGain,
  type FifoLot,
} from "@crypto-control/portfolio";

export {
  PortfolioPositionSchema, type PortfolioPosition,
  PortfolioSummarySchema, type PortfolioSummary,
  AssetAllocationSchema, type AssetAllocation,
  type RealizedGain,
  type FifoLot,
};

// Market
export const CurrentPriceRequestSchema = z.object({
  assetId: z.string(),
  quoteCurrency: z.string()
});
export type CurrentPriceRequest = z.infer<typeof CurrentPriceRequestSchema>;

export const CurrentPriceResultSchema = z.object({
  price: z.number().nullable(),
  state: z.enum(["live", "cached", "unavailable"]),
  provider: z.string(),
  fetchedAt: z.number(),
  reason: z.string().optional()
});
export type CurrentPriceResult = z.infer<typeof CurrentPriceResultSchema>;

export const HistoricalPriceRequestSchema = z.object({
  assetId: z.string(),
  quoteCurrency: z.string(),
  period: z.enum(["1h", "24h", "7d", "30d", "1y", "all"])
});
export type HistoricalPriceRequest = z.infer<typeof HistoricalPriceRequestSchema>;

export const PointSchema = z.object({
  time: z.number(), // Unix timestamp seconds
  timestamp: z.number().optional(),
  value: z.number(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const HistoricalPriceResultSchema = z.object({
  points: z.array(PointSchema),
  provider: z.string(),
  requestedPeriod: z.string(),
  actualInterval: z.string(),
  fetchedAt: z.number(),
  isCached: z.boolean(),
  cacheStatus: z.enum(["fresh", "partial", "stale", "miss"]).optional(),
  reason: z.string().optional()
});
export type HistoricalPriceResult = z.infer<typeof HistoricalPriceResultSchema>;

export const MarketOverviewRequestSchema = z.object({
  assetId: z.string(),
  quoteCurrency: z.string()
});
export type MarketOverviewRequest = z.infer<typeof MarketOverviewRequestSchema>;

export const MarketOverviewResultSchema = z.object({
  price: z.number().nullable(),
  change24h: z.number().nullable(),
  high24h: z.number().nullable(),
  low24h: z.number().nullable(),
  volume24h: z.number().nullable(),
  volumeChange24h: z.number().nullable(),
  marketCap: z.number().nullable(),
  dominance: z.number().nullable(),
  fetchedAt: z.number().nullable(),
  provider: z.string()
});
export type MarketOverviewResult = z.infer<typeof MarketOverviewResultSchema>;

export const FearGreedResultSchema = z.object({
  value: z.number().min(0).max(100).nullable(),
  label: z.string(),
  timestamp: z.number().nullable(),
  fetchedAt: z.number(),
  isCached: z.boolean(),
  source: z.string().optional(),
  state: z.enum(["live", "cached", "fallback", "unavailable"]).optional(),
  error: z.string().optional(),
});
export type FearGreedResult = z.infer<typeof FearGreedResultSchema>;

export const GlobalMetricsResultSchema = z.object({
  btcDominance: z.number().nullable(),
  ethDominance: z.number().nullable(),
  totalMarketCapUsd: z.number().nullable(),
  totalVolumeUsd: z.number().nullable(),
  marketCapChangePercentage24h: z.number().nullable(),
  fetchedAt: z.number(),
  isCached: z.boolean(),
  source: z.string().optional(),
  state: z.enum(["live", "cached", "fallback", "unavailable"]).optional(),
  error: z.string().optional(),
  providersTried: z.array(z.string()).optional(),
});
export type GlobalMetricsResult = z.infer<typeof GlobalMetricsResultSchema>;

export const MarketSentimentDirectionSchema = z.enum(["very_bullish", "bullish", "neutral", "bearish", "very_bearish"]);
export type MarketSentimentDirection = z.infer<typeof MarketSentimentDirectionSchema>;

export const MarketSentimentTimeframeSchema = z.enum(["24h", "7d", "30d"]);
export type MarketSentimentTimeframe = z.infer<typeof MarketSentimentTimeframeSchema>;

export const SentimentFactorSchema = z.object({
  id: z.string(),
  label: z.string(),
  signal: z.enum(["bullish", "neutral", "bearish"]),
  weight: z.number(),
  contribution: z.number(),
  value: z.union([z.number(), z.string()]).nullable(),
  source: z.string(),
  updatedAt: z.number().nullable()
});
export type SentimentFactor = z.infer<typeof SentimentFactorSchema>;

export const MarketSentimentSchema = z.object({
  scope: z.enum(["global", "asset"]),
  assetId: z.string().optional(),
  direction: MarketSentimentDirectionSchema,
  score: z.number().min(-100).max(100),
  confidence: z.number().min(0).max(100),
  timeframe: MarketSentimentTimeframeSchema,
  factors: z.array(SentimentFactorSchema),
  sourceSummary: z.array(z.string()),
  calculatedAt: z.number(),
  validUntil: z.number().nullable(),
  state: z.enum(["live", "cached", "partial", "unavailable"]),
  missingSignals: z.array(z.string()).optional(),
  methodology: z.string().optional()
});
export type MarketSentiment = z.infer<typeof MarketSentimentSchema>;

export const MarketSentimentHistoryRequestSchema = z.object({
  scope: z.enum(["global", "asset"]),
  assetId: z.string().nullable().optional(),
  timeframe: MarketSentimentTimeframeSchema,
  limit: z.number().int().positive().max(200).optional()
});

import { Asset, AssetSchema, type CryptoControlIndex } from "./validation";
export type { Asset };
export { AssetSchema };

// Catálogo enriquecido — devuelto por assets:catalog
export interface CatalogAsset {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  type: string;
  inDb: boolean;             // ya existe en la tabla assets
  supportedProviders: string[];
  hasCoinbase: boolean;
}

// API Interface
export interface CryptoControlAPI {
  assets: {
    list(): Promise<Result<Asset[]>>;
    catalog(): Promise<Result<CatalogAsset[]>>;
    register(input: { id: string; symbol: string; name: string; logoUrl?: string | null; type?: string }): Promise<Result<Asset>>;
  };
  market: {
    getCurrentPrice(input: CurrentPriceRequest): Promise<Result<CurrentPriceResult>>;
    getHistoricalPrices(input: HistoricalPriceRequest): Promise<Result<HistoricalPriceResult>>;
    getOverview(input: MarketOverviewRequest): Promise<Result<MarketOverviewResult>>;
    getFearGreed(): Promise<Result<FearGreedResult>>;
    getGlobalMetrics(): Promise<Result<GlobalMetricsResult>>;
    getCryptoControlIndex(): Promise<Result<CryptoControlIndex>>;
  };
  portfolio: {
    getSummary(): Promise<Result<PortfolioSummary>>;
    getPositions(): Promise<Result<Record<string, PortfolioPosition>>>;
    getAllocation(): Promise<Result<AssetAllocation[]>>;
    getRealizedGains(): Promise<Result<RealizedGain[]>>;
    getFifoLots(): Promise<Result<FifoLot[]>>;
    getHistoricalSeries(input?: { period?: "1h" | "24h" | "1w" | "1m" | "1y" | "all" }): Promise<Result<{
      points: { time: number; value: number }[];
      meta: { txCount: number; pricePoints: number; assetsTracked: string[] };
    }>>;
    backfillCostBasis(): Promise<Result<{
      legsChecked: number;
      legsBackfilled: number;
      legsStillPending: number;
      byAsset: Record<string, { checked: number; backfilled: number }>;
    }>>;
    getLiveSnapshot(portfolioUuid: string): Promise<Result<{
      timestamp: number;
      fiat: "EUR";
      positions: Array<{
        assetId: string;
        quantity: number;
        currentPriceEur: number | null;
        priceSource: string;
        priceStatus: "live" | "cached" | "unavailable";
        currentValueEur: number | null;
      }>;
      cryptoValueEur: number;
      eurcValueEur: number;
      totalAssetValueEur: number;
      priceVersion: string;
      portfolioVersion: string;
    } | null>>;
  };
  diagnostics: {
    getReport(): Promise<Result<{
      accounts: number;
      balances: number;
      transactions: number;
      conversions: number;
      fees: number;
      assets: number;
      positions: number;
      historicalPrices: number;
      missingPrices: number;
      missingCosts: number;
      perAsset: {
        symbol: string;
        amount: number;
        hasPrice: boolean;
        hasHistoricalPrice: boolean;
        hasCostBasis: boolean;
        rendered: boolean;
      }[];
    }>>;
  };
}
