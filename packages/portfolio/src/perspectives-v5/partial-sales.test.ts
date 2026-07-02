import { describe, expect, it } from "vitest";
import type { MarketRegime, PerspectivesSimulationInput } from "./domain/types";
import { runPerspectivesV5Simulation } from "./simulation";

const START = Date.UTC(2026, 0, 15);
const MONTHS = [Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 1)];

function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function input(params: {
  purchasePriceEur: number;
  prices: number[];
  regimes: MarketRegime[];
  strategyMode?: PerspectivesSimulationInput["strategyMode"];
  commissionRate?: number;
}): PerspectivesSimulationInput {
  return {
    now: START,
    horizonDate: MONTHS[MONTHS.length - 1],
    scenario: "base",
    strategyMode: params.strategyMode ?? "INTELLIGENT_STRATEGY",
    path: {
      pathId: "partial-sale-path",
      scenarioBand: "base",
      points: MONTHS.map((date, index) => ({
        assetId: "BTC",
        month: monthKey(date),
        pathId: "partial-sale-path",
        priceEur: params.prices[index],
        regime: params.regimes[index],
        coverage: "MODEL_CALIBRATED",
        provider: "test",
        generatedAt: START,
        confidence: 0.88,
      })),
    },
    sources: [
      {
        id: "source-a",
        name: "Source A",
        category: "market",
        status: "ACTIVE_IN_ENGINE",
        publisher: "Publisher A",
        originalUrl: "https://example.invalid/a",
        publishedAt: START,
        retrievedAt: START,
        expiresAt: Date.UTC(2027, 0, 1),
        assetIds: ["BTC"],
        independentPublicationId: "source-a",
        reliability: 0.9,
        usedInEngine: true,
      },
      {
        id: "source-b",
        name: "Source B",
        category: "institutional",
        status: "ACTIVE_IN_ENGINE",
        publisher: "Publisher B",
        originalUrl: "https://example.invalid/b",
        publishedAt: START,
        retrievedAt: START,
        expiresAt: Date.UTC(2027, 0, 1),
        assetIds: ["BTC"],
        independentPublicationId: "source-b",
        reliability: 0.9,
        usedInEngine: true,
      },
      {
        id: "source-c",
        name: "Source C",
        category: "on_chain",
        status: "ACTIVE_IN_ENGINE",
        publisher: "Publisher C",
        originalUrl: "https://example.invalid/c",
        publishedAt: START,
        retrievedAt: START,
        expiresAt: Date.UTC(2027, 0, 1),
        assetIds: ["BTC"],
        independentPublicationId: "source-c",
        reliability: 0.9,
        usedInEngine: true,
      },
    ],
    initialPositions: [
      {
        assetId: "BTC",
        lotId: "initial-btc",
        acquiredAt: Date.UTC(2025, 0, 1),
        units: 1,
        purchasePriceEur: params.purchasePriceEur,
        acquisitionCostsEur: 0,
        currentPriceEur: params.prices[0],
      },
    ],
    monthlyContributions: [],
    initialOperatingEurcEur: 0,
    initialFiscalReserveEur: 0,
    initialCashEur: 0,
    historicalExternalCapitalEur: params.purchasePriceEur,
    commissionRate: params.commissionRate ?? 0,
    taxBands: [{ upToEur: null, rate: 0.2 }],
  };
}

describe("Perspectives V5 partial sales and capital recovery", () => {
  it("blocks premature sales when unrealized gain is below the recovery threshold", () => {
    const result = runPerspectivesV5Simulation(input({
      purchasePriceEur: 10_000,
      prices: [11_000, 11_500, 12_000],
      regimes: ["EUPHORIA", "DISTRIBUTION", "CORRECTION"],
    }));

    expect(result.ledger.filter((entry) => entry.type === "PARTIAL_SALE")).toHaveLength(0);
    expect(result.eurcBuckets).toHaveLength(0);
    expect(result.profitHarvestCycles).toHaveLength(0);
    expect(result.decisions.some((decision) => decision.selectedAction === "HOLD")).toBe(true);
    expect(result.decisions[0]?.selectedReason).toContain("plusvalía");
    expect(result.lots[0].unitsOpen).toBeCloseTo(1, 6);
  });

  it("executes a traced FIFO partial sale that recovers capital and creates an operating EURC bucket", () => {
    const result = runPerspectivesV5Simulation(input({
      purchasePriceEur: 10_000,
      prices: [30_000, 24_000, 22_000],
      regimes: ["EUPHORIA", "DISTRIBUTION", "CORRECTION"],
    }));

    const saleEntries = result.ledger.filter((entry) => entry.type === "PARTIAL_SALE");
    expect(saleEntries).toHaveLength(1);
    expect(saleEntries[0].assetUnits).toBeCloseTo(-0.25, 6);
    expect(saleEntries[0].grossAmountEur).toBeCloseTo(7_500, 6);
    expect(saleEntries[0].realizedGainEur).toBeCloseTo(5_000, 6);

    expect(result.lots[0].unitsOpen).toBeCloseTo(0.75, 6);
    expect(result.lots[0].unitsSold).toBeCloseTo(0.25, 6);

    expect(result.eurcBuckets).toHaveLength(1);
    expect(result.eurcBuckets[0].sourceAssetId).toBe("BTC");
    expect(result.eurcBuckets[0].soldCostBasisEur).toBeCloseTo(2_500, 6);
    expect(result.eurcBuckets[0].fiscalReserveEur).toBeCloseTo(1_000, 6);
    expect(result.eurcBuckets[0].operatingPrincipalEur).toBeCloseTo(6_500, 6);
    expect(result.eurcBuckets[0].availableEur).toBeCloseTo(6_500, 6);

    expect(result.profitHarvestCycles).toHaveLength(1);
    expect(result.profitHarvestCycles[0].capitalRecovered).toBe(true);
    expect(result.profitHarvestCycles[0].soldUnits).toBeCloseTo(0.25, 6);
    expect(result.profitHarvestCycles[0].eurcBucketId).toBe(result.eurcBuckets[0].id);
    expect(result.realizedGainEur).toBeCloseTo(5_000, 6);
    expect(result.validationErrors).toEqual([]);
  });
});
