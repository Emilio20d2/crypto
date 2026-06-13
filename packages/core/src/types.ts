import { z } from "zod";

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
      };
    };

import { 
  PortfolioPositionSchema, type PortfolioPosition,
  PortfolioSummarySchema, type PortfolioSummary,
  AssetAllocationSchema, type AssetAllocation
} from "@crypto-control/portfolio";

export {
  PortfolioPositionSchema, type PortfolioPosition,
  PortfolioSummarySchema, type PortfolioSummary,
  AssetAllocationSchema, type AssetAllocation
};

// Market
export const CurrentPriceRequestSchema = z.object({
  assetId: z.string(),
  quoteCurrency: z.string()
});
export type CurrentPriceRequest = z.infer<typeof CurrentPriceRequestSchema>;

export const CurrentPriceResultSchema = z.object({
  price: z.number(),
  provider: z.string(),
  timestamp: z.number()
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
  value: z.number()
});

export const HistoricalPriceResultSchema = z.object({
  points: z.array(PointSchema),
  provider: z.string(),
  requestedPeriod: z.string(),
  actualInterval: z.string(),
  fetchedAt: z.number(),
  isCached: z.boolean()
});
export type HistoricalPriceResult = z.infer<typeof HistoricalPriceResultSchema>;

// API Interface
export interface CryptoControlAPI {
  assets: {
    list(): Promise<Result<any[]>>;
  };
  market: {
    getCurrentPrice(input: CurrentPriceRequest): Promise<Result<CurrentPriceResult>>;
    getHistoricalPrices(input: HistoricalPriceRequest): Promise<Result<HistoricalPriceResult>>;
  };
  portfolio: {
    getSummary(): Promise<Result<PortfolioSummary>>;
    getPositions(): Promise<Result<Record<string, PortfolioPosition>>>;
    getAllocation(): Promise<Result<AssetAllocation[]>>;
  };
}
