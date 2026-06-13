import { z } from "zod";

export const PortfolioPositionSchema = z.object({
  assetId: z.string(),
  balance: z.number(),
  averagePriceEur: z.number().nullable(),
  totalInvestedEur: z.number(),
  hasPendingValuation: z.boolean().default(false)
});

export const PortfolioSummarySchema = z.object({
  totalValueEur: z.number(),
  totalInvestedEur: z.number(),
  unrealizedGainEur: z.number(),
  unrealizedGainPercentage: z.number()
});

export const AssetAllocationSchema = z.object({
  assetId: z.string(),
  weight: z.number(),
  valueEur: z.number()
});

export const RealizedGainSchema = z.object({
  transactionId: z.string(),
  assetId: z.string(),
  amountSold: z.number(),
  sellValueEur: z.number(),
  costBasisEur: z.number(),
  realizedGainEur: z.number()
});

export const PortfolioResultSchema = z.object({
  positions: z.record(z.string(), PortfolioPositionSchema),
  realizedGains: z.array(RealizedGainSchema)
});

export type PortfolioPosition = z.infer<typeof PortfolioPositionSchema>;
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
export type AssetAllocation = z.infer<typeof AssetAllocationSchema>;
export type RealizedGain = z.infer<typeof RealizedGainSchema>;
export type PortfolioResult = z.infer<typeof PortfolioResultSchema>;
