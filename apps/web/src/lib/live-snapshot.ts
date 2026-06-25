export interface LivePortfolioValueSnapshot {
  requestedAt: number;
  receivedAt: number;
  snapshotVersion: string;
  usingFallback: boolean;
  cryptoValueEur: number;
  eurBalance: number;
  eurcBalance: number;
  eurcValueEur: number;
  totalAssetValueEur: number;
  isComplete: boolean;
  missingPrices: string[];
  warnings: string[];
  timestamp: number;
  fiat: "EUR";
  priceVersion: string;
  portfolioVersion: string;
  accounts: Array<{
    assetId: string;
    availableBalance: number;
    holdBalance: number;
    totalBalance: number;
  }>;
  positions: Array<{
    assetId: string;
    quantity: number;
    availableBalance: number;
    holdBalance: number;
    currentPriceEur: number | null;
    currentValueEur: number | null;
    priceSource: string;
    priceStatus: string;
  }>;
}

// Single source of truth for total value computation: crypto + EURC reserve + EUR cash.
// No double-counting: EURC is NOT included in cryptoValueEur.
export function calculateLiveTotalAssetValue(snapshot: LivePortfolioValueSnapshot): number {
  return snapshot.cryptoValueEur + snapshot.eurcValueEur + snapshot.eurBalance;
}
