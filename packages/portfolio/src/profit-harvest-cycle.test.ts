import { describe, expect, it } from "vitest";
import {
  addSimulatedRebuy,
  buildProfitHarvestCycle,
  calculateBreakEvenRebuyPrice,
} from "./profit-harvest-cycle";

describe("ProfitHarvestCycle", () => {
  it("separates fiscal reserve from operational EURC and computes the rebuy break-even", () => {
    const breakEven = calculateBreakEvenRebuyPrice({
      unitsSold: 1,
      sellPriceEur: 100,
      taxEur: 19,
      costsEur: 1,
    });

    expect(breakEven).toBe(80);

    const cycle = buildProfitHarvestCycle({
      id: "harvest-1",
      assetId: "BTC",
      openedAt: Date.UTC(2036, 0, 1),
      strategyMode: "INTELLIGENT_STRATEGY",
      unitsSold: 1,
      sellPriceEur: 100,
      acquisitionCostEur: 50,
      taxEur: 19,
      costsEur: 1,
      reason: "Señal estratégica simulada",
    });

    expect(cycle.simulationOnly).toBe(true);
    expect(cycle.requiresUserConfirmation).toBe(true);
    expect(cycle.eurcFiscalReserveEur).toBe(19);
    expect(cycle.eurcOperationalEur).toBe(80);
    expect(cycle.breakEvenRebuyPriceEur).toBe(80);
    expect(cycle.minimumDropPct).toBeCloseTo(20);
    expect(cycle.targetZone.maxPriceEur).toBeLessThanOrEqual(80);
  });

  it("uses only operational EURC for rebuys and reports additional units versus hold", () => {
    const cycle = buildProfitHarvestCycle({
      id: "harvest-2",
      assetId: "ETH",
      openedAt: Date.UTC(2036, 3, 1),
      strategyMode: "HYBRID",
      unitsSold: 2,
      sellPriceEur: 100,
      acquisitionCostEur: 120,
      taxEur: 15,
      costsEur: 5,
      reason: "Venta parcial híbrida",
    });

    const updated = addSimulatedRebuy(cycle, {
      id: "rebuy-1",
      executedAt: Date.UTC(2036, 5, 1),
      priceEur: 60,
      eurcUsedEur: cycle.eurcOperationalEur,
      quantity: cycle.eurcOperationalEur / 60,
      costsEur: 0,
      simulated: true,
    });

    expect(updated.unitsRebought).toBeCloseTo(3);
    expect(updated.additionalUnits).toBeCloseTo(1);
    expect(updated.resultVsHoldEur).toBeCloseTo(60);
    expect(updated.eurcFiscalReserveEur).toBe(15);
    expect(updated.status).toBe("completed");
  });

  it("keeps passive mode free of automatic simulated actions", () => {
    const cycle = buildProfitHarvestCycle({
      id: "harvest-passive",
      assetId: "SUI",
      openedAt: Date.UTC(2036, 0, 1),
      strategyMode: "PASSIVE",
      unitsSold: 0,
      sellPriceEur: 0,
      acquisitionCostEur: 0,
      taxEur: 0,
      costsEur: 0,
      reason: "Sin estrategia activa",
    });

    expect(cycle.strategySource).toBe("none");
    expect(cycle.simulationOnly).toBe(true);
    expect(cycle.requiresUserConfirmation).toBe(false);
    expect(cycle.grossSaleEur).toBe(0);
    expect(cycle.eurcOperationalEur).toBe(0);
    expect(cycle.breakEvenRebuyPriceEur).toBe(0);
  });
});
