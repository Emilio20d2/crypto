import type { PortfolioLiveSnapshot as LivePortfolioValueSnapshot } from "@crypto-control/core";

export type { LivePortfolioValueSnapshot };

// Single source of truth for total value computation: crypto + EURC reserve + EUR cash.
// No double-counting: EURC is NOT included in cryptoValueEur.
export function calculateLiveTotalAssetValue(snapshot: LivePortfolioValueSnapshot): number {
  return snapshot.cryptoValueEur + snapshot.eurcValueEur + snapshot.eurBalance;
}
