import { PortfolioCalculator } from "./calculator";
import { PortfolioRepository } from "./repository";
import { PortfolioSummary, AssetAllocation, PortfolioResult } from "./schemas";

export interface PriceProvider {
  getCurrentPriceEur(assetId: string): Promise<number>;
}

export class PortfolioService {
  constructor(
    private repository: PortfolioRepository,
    private calculator: PortfolioCalculator,
    private priceProvider: PriceProvider
  ) {}

  async getPositions(): Promise<PortfolioResult> {
    const txs = await this.repository.getTransactions();
    return this.calculator.calculate(txs);
  }

  async getSummary(): Promise<PortfolioSummary> {
    const { positions } = await this.getPositions();
    
    let totalValueEur = 0;
    let totalInvestedEur = 0;

    for (const [assetId, pos] of Object.entries(positions)) {
      if (pos.balance > 0) {
        const currentPrice = await this.priceProvider.getCurrentPriceEur(assetId).catch(() => 0);
        const value = pos.balance * currentPrice;
        totalValueEur += value;
        totalInvestedEur += pos.totalInvestedEur;
      }
    }

    const unrealizedGainEur = totalValueEur - totalInvestedEur;
    const unrealizedGainPercentage = totalInvestedEur > 0 ? (unrealizedGainEur / totalInvestedEur) * 100 : 0;

    return {
      totalValueEur,
      totalInvestedEur,
      unrealizedGainEur,
      unrealizedGainPercentage
    };
  }

  async getAllocation(): Promise<AssetAllocation[]> {
    const { positions } = await this.getPositions();
    const allocations: AssetAllocation[] = [];
    let totalValueEur = 0;

    for (const [assetId, pos] of Object.entries(positions)) {
      if (pos.balance > 0) {
        const currentPrice = await this.priceProvider.getCurrentPriceEur(assetId).catch(() => 0);
        const value = pos.balance * currentPrice;
        totalValueEur += value;
        allocations.push({
          assetId,
          weight: 0,
          valueEur: value
        });
      }
    }

    if (totalValueEur > 0) {
      for (const alloc of allocations) {
        alloc.weight = (alloc.valueEur / totalValueEur) * 100;
      }
    }

    return allocations.sort((a, b) => b.valueEur - a.valueEur);
  }
}
