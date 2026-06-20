import type { PortfolioCalculator } from "./calculator";
import type { FifoCalculator, FifoLot } from "./fifo";
import type { PortfolioRepository } from "./repository";
import type { PortfolioSummary, AssetAllocation, PortfolioPosition, PortfolioResult } from "./schemas";
import type { TransactionInput } from "./types";

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
    const fifoResult = this.fifoCalculator.calculate(txs);
    const positions = this.buildFifoPositions(txs, fifoResult.lots);
    
    try {
      const realBalances = await this.repository.getAccountBalances();
      
      for (const [assetId, balance] of Object.entries(realBalances)) {
        this.applyLiveBalance(positions, assetId, balance, fifoResult.lots);
      }
      
      for (const assetId of Object.keys(positions)) {
        if (realBalances[assetId] === undefined) {
          positions[assetId].balance = 0;
        }
      }
    } catch (e) {
      console.warn("Could not fetch real balances, falling back to computed balances:", e);
    }
    
    return {
      positions,
      realizedGains: fifoResult.realizedGains
    };
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
          if (pos.hasPendingValuation) {
            unavailableAssets++;
          } else {
            totalInvestedEur += pos.totalInvestedEur;
          }
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
      if (valuedAssets === assetCount && unavailableAssets === 0) valuationStatus = "complete";
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
        } else {
          allocations.push({
            assetId,
            weight: 0,
            valueEur: 0
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
    const stored = await this.repository.getStoredRealizedGains?.();
    if (stored && stored.length > 0) return stored;

    const txs = await this.repository.getTransactions();
    const txDateById = new Map(txs.map((tx) => [tx.id, tx.date]));
    return this.fifoCalculator.calculate(txs).realizedGains.map((gain) => ({
      ...gain,
      date: txDateById.get(gain.transactionId),
    }));
  }

  async getFifoLots() {
    const stored = await this.repository.getStoredFifoLots?.();
    if (stored && stored.length > 0) return stored;

    const txs = await this.repository.getTransactions();
    return this.fifoCalculator.calculate(txs).lots;
  }

  private buildFifoPositions(transactions: TransactionInput[], lots: FifoLot[]): Record<string, PortfolioPosition> {
    const balances = new Map<string, number>();
    const pendingAssets = this.findAssetsWithIncompleteAcquisitionCost(transactions);
    const assets = new Set<string>();

    for (const tx of transactions) {
      for (const leg of tx.legs) {
        assets.add(leg.assetId);
        balances.set(leg.assetId, (balances.get(leg.assetId) ?? 0) + leg.amount);
      }
    }

    for (const lot of lots) assets.add(lot.assetId);

    const positions: Record<string, PortfolioPosition> = {};
    for (const assetId of assets) {
      const balance = balances.get(assetId) ?? 0;
      positions[assetId] = this.createPositionFromLots(assetId, balance, lots, pendingAssets.has(assetId));
    }

    return positions;
  }

  private findAssetsWithIncompleteAcquisitionCost(transactions: TransactionInput[]): Set<string> {
    const pending = new Set<string>();

    for (const tx of transactions) {
      for (const leg of tx.legs) {
        if (leg.amount <= 0) continue;
        if (tx.type === "transfer_out") continue;

        const lacksValuation = leg.valuationEur === undefined || leg.valuationStatus === "pending";
        if (lacksValuation) pending.add(leg.assetId);
      }
    }

    return pending;
  }

  private applyLiveBalance(
    positions: Record<string, PortfolioPosition>,
    assetId: string,
    liveBalance: number,
    lots: FifoLot[]
  ): void {
    const existingPending = positions[assetId]?.hasPendingValuation ?? false;
    positions[assetId] = this.createPositionFromLots(assetId, liveBalance, lots, existingPending);
  }

  private createPositionFromLots(
    assetId: string,
    balance: number,
    allLots: FifoLot[],
    hasIncompleteAcquisition: boolean
  ): PortfolioPosition {
    const lots = allLots
      .filter((lot) => lot.assetId === assetId && lot.remainingAmount > 0)
      .sort((a, b) => a.date - b.date);
    const openAmount = lots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
    const costForVisibleBalance = this.costForQuantity(lots, Math.max(0, Math.min(balance, openAmount)));
    const tolerance = Math.max(1e-8, Math.abs(balance) * 1e-6);
    const hasBalanceMismatch = balance > tolerance && Math.abs(balance - openAmount) > tolerance;
    const hasPendingValuation = hasIncompleteAcquisition || hasBalanceMismatch;
    const totalInvestedEur = balance > 0 ? costForVisibleBalance : 0;

    return {
      assetId,
      balance,
      totalInvestedEur,
      averagePriceEur: !hasPendingValuation && balance > 0 ? totalInvestedEur / balance : null,
      hasPendingValuation
    };
  }

  private costForQuantity(lots: FifoLot[], quantity: number): number {
    let remaining = quantity;
    let cost = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const amount = Math.min(lot.remainingAmount, remaining);
      cost += amount * lot.unitAcquisitionPriceEur;
      remaining -= amount;
    }

    return cost;
  }
}
