import { describe, expect, it } from "vitest";
import { runPerspectivesV5Simulation } from "./simulation";
import type { PerspectivesSimulationInput } from "./domain/types";

const START = Date.UTC(2026, 0, 15);
const FEB = Date.UTC(2026, 1, 1);
const MAR = Date.UTC(2026, 2, 1);

function input(): PerspectivesSimulationInput {
  return {
    now: START,
    horizonDate: MAR,
    scenario: "base",
    strategyMode: "PASSIVE",
    path: {
      pathId: "smoke-path-001",
      scenarioBand: "base",
      points: [
        { assetId: "BTC", month: "2026-02", pathId: "smoke-path-001", priceEur: 100_000, regime: "ACCUMULATION", coverage: "HISTORICAL", provider: "test", generatedAt: START, confidence: 1 },
        { assetId: "BTC", month: "2026-03", pathId: "smoke-path-001", priceEur: 110_000, regime: "EARLY_BULL", coverage: "MODEL_CALIBRATED", provider: "test", generatedAt: START, confidence: 0.9 },
      ],
    },
    sources: [
      {
        id: "source-test-1",
        name: "Fuente de prueba",
        category: "market",
        status: "ACTIVE_IN_ENGINE",
        publisher: "Test Publisher",
        originalUrl: "https://example.invalid/report",
        publishedAt: START,
        retrievedAt: START,
        expiresAt: Date.UTC(2027, 0, 1),
        assetIds: ["BTC"],
        independentPublicationId: "test-pub-1",
        reliability: 1,
        usedInEngine: true,
      },
    ],
    initialPositions: [
      {
        assetId: "BTC",
        lotId: "initial-btc",
        acquiredAt: Date.UTC(2025, 11, 1),
        units: 0.1,
        purchasePriceEur: 90_000,
        acquisitionCostsEur: 10,
        currentPriceEur: 100_000,
      },
    ],
    monthlyContributions: [
      { id: "contrib-feb", date: FEB, assetId: "BTC", amountEur: 100 },
      { id: "contrib-mar", date: MAR, assetId: "BTC", amountEur: 100 },
    ],
    initialOperatingEurcEur: 0,
    initialFiscalReserveEur: 0,
    initialCashEur: 0,
    historicalExternalCapitalEur: 9_010,
    commissionRate: 0.001,
    taxBands: [
      { upToEur: 6_000, rate: 0.19 },
      { upToEur: 50_000, rate: 0.21 },
      { upToEur: null, rate: 0.23 },
    ],
  };
}

describe("Perspectives V5 smoke engine", () => {
  it("runs a deterministic monthly projection without falling back to V4", () => {
    const result = runPerspectivesV5Simulation(input());

    expect(result.engineVersion).toBe("perspectives-v5");
    expect(result.monthlySnapshots).toHaveLength(2);
    expect(result.annualSnapshots).toHaveLength(1);
    expect(result.validationErrors).toEqual([]);
    expect(result.ledger.some((entry) => entry.type === "PLAN_PURCHASE")).toBe(true);
    expect(result.finalNetWealthEur).toBeGreaterThan(0);
    expect(result.pathId).toBe("smoke-path-001");
  });

  it("blocks missing prices instead of silently moving the contribution to EURC", () => {
    const broken = input();
    broken.path.points = broken.path.points.filter((point) => point.month !== "2026-03");

    expect(() => runPerspectivesV5Simulation(broken)).toThrow(/MISSING_PRICE_POINT:BTC:2026-03/);
  });
});
