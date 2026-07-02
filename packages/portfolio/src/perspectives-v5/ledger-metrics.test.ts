import { describe, expect, it } from "vitest";
import { runPerspectivesV5Simulation } from "./simulation";
import type { PerspectivesSimulationInput } from "./domain/types";

const START = Date.UTC(2026, 0, 15);
const MONTHS = Array.from({ length: 12 }, (_, index) => Date.UTC(2026, index + 1, 1));

function input(prices: number[]): PerspectivesSimulationInput {
  return {
    now: START,
    horizonDate: MONTHS[MONTHS.length - 1],
    scenario: "base",
    strategyMode: "PASSIVE",
    path: {
      pathId: "ledger-metrics-path",
      scenarioBand: "base",
      points: MONTHS.map((date, index) => {
        const d = new Date(date);
        return {
          assetId: "BTC",
          month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
          pathId: "ledger-metrics-path",
          priceEur: prices[index],
          regime: index < 4 ? "ACCUMULATION" : index < 8 ? "BULL_EXPANSION" : "CORRECTION",
          coverage: "MODEL_CALIBRATED",
          provider: "test",
          generatedAt: START,
          confidence: 1,
        };
      }),
    },
    sources: [{
      id: "source-test",
      name: "Test source",
      category: "market",
      status: "ACTIVE_IN_ENGINE",
      publisher: "Test Publisher",
      originalUrl: "https://example.invalid/report",
      publishedAt: START,
      retrievedAt: START,
      expiresAt: Date.UTC(2027, 0, 1),
      assetIds: ["BTC"],
      independentPublicationId: "source-test",
      reliability: 1,
      usedInEngine: true,
    }],
    initialPositions: [],
    monthlyContributions: MONTHS.map((date, index) => ({
      id: `contribution-${index}`,
      date,
      assetId: "BTC",
      amountEur: 100,
    })),
    initialOperatingEurcEur: 0,
    initialFiscalReserveEur: 0,
    initialCashEur: 0,
    historicalExternalCapitalEur: 0,
    commissionRate: 0,
    taxBands: [{ upToEur: null, rate: 0.2 }],
  };
}

describe("Perspectives V5 ledger, continuity and returns", () => {
  function expectMonthlyLedgerToReconcile(result: ReturnType<typeof runPerspectivesV5Simulation>): void {
    for (let index = 0; index < result.monthlySnapshots.length; index += 1) {
      const snapshot = result.monthlySnapshots[index];
      expect(Math.abs(snapshot.reconciliationDiffEur)).toBeLessThanOrEqual(0.01);
      if (index > 0) {
        expect(snapshot.openingNetWealthEur).toBeCloseTo(result.monthlySnapshots[index - 1].closingNetWealthEur, 6);
      }
      const expectedClosing =
        snapshot.openingNetWealthEur +
        snapshot.externalContributionsThisMonthEur +
        snapshot.marketResultThisMonthEur -
        snapshot.costsThisMonthEur -
        snapshot.taxesPaidThisMonthEur -
        snapshot.externalWithdrawalsThisMonthEur;
      expect(snapshot.closingNetWealthEur).toBeCloseTo(expectedClosing, 6);
    }
  }

  it("keeps market profit at zero when price is constant", () => {
    const result = runPerspectivesV5Simulation(input(Array(12).fill(10)));

    expect(result.externalCapitalEur).toBeCloseTo(1_200, 6);
    expect(result.finalNetWealthEur).toBeCloseTo(1_200, 6);
    expect(result.netProfitEur).toBeCloseTo(0, 6);
    expect(result.unrealizedGainEur).toBeCloseTo(0, 6);
    expect(result.validationErrors).toEqual([]);
    expect(result.lots).toHaveLength(12);
    expect(result.lots.reduce((sum, lot) => sum + lot.unitsOpen, 0)).toBeCloseTo(120, 6);
    expectMonthlyLedgerToReconcile(result);
  });

  it("creates units that appreciate when prices rise", () => {
    const result = runPerspectivesV5Simulation(input([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]));

    expect(result.externalCapitalEur).toBeCloseTo(1_200, 6);
    expect(result.finalNetWealthEur).toBeGreaterThan(1_200);
    expect(result.netProfitEur).toBeGreaterThan(0);
    expect(result.unrealizedGainEur).toBeGreaterThan(0);
    expect(result.twrCumulative).not.toBeNull();
    expect(result.xirr).not.toBeNull();
    const firstLot = result.lots[0];
    const lastLot = result.lots[result.lots.length - 1];
    expect(firstLot.unitsOpen * 21 - firstLot.costBasisEur).toBeGreaterThan(lastLot.unitsOpen * 21 - lastLot.costBasisEur);
    expectMonthlyLedgerToReconcile(result);
  });

  it("keeps acquired units while showing a loss when prices fall", () => {
    const result = runPerspectivesV5Simulation(input([21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]));

    expect(result.externalCapitalEur).toBeCloseTo(1_200, 6);
    expect(result.finalNetWealthEur).toBeLessThan(1_200);
    expect(result.netProfitEur).toBeLessThan(0);
    expect(result.unrealizedGainEur).toBeLessThan(0);
    expect(result.lots).toHaveLength(12);
    expect(result.lots.every((lot) => lot.unitsOpen > 0)).toBe(true);
    expectMonthlyLedgerToReconcile(result);
  });
});
