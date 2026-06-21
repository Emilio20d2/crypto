import { describe, expect, test } from "vitest";
import { PortfolioCalculator } from "./calculator";
import { FifoCalculator, type FifoLot, type LotConsumption } from "./fifo";
import type { PortfolioRepository } from "./repository";
import type { RealizedGain } from "./schemas";
import { PortfolioService, type PriceProvider } from "./service";
import type { TransactionInput } from "./types";

function makeRepository(transactions: TransactionInput[], balances: Record<string, number> = {}): PortfolioRepository {
  return {
    async getTransactions() {
      return transactions;
    },
    async saveFifoResults(_lots: FifoLot[], _consumptions: LotConsumption[], _realizedGains: RealizedGain[]) {
      return undefined;
    },
    async getAccountBalances() {
      return balances;
    }
  };
}

function makeService(transactions: TransactionInput[], balances: Record<string, number> = {}) {
  const priceProvider: PriceProvider = {
    async getCurrentPriceEur(assetId: string) {
      const prices: Record<string, number> = { ADA: 1, BTC: 50_000, ETH: 3_000 };
      return { price: prices[assetId] ?? null, state: prices[assetId] ? "live" : "unavailable", fetchedAt: Date.now() };
    }
  };

  return new PortfolioService(
    makeRepository(transactions, balances),
    new PortfolioCalculator(),
    new FifoCalculator(),
    priceProvider
  );
}

describe("PortfolioService FIFO cost basis", () => {
  test("uses acquisition value including fees as current invested cost", async () => {
    const service = makeService([
      {
        id: "buy-ada",
        type: "buy",
        date: 1,
        legs: [{ assetId: "ADA", amount: 100, legType: "destination", valuationEur: 102 }]
      }
    ], { ADA: 100 });

    const result = await service.getPositions();

    expect(result.positions.ADA.totalInvestedEur).toBe(102);
    expect(result.positions.ADA.averagePriceEur).toBe(1.02);
    expect(result.positions.ADA.hasPendingValuation).toBe(false);
  });

  test("keeps remaining cost from FIFO open lots after a partial sale", async () => {
    const service = makeService([
      {
        id: "buy-1",
        type: "buy",
        date: 1,
        legs: [{ assetId: "ADA", amount: 10, legType: "destination", valuationEur: 10 }]
      },
      {
        id: "buy-2",
        type: "buy",
        date: 2,
        legs: [{ assetId: "ADA", amount: 10, legType: "destination", valuationEur: 20 }]
      },
      {
        id: "sell-1",
        type: "sell",
        date: 3,
        legs: [{ assetId: "ADA", amount: -5, legType: "source", valuationEur: 8 }]
      }
    ], { ADA: 15 });

    const result = await service.getPositions();

    expect(result.positions.ADA.balance).toBe(15);
    expect(result.positions.ADA.totalInvestedEur).toBe(25);
    expect(result.positions.ADA.averagePriceEur).toBeCloseTo(25 / 15);
    expect(result.realizedGains[0]).toMatchObject({
      assetId: "ADA",
      amountSold: 5,
      sellValueEur: 8,
      costBasisEur: 5,
      realizedGainEur: 3
    });
  });

  test("treats crypto conversion as source disposal and destination acquisition lot", async () => {
    const service = makeService([
      {
        id: "buy-ada",
        type: "buy",
        date: 1,
        legs: [{ assetId: "ADA", amount: 10, legType: "destination", valuationEur: 10 }]
      },
      {
        id: "convert-ada-btc",
        type: "convert",
        date: 2,
        legs: [
          { assetId: "ADA", amount: -4, legType: "source", valuationEur: 8 },
          { assetId: "BTC", amount: 0.0001, legType: "destination", valuationEur: 8 }
        ]
      }
    ], { ADA: 6, BTC: 0.0001 });

    const result = await service.getPositions();

    expect(result.positions.ADA.totalInvestedEur).toBe(6);
    expect(result.positions.BTC.totalInvestedEur).toBe(8);
    expect(result.realizedGains[0]).toMatchObject({
      assetId: "ADA",
      amountSold: 4,
      sellValueEur: 8,
      costBasisEur: 4,
      realizedGainEur: 4
    });
  });

  test("marks cost as pending when Coinbase balance is not covered by FIFO lots", async () => {
    const service = makeService([
      {
        id: "buy-ada",
        type: "buy",
        date: 1,
        legs: [{ assetId: "ADA", amount: 10, legType: "destination", valuationEur: 10 }]
      }
    ], { ADA: 12 });

    const result = await service.getPositions();

    expect(result.positions.ADA.balance).toBe(12);
    expect(result.positions.ADA.averagePriceEur).toBeNull();
    expect(result.positions.ADA.hasPendingValuation).toBe(true);
  });
});
