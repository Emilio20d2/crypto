import type { PortfolioCalculator } from "./calculator";
import type { PortfolioRepository } from "./repository";
import type { PortfolioSummary, AssetAllocation, PortfolioResult } from "./schemas";

export interface PriceResult {
  price: number;
  state: "live" | "cached" | "unavailable";
}

export interface PriceProvider {
  getCurrentPriceEur(assetId: string): Promise<PriceResult>;
}

export class PortfolioService {
  private repository: PortfolioRepository;
  private calculator: PortfolioCalculator;
  private priceProvider: PriceProvider;

  constructor(
    repository: PortfolioRepository,
    calculator: PortfolioCalculator,
    priceProvider: PriceProvider
  ) {
    this.repository = repository;
    this.calculator = calculator;
    this.priceProvider = priceProvider;
  }

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
        const result = await this.priceProvider.getCurrentPriceEur(assetId).catch(() => ({ price: 0, state: "unavailable" as const }));
        const currentPrice = result.state !== "unavailable" ? result.price : 0;
        const value = pos.balance * currentPrice;
        totalValueEur += value;
        totalInvestedEur += pos.totalInvestedEur;
        
        if (result.state === "unavailable") {
          pos.hasPendingValuation = true;
        }
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
        const result = await this.priceProvider.getCurrentPriceEur(assetId).catch(() => ({ price: 0, state: "unavailable" as const }));
        const currentPrice = result.state !== "unavailable" ? result.price : 0;
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

  async recalculateFifo(): Promise<void> {
    const txs = await this.repository.getTransactions();
    const fifoCalculator = new (await import("./fifo")).FifoCalculator();
    const result = fifoCalculator.calculate(txs);
    
    await this.repository.saveFifoResults(
      result.lots,
      result.consumptions,
      result.realizedGains
    );
  }

  async getRealizedGains() {
    // Re-calculate FIFO to ensure it is up to date, or rely on a DB query.
    // For now we just return from calculator, but ideally it should be cached in DB or query DB.
    const txs = await this.repository.getTransactions();
    const fifoCalculator = new (await import("./fifo")).FifoCalculator();
    return fifoCalculator.calculate(txs).realizedGains;
  }

  async getFifoLots() {
    const txs = await this.repository.getTransactions();
    const fifoCalculator = new (await import("./fifo")).FifoCalculator();
    return fifoCalculator.calculate(txs).lots;
  }
}
