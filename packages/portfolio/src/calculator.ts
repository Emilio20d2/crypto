import type { TransactionInput } from "./types";
import type { PortfolioResult, PortfolioPosition, RealizedGain } from "./schemas";

export class PortfolioCalculator {
  calculate(transactions: TransactionInput[]): PortfolioResult {
    // Sort transactions by date ascending
    const sorted = [...transactions].sort((a, b) => a.date - b.date);

    const positions: Record<string, PortfolioPosition> = {};
    const realizedGains: RealizedGain[] = [];

    const getPos = (assetId: string): PortfolioPosition => {
      if (!positions[assetId]) {
        positions[assetId] = {
          assetId,
          balance: 0,
          averagePriceEur: null,
          totalInvestedEur: 0,
          hasPendingValuation: false
        };
      }
      return positions[assetId];
    };

    for (const tx of sorted) {
      // Group legs by asset
      const assetImpacts: Record<string, { amount: number; valuation: number | undefined; type: string; hasPendingValuation: boolean }> = {};

      for (const leg of tx.legs) {
        if (!assetImpacts[leg.assetId]) {
          assetImpacts[leg.assetId] = { amount: 0, valuation: undefined, type: leg.legType, hasPendingValuation: false };
        }
        assetImpacts[leg.assetId].amount += leg.amount;
        if (leg.valuationEur !== undefined) {
          assetImpacts[leg.assetId].valuation = (assetImpacts[leg.assetId].valuation || 0) + leg.valuationEur;
        }
        if (leg.valuationStatus === "pending") {
          assetImpacts[leg.assetId].hasPendingValuation = true;
        }
      }

      for (const assetId in assetImpacts) {
        const impact = assetImpacts[assetId];
        const pos = getPos(assetId);

        if (impact.hasPendingValuation) {
          pos.hasPendingValuation = true;
        }

        if (impact.amount > 0) {
          // Inflow (Buy, Receive, Reward)
          if (tx.type === "transfer_in" || tx.type === "transfer_out") {
            // Transfers do not affect cost basis, just balance
            pos.balance += impact.amount;
          } else {
            if (impact.valuation !== undefined) {
              pos.totalInvestedEur += impact.valuation;
            } else if (tx.type === "reward" || tx.type === "staking" || tx.type === "airdrop") {
              // Note: If valuationStatus is missing, we could treat it as pending.
              pos.hasPendingValuation = true;
            }
            pos.balance += impact.amount;
          }
        } else if (impact.amount < 0) {
          // Outflow (Sell, Send, Fee)
          const amountSold = Math.abs(impact.amount);
          
          const avgPrice = pos.balance > 0 ? pos.totalInvestedEur / pos.balance : 0;
          const costBasis = avgPrice * amountSold;
             
          pos.balance -= amountSold;
          pos.totalInvestedEur = Math.max(0, pos.totalInvestedEur - costBasis); // Prevent negative due to floats

          if (tx.type !== "transfer_in" && tx.type !== "transfer_out") {
             if (impact.valuation !== undefined) {
               const sellValue = Math.abs(impact.valuation);
               realizedGains.push({
                 transactionId: tx.id,
                 assetId,
                 amountSold,
                 sellValueEur: sellValue,
                 costBasisEur: costBasis,
                 realizedGainEur: sellValue - costBasis
               });
             }
          }
        }
        
        // Update average price
        if (pos.balance > 0.00000001) {
          pos.averagePriceEur = pos.totalInvestedEur / pos.balance;
        } else {
          pos.averagePriceEur = null;
          pos.balance = 0;
          pos.totalInvestedEur = 0;
        }
      }
    }

    return {
      positions,
      realizedGains
    };
  }
}
