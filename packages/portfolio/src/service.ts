import type { PortfolioCalculator } from "./calculator";
import type { FifoCalculator } from "./fifo";
import type { PortfolioRepository } from "./repository";
import type { PortfolioSummary, AssetAllocation, PortfolioResult } from "./schemas";

export interface PriceResult {
  price: number | null;
  state: "live" | "cached" | "unavailable";
  provider?: string;
  fetchedAt?: number;
}

export interface PriceProvider {
  getCurrentPriceEur(assetId: string): Promise<PriceResult>;
}

export class PortfolioService {
  private repository: PortfolioRepository;
  private portfolioCalculator: PortfolioCalculator;
  private fifoCalculator: FifoCalculator;
  private priceProvider: PriceProvider;

  constructor(
    repository: PortfolioRepository,
    portfolioCalculator: PortfolioCalculator,
    fifoCalculator: FifoCalculator,
    priceProvider: PriceProvider
  ) {
    this.repository = repository;
    this.portfolioCalculator = portfolioCalculator;
    this.fifoCalculator = fifoCalculator;
    this.priceProvider = priceProvider;
  }

  async getPositions(): Promise<PortfolioResult> {
    const txs = await this.repository.getTransactions();
    return this.portfolioCalculator.calculate(txs);
  }

  async getSummary(): Promise<PortfolioSummary> {
    const { positions } = await this.getPositions();
    
    let totalValueEur = 0;
    let totalInvestedEur = 0;
    let valuedAssets = 0;
    let unavailableAssets = 0;
    let lastSuccessfulPriceAt: number | null = null;
    let assetCount = 0;

    for (const [assetId, pos] of Object.entries(positions)) {
      if (pos.balance > 0) {
        assetCount++;
        let result: PriceResult;
        try {
          result = await this.priceProvider.getCurrentPriceEur(assetId);
        } catch (error) {
          result = { price: null, state: "unavailable" };
        }
        
        if (result.price !== null) {
          const value = pos.balance * result.price;
          totalValueEur += value;
          totalInvestedEur += pos.totalInvestedEur;
          valuedAssets++;
          if (result.fetchedAt && (!lastSuccessfulPriceAt || result.fetchedAt > lastSuccessfulPriceAt)) {
            lastSuccessfulPriceAt = result.fetchedAt;
          }
        } else {
          unavailableAssets++;
          pos.hasPendingValuation = true;
        }
      }
    }

    const unrealizedGainEur = totalValueEur - totalInvestedEur;
    const unrealizedGainPercentage = totalInvestedEur > 0 ? (unrealizedGainEur / totalInvestedEur) * 100 : 0;
    
    let valuationStatus: "complete" | "partial" | "empty" = "empty";
    if (assetCount > 0) {
      if (valuedAssets === assetCount) valuationStatus = "complete";
      else if (valuedAssets > 0) valuationStatus = "partial";
      else valuationStatus = "empty";
    }

    return {
      totalValueEur,
      totalInvestedEur,
      unrealizedGainEur,
      unrealizedGainPercentage,
      valuationStatus,
      valuedAssets,
      unavailableAssets,
      lastSuccessfulPriceAt
    };
  }

  async getAllocation(): Promise<AssetAllocation[]> {
    const { positions } = await this.getPositions();
    const allocations: AssetAllocation[] = [];
    let totalValueEur = 0;

    for (const [assetId, pos] of Object.entries(positions)) {
      if (pos.balance > 0) {
        let result: PriceResult;
        try {
          result = await this.priceProvider.getCurrentPriceEur(assetId);
        } catch (error) {
          result = { price: null, state: "unavailable" };
        }
        
        if (result.price !== null) {
          const value = pos.balance * result.price;
          totalValueEur += value;
          allocations.push({
            assetId,
            weight: 0,
            valueEur: value
          });
        }
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
    const result = this.fifoCalculator.calculate(txs);
    
    await this.repository.saveFifoResults(
      result.lots,
      result.consumptions,
      result.realizedGains
    );
  }

  async getRealizedGains() {
    const txs = await this.repository.getTransactions();
    return this.fifoCalculator.calculate(txs).realizedGains;
  }

  async getFifoLots() {
    const txs = await this.repository.getTransactions();
    return this.fifoCalculator.calculate(txs).lots;
  }
}
