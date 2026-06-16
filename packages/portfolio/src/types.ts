export type TransactionType = "buy" | "sell" | "convert" | "transfer_in" | "transfer_out" | "reward" | "staking" | "airdrop" | "fee" | "adjustment";
export type LegType = "source" | "destination" | "fee";

export interface TransactionLegInput {
  assetId: string;
  amount: number; // Positive for incoming, Negative for outgoing
  legType: LegType;
  valuationEur?: number; // Total value in EUR of this leg at the time of transaction
  valuationStatus?: "valued" | "pending" | "estimated";
}

export interface TransactionFeeInput {
  assetId: string;
  amount: number;
}

export interface TransactionInput {
  id: string;
  type: TransactionType;
  date: number; // timestamp
  legs: TransactionLegInput[];
  externalId?: string | null;
  notes?: string | null;
  fees?: TransactionFeeInput[];
  // Explicit cycle override. When absent, belongsToCycle() in
  // cycle-metrics.ts falls back to matching by date range.
  cycleId?: string | null;
}

