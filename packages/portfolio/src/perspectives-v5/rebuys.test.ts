import { describe, expect, it } from "vitest";
import type { MarketRegime, PerspectivesSimulationInput } from "./domain/types";
import { runPerspectivesV5Simulation } from "./simulation";

const START = Date.UTC(2026, 0, 15);
const MONTHS = [
  Date.UTC(2026, 1, 1),
  Date.UTC(2026, 2, 1),
  Date.UTC(2026, 3, 1),
  Date.UTC(2026, 4, 1),
];

function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function source(id: string, category: PerspectivesSimulationInput["sources"][number]["category"]) {
  return {
    id,
    name: id,
    category,
    status: "ACTIVE_IN_ENGINE" as const,
    publisher: id,
    originalUrl: `https://example.invalid/${id}`,
    publishedAt: START,
    retrievedAt: START,
    expiresAt: Date.UTC(2027, 0, 1),
    assetIds: ["BTC"],
    independentPublicationId: id,
    reliability: 0.9,
    usedInEngine: true,
  };
}

function input(prices: number[], regimes: MarketRegime[]): PerspectivesSimulationInput {
  return {
    now: START,
    horizonDate: MONTHS[MONTHS.length - 1],
    scenario: "base",
    strategyMode: "INTELLIGENT_STRATEGY",
    path: {
      pathId: "rebuy-path",
      scenarioBand: "base",
      points: MONTHS.map((date, index) => ({
        assetId: "BTC",
        month: monthKey(date),
        pathId: "rebuy-path",
        priceEur: prices[index],
        regime: regimes[index],
        coverage: "MODEL_CALIBRATED",
        provider: "test",
        generatedAt: START,
        confidence: 0.9,
      })),
    },
    sources: [source("source-a", "market"), source("source-b", "institutional"), source("source-c", "on_chain")],
    initialPositions: [
      {
        assetId: "BTC",
        lotId: "initial-btc",
        acquiredAt: Date.UTC(2025, 0, 1),
        units: 1,
        purchasePriceEur: 10_000,
        acquisitionCostsEur: 0,
        currentPriceEur: prices[0],
      },
    ],
    monthlyContributions: [],
    initialOperatingEurcEur: 0,
    initialFiscalReserveEur: 0,
    initialCashEur: 0,
    historicalExternalCapitalEur: 10_000,
    commissionRate: 0,
    taxBands: [{ upToEur: null, rate: 0.2 }],
  };
}

describe("Perspectives V5 rebuys from recovered capital", () => {
  it("blocks rebuys when price is not below the open average cost", () => {
    const result = runPerspectivesV5Simulation(input(
      [30_000, 12_000, 12_500, 13_000],
      ["EUPHORIA", "EARLY_RECOVERY", "EARLY_RECOVERY", "BULL_EXPANSION"],
    ));

    expect(result.ledger.filter((entry) => entry.type === "PARTIAL_SALE")).toHaveLength(1);
    expect(result.ledger.filter((entry) => entry.type === "INTERNAL_REBUY")).toHaveLength(0);
    expect(result.eurcBuckets[0].availableEur).toBeCloseTo(6_500, 6);
    expect(result.lots.every((lot) => lot.fundingOrigin !== "INTERNAL_REBUY")).toBe(true);
  });

  it("creates an INTERNAL_REBUY lot that produces later unrealized profit", () => {
    const result = runPerspectivesV5Simulation(input(
      [30_000, 8_000, 14_000, 15_000],
      ["EUPHORIA", "EARLY_RECOVERY", "BULL_EXPANSION", "BULL_EXPANSION"],
    ));

    const sale = result.ledger.find((entry) => entry.type === "PARTIAL_SALE");
    const rebuy = result.ledger.find((entry) => entry.type === "INTERNAL_REBUY");
    const rebuyLot = result.lots.find((lot) => lot.fundingOrigin === "INTERNAL_REBUY");

    expect(sale).toBeDefined();
    expect(rebuy).toBeDefined();
    expect(rebuyLot).toBeDefined();
    expect(result.eurcBuckets).toHaveLength(1);
    expect(result.eurcBuckets[0].fiscalReserveEur).toBeCloseTo(1_000, 6);
    expect(result.eurcBuckets[0].consumedEur).toBeCloseTo(3_250, 6);
    expect(result.eurcBuckets[0].availableEur).toBeCloseTo(3_250, 6);
    expect(result.internalRebuyCapitalEur).toBeCloseTo(3_250, 6);
    expect(result.externalCapitalEur).toBeCloseTo(10_000, 6);

    expect(rebuyLot!.sourceEurcBucketId).toBe(result.eurcBuckets[0].id);
    expect(rebuyLot!.profitHarvestCycleId).toBe(result.profitHarvestCycles[0].id);
    expect(rebuyLot!.unitsAcquired).toBeCloseTo(0.40625, 6);
    expect(rebuyLot!.purchasePriceEur).toBeCloseTo(8_000, 6);

    const finalValue = rebuyLot!.unitsOpen * 15_000;
    expect(finalValue).toBeCloseTo(6_093.75, 6);
    expect(finalValue - rebuyLot!.costBasisEur).toBeCloseTo(2_843.75, 6);
    expect(result.finalNetWealthEur).toBeGreaterThan(result.externalCapitalEur);
    expect(result.validationErrors).toEqual([]);
  });
});
