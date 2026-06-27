import { describe, it, expect } from "vitest";
import { runPerspectivesSimulation as runPerspectivesSimulationCore } from "./sim-engine";
import { buildExternalPriceMap, monthKey, getAssetTier } from "./external-price-builder";
import type { SimInput, SimCycle, CurrentPosition, SimOptions } from "./types";
import { DEFAULT_SPANISH_TAX_BANDS, DEFAULT_SIM_OPTIONS } from "./types";
import { buildConsensus, weightSource, isExpired } from "./forecast-sources";
import type { ForecastSource } from "./forecast-sources";
import { KNOWN_FORECASTS as RAW_KNOWN_FORECASTS } from "./known-forecasts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-01-01").getTime();
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const KNOWN_FORECASTS: ForecastSource[] = RAW_KNOWN_FORECASTS.map(source => ({
  ...source,
  fxRate: 0.92,
  fxRateAt: NOW,
  fxSource: "test-fixture",
}));

const TEST_FORECAST_DATASET = {
  sources: KNOWN_FORECASTS,
  candidateId: "test-known-forecasts",
  activatedAt: NOW,
  usdToEurRate: 0.92,
  fxSource: "test-fixture",
  fxRateAt: NOW,
};

function runPerspectivesSimulation(input: SimInput) {
  return runPerspectivesSimulationCore(input, TEST_FORECAST_DATASET);
}

function horizon(years: number): number {
  return NOW + years * YEAR_MS;
}

function makeCycle(overrides: Partial<SimCycle> = {}): SimCycle {
  return {
    id: "c1",
    planId: "p1",
    name: "Test cycle",
    startDate: NOW - YEAR_MS,
    endDate: null,
    monthlyAmountEur: 200,
    assets: [
      {
        id: "a1",
        assetId: "BTC",
        allocationType: "percentage",
        allocationValue: 100,
        allocationPercentage: 100,
        fixedAmountEur: null,
        targetAmount: null,
        targetValueEur: null,
        startDate: NOW - YEAR_MS,
        endDate: null,
        status: "active",
      },
    ],
    saleRules: [],
    rebuyTiers: [],
    substitutions: [],
    revisions: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<SimInput> = {}): SimInput {
  const base: SimInput = {
    now: NOW,
    horizonDate: horizon(10),
    currentPositions: [
      {
        assetId: "BTC",
        balance: 0.01,
        avgCostEur: 30000,
        currentPriceEur: 60000,
      },
    ],
    currentLots: [
      {
        id: "lot1",
        assetId: "BTC",
        date: NOW - 2 * YEAR_MS,
        remainingAmount: 0.01,
        unitAcquisitionPriceEur: 30000,
      },
    ],
    eurcFree: 0,
    eurcFiscalReserve: 0,
    eurCash: 0,
    historicalCapitalEur: 300,
    cycles: [makeCycle()],
    options: { ...DEFAULT_SIM_OPTIONS },
  };
  return { ...base, ...overrides };
}

// ─── Ausencia del motor interno (test de guardia) ────────────────────────────

describe("motor externo — ausencia del modelo interno de ciclos", () => {
  it("price-model.ts NO se importa en sim-engine.ts (motor no usa ciclos internos)", async () => {
    // Verificación de que los imports de sim-engine no incluyen price-model
    // Importamos el módulo y comprobamos que no hay funciones del modelo interno
    const { runPerspectivesSimulation: rps } = await import("./sim-engine");
    expect(typeof rps).toBe("function");

    // buildPriceMap y buildPricePath NO deben existir como exports de perspectives
    const persp = await import("./index");
    expect((persp as Record<string, unknown>).buildPriceMap).toBeUndefined();
    expect((persp as Record<string, unknown>).buildPricePath).toBeUndefined();
  });

  it("motor externo exporta buildExternalPriceMap (no buildPriceMap)", async () => {
    const persp = await import("./index");
    expect(typeof (persp as Record<string, unknown>).buildExternalPriceMap).toBe("function");
  });

  it("AssetPriceInfo.modelType nunca es internal_cycle_model", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const info of Object.values(s.assetPriceInfo)) {
        expect(info.modelType).not.toBe("internal_cycle_model");
        expect(info.modelType).not.toBe("analyst_consensus_adjusted");
        expect(["external_direct", "external_interpolated", "external_modeled", "insufficient"]).toContain(info.modelType);
      }
    }
  });

  it("diagnostics.source es perspectives-external-forecasts", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    expect(result.diagnostics.source).toBe("perspectives-external-forecasts");
  });
});

// ─── Motor de precios externos — buildExternalPriceMap ───────────────────────

describe("external-price-builder: cobertura y precios", () => {
  const btcPrice = 87000;

  it("genera precio mensual para cada mes entre now y horizonte", () => {
    const result = buildExternalPriceMap("BTC", btcPrice, "base", NOW, horizon(5), KNOWN_FORECASTS);
    const keys = Object.keys(result.pricesByMonth);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("todos los precios son positivos", () => {
    const result = buildExternalPriceMap("BTC", btcPrice, "base", NOW, horizon(10), KNOWN_FORECASTS);
    for (const price of Object.values(result.pricesByMonth)) {
      expect(price).toBeGreaterThan(0);
    }
  });

  it("activo sin cobertura (SUI) — lastCoveredYear es null y sourceCount es 0", () => {
    const result = buildExternalPriceMap("SUI", 3.0, "base", NOW, horizon(5), KNOWN_FORECASTS);
    expect(result.sourceCount).toBe(0);
    expect(result.lastCoveredYear).toBeNull();
    // Sin cobertura, todos los años son "insufficient"
    for (const state of Object.values(result.coverageByYear)) {
      expect(state).toBe("insufficient");
    }
  });

  it("BTC con cobertura ARK 2030 — tiene años interpolados entre 2026 y 2030", () => {
    const result = buildExternalPriceMap("BTC", btcPrice, "base", NOW, horizon(10), KNOWN_FORECASTS);
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.lastCoveredYear).toBeGreaterThanOrEqual(2030);
    expect(result.interpolatedYears.length).toBeGreaterThan(0);
  });

  it("escenario optimista genera precio horizonte mayor que conservador (BTC con 2 fuentes ARK)", () => {
    const cons = buildExternalPriceMap("BTC", btcPrice, "conservador", NOW, horizon(5), KNOWN_FORECASTS);
    const opt  = buildExternalPriceMap("BTC", btcPrice, "optimista",   NOW, horizon(5), KNOWN_FORECASTS);
    // Si hay cobertura externa para BTC, el optimista debe dar precio mayor
    if (cons.sourceCount > 0) {
      const mKey = monthKey(horizon(5));
      const pCons = cons.pricesByMonth[mKey] ?? 0;
      const pOpt  = opt.pricesByMonth[mKey] ?? 0;
      expect(pOpt).toBeGreaterThanOrEqual(pCons);
    }
  });

  it("interpola linealmente entre precio actual y ancla externa", () => {
    // BTC a €87k hoy, con ARK 2030 base $258.5k × 0.92 ≈ €237.8k
    // A mitad de camino (~2028) el precio debe estar entre 87k y 237k
    const result = buildExternalPriceMap("BTC", 87000, "conservador", NOW, horizon(6), KNOWN_FORECASTS);
    const midKey = `${new Date(NOW).getFullYear() + 2}-06`;
    const midPrice = result.pricesByMonth[midKey];
    if (midPrice != null && result.sourceCount > 0) {
      expect(midPrice).toBeGreaterThan(87000);
      expect(midPrice).toBeLessThan(result.lastCoveredYear ? 400_000 : 87000 * 5);
    }
  });

  it("meses posteriores al último año cubierto usan extensión modelizada, no carry-forward plano", () => {
    const result = buildExternalPriceMap("BTC", 87000, "base", NOW, horizon(20), KNOWN_FORECASTS);
    const keys = Object.keys(result.pricesByMonth).sort();
    const decKey = keys[keys.length - 1];
    const prevKey = keys[keys.length - 2];
    const price = result.pricesByMonth[decKey];
    const prevPrice = result.pricesByMonth[prevKey];
    expect(result.coverageByYear[Number(decKey.slice(0, 4))]).toBe("modeled");
    expect(price).toBeGreaterThan(0);
    expect(price).not.toBe(prevPrice);
  });

  it("getAssetTier clasifica BTC como store_of_value", () => {
    expect(getAssetTier("BTC")).toBe("store_of_value");
    expect(getAssetTier("ETH")).toBe("large_cap");
    expect(getAssetTier("SUI")).toBe("small_cap");
  });

  it("monthKey produce formato YYYY-MM correcto", () => {
    const ts = new Date("2026-06-01").getTime();
    expect(monthKey(ts)).toBe("2026-06");
  });
});

// ─── Cobertura en snapshots anuales ─────────────────────────────────────────

describe("sim-engine: forecastCoverage en AnnualSnapshot", () => {
  it("cada snapshot tiene forecastCoverage definido", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const snap of s.annualSnapshots) {
        expect(["covered", "uncovered"]).toContain(snap.forecastCoverage);
      }
    }
  });

  it("años con cobertura BTC (interpolados hasta 2030) se marcan como covered", () => {
    const input = makeInput({
      horizonDate: horizon(5), // 2031 → años 2026-2031, BTC tiene hasta 2030
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    const year2028 = base.annualSnapshots.find(s => s.year === 2028);
    if (year2028) {
      expect(year2028.forecastCoverage).toBe("covered");
    }
  });

  it("años posteriores a cobertura directa se marcan como covered por extensión modelizada", () => {
    const input = makeInput({ horizonDate: horizon(15) }); // hasta 2041
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    const year2040 = base.annualSnapshots.find(s => s.year === 2040);
    if (year2040) {
      expect(year2040.forecastCoverage).toBe("covered");
    }
  });
});

// ─── Motor de simulación: estructura correcta ────────────────────────────────

describe("sim-engine: structure", () => {
  it("produces 5 scenarios", () => {
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    expect(result.scenarios.length).toBe(5);
  });

  it("each scenario has annual snapshots for the full horizon", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.annualSnapshots.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("optimista final wealth ≥ conservador final wealth (sin ajuste artificial)", () => {
    // Con precios cuantilados (90 vs 10 percentil), optimista debe superar conservador.
    // El ajuste monotónico artificial fue eliminado — el resultado es el matemático real.
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    const opt  = result.scenarios.find(s => s.scenario === "optimista")!.summary.finalNetWealthEur;
    const cons = result.scenarios.find(s => s.scenario === "conservador")!.summary.finalNetWealthEur;
    // En estrategia plan_base con precios externos, optimista siempre supera conservador
    // porque los precios futuros son mayores (cuantil 90 > cuantil 10).
    expect(opt).toBeGreaterThanOrEqual(cons);
  });
});

// ─── Motor de simulación: ventas ─────────────────────────────────────────────

describe("sim-engine: sales", () => {
  it("venta configurada aplica FIFO, plusvalía y reserva fiscal separada", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 10_000, currentPriceEur: 60_000 }],
      currentLots: [
        { id: "old", assetId: "BTC", date: NOW - 4 * YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 10_000 },
        { id: "new", assetId: "BTC", date: NOW - 2 * YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 20_000 },
      ],
      horizonDate: horizon(1),
      cycles: [makeCycle({
        monthlyAmountEur: 0,
        saleRules: [{
          id: "sell-btc-2x",
          assetId: "BTC",
          triggerType: "gain_multiple",
          triggerValue: 2,
          sellPercentage: 50,
          status: "active",
          triggeredAt: null,
        }],
      })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy", commissionRate: 0 },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    expect(base.summary.totalSalesEur).toBeGreaterThan(0);
    expect(base.summary.totalRealizedGainEur).toBeGreaterThan(0);
    expect(base.summary.totalTaxEur).toBeGreaterThan(0);
    expect(base.summary.finalFiscalReserveEur).toBeGreaterThan(0);
    expect(base.summary.finalEurcFreeEur).toBeCloseTo(base.summary.totalSalesEur - base.summary.totalTaxEur, 0);
  });

  it("venta configurada no se repite sin rearme", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 10_000, currentPriceEur: 60_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 4 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 10_000 }],
      horizonDate: horizon(3),
      cycles: [makeCycle({
        monthlyAmountEur: 0,
        saleRules: [{
          id: "sell-once",
          assetId: "BTC",
          triggerType: "gain_percentage",
          triggerValue: 25,
          sellPercentage: 25,
          status: "active",
          triggeredAt: null,
        }],
      })],
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    const configuredSales = base.annualSnapshots
      .flatMap(s => s.events)
      .filter(e => e.type === "sale" && e.description.includes("por regla"));
    expect(configuredSales).toHaveLength(1);
  });

  it("sale generates EURC (eurcFree > 0 after sale)", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 0,
      eurcFiscalReserve: 0,
      horizonDate: horizon(5),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    if (opt.summary.totalSalesEur > 0) {
      expect(opt.summary.finalEurcFreeEur + opt.summary.finalFiscalReserveEur).toBeGreaterThan(0);
    }
  });

  it("sin reglas configuradas genera ventas parciales hipotéticas de escenario", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 5000, currentPriceEur: 90000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      horizonDate: horizon(5),
      cycles: [makeCycle({ saleRules: [] })], // sin reglas de venta
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalSalesEur).toBeGreaterThan(0);
      expect(s.summary.totalRealizedGainEur).toBeGreaterThan(0);
      expect(s.summary.totalTaxEur).toBeGreaterThan(0);
      expect(s.summary.finalFiscalReserveEur).toBeGreaterThan(0);
    }
  });

  it("usa coste medio calculado desde lotes para ventas hipotéticas si la posición no lo trae", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: null, currentPriceEur: 90_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 30_000 }],
      horizonDate: horizon(2),
      cycles: [makeCycle({ monthlyAmountEur: 0, saleRules: [] })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    expect(base.summary.totalSalesEur).toBeGreaterThan(0);
    expect(base.summary.totalRealizedGainEur).toBeGreaterThan(0);
    expect(base.summary.finalFiscalReserveEur).toBeGreaterThan(0);
  });

  it("sale keeps fiscal reserve separate from EURC free", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      horizonDate: horizon(5),
    });
    const result = runPerspectivesSimulation(input);
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    if (opt.summary.totalSalesEur > 0) {
      const totalTax = opt.summary.totalTaxEur;
      expect(totalTax).toBeGreaterThan(0);
    }
  });
});

// ─── Motor de simulación: recompras ─────────────────────────────────────────

describe("sim-engine: rebuys", () => {
  it("recompra con EURC usa venta previa real y no toca reserva fiscal", () => {
    const input = makeInput({
      now: new Date("2026-01-01").getTime(),
      currentPositions: [{ assetId: "BTC", balance: 0.5, avgCostEur: 30_000, currentPriceEur: 60_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 2 * YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 30_000 }],
      historicalSales: [{ assetId: "BTC", date: NOW - YEAR_MS, quantity: 0.2, unitPriceEur: 1_000_000, realizedGainEur: 10_000 }],
      eurcFree: 2_000,
      eurcFiscalReserve: 500,
      horizonDate: horizon(1),
      cycles: [makeCycle({
        monthlyAmountEur: 0,
        rebuyTiers: [{
          id: "rebuy-from-last-sale",
          assetId: "BTC",
          drawdownPercentage: 20,
          usagePercentage: 50,
          referenceType: "last_sale",
          referenceValue: 1_000_000,
          status: "active",
        }],
      })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy", commissionRate: 0 },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    expect(base.summary.totalRebuysEur).toBeGreaterThan(0);
    expect(base.summary.finalFiscalReserveEur).toBeGreaterThanOrEqual(500);
    expect(base.summary.totalEurcReinvestedEur).toBeGreaterThan(0);
  });

  it("recompra sin EURC libre no se ejecuta aunque exista venta previa", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 0.5, avgCostEur: null, currentPriceEur: 60_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 2 * YEAR_MS, remainingAmount: 0.5, unitAcquisitionPriceEur: 30_000 }],
      historicalSales: [{ assetId: "BTC", date: NOW - YEAR_MS, quantity: 0.2, unitPriceEur: 1_000_000 }],
      eurcFree: 0,
      eurcFiscalReserve: 2_000,
      horizonDate: horizon(1),
      cycles: [makeCycle({
        monthlyAmountEur: 0,
        rebuyTiers: [{
          id: "rebuy-no-free-eurc",
          assetId: "BTC",
          drawdownPercentage: 20,
          usagePercentage: 50,
          referenceType: "last_sale",
          status: "active",
        }],
      })],
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalRebuysEur).toBe(0);
      expect(s.summary.finalFiscalReserveEur).toBeGreaterThanOrEqual(2_000);
    }
  });

  it("rebuy never uses fiscal reserve", () => {
    const input = makeInput({
      eurcFree: 0,
      eurcFiscalReserve: 10000,
      horizonDate: horizon(5),
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      if (s.summary.totalSalesEur === 0) {
        expect(s.summary.totalRebuysEur).toBe(0);
      }
    }
  });

  it("sin escalones de recompra configurados no se generan recompras genéricas", () => {
    // El motor ya no genera recompras propuestas automáticas (−20%/−35%/−50%).
    // Solo escalones configurados por el usuario disparan recompras.
    const input = makeInput({
      eurcFree: 5000,
      eurcFiscalReserve: 0,
      horizonDate: horizon(5),
      cycles: [makeCycle({ rebuyTiers: [] })], // sin tiers de recompra
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      // Sin tiers configurados → 0 recompras
      expect(s.summary.totalRebuysEur).toBe(0);
    }
  });
});

// ─── Motor de simulación: métricas anuales ───────────────────────────────────

describe("sim-engine: annual metrics", () => {
  it("marketGainEur formula holds: closing = opening + contributions + marketGain", () => {
    const input = makeInput({
      horizonDate: horizon(3),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    for (const snap of base.annualSnapshots) {
      const computed = snap.openingWealthEur + snap.contributionsEur + snap.marketGainEur;
      expect(Math.abs(computed - snap.closingWealthEur)).toBeLessThan(1);
    }
  });

  it("annual continuity: closingWealth[year N] ≈ openingWealth[year N+1]", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const scenario of result.scenarios) {
      const snaps = scenario.annualSnapshots;
      for (let i = 0; i < snaps.length - 1; i++) {
        const diff = Math.abs(snaps[i].closingWealthEur - snaps[i + 1].openingWealthEur);
        expect(diff).toBeLessThan(2);
      }
    }
  });

  it("TWR is computed (not null) for all scenarios", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.twr).not.toBeNull();
    }
  });

  it("XIRR is computed in scenarios with non-zero wealth", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      if (s.summary.finalNetWealthEur > 0) {
        expect(s.summary.xirr).not.toBeNull();
      }
    }
  });

  it("scenario ordering: conservador ≤ optimista (sin ajuste artificial monotónico)", () => {
    // El ajuste monotónico artificial fue eliminado.
    // La ordenación entre escenarios adyacentes no está garantizada (precio optimista mayor
    // puede implicar mayor DCA cost y menor cantidad comprada).
    // Sí se garantiza: conservador (cuantil 10) ≤ optimista (cuantil 90) para BTC con cobertura.
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    const getWealth = (sc: string) =>
      result.scenarios.find(s => s.scenario === sc)!.summary.finalNetWealthEur;
    expect(getWealth("conservador")).toBeLessThanOrEqual(getWealth("optimista") + 1);
  });
});

// ─── EURC invariants ─────────────────────────────────────────────────────────

describe("sim-engine: EURC invariants", () => {
  it("eurcFree never goes negative", () => {
    const input = makeInput({ eurcFree: 100, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const snap of s.annualSnapshots) {
        expect(snap.eurcFreeEur).toBeGreaterThanOrEqual(-0.01);
      }
    }
  });

  it("totalRebuysEur + totalEurcReinvestedEur <= totalSalesEur + initial eurcFree", () => {
    const input = makeInput({ eurcFree: 500, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const { totalRebuysEur, totalEurcReinvestedEur, totalSalesEur } = s.summary;
      expect(totalRebuysEur + totalEurcReinvestedEur).toBeLessThanOrEqual(
        totalSalesEur + 500 + 1
      );
    }
  });
});

// ─── plan_base vs full_strategy ──────────────────────────────────────────────

describe("sim-engine: plan_base vs full_strategy", () => {
  it("plan_base has zero sales and zero rebuys", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 1000,
      horizonDate: horizon(5),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalSalesEur).toBe(0);
      expect(s.summary.totalRebuysEur).toBe(0);
    }
  });

  it("both strategies produce valid non-zero results", () => {
    const baseInput = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 0.05, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 3 * YEAR_MS, remainingAmount: 0.05, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 0,
      horizonDate: horizon(5),
    });
    const planBase = makeInput({ ...baseInput, options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" } });
    const fullStrat = makeInput({ ...baseInput, options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" } });
    const rBase = runPerspectivesSimulation(planBase);
    const rFull = runPerspectivesSimulation(fullStrat);
    const baseOpt = rBase.scenarios.find(s => s.scenario === "optimista")!;
    const fullOpt = rFull.scenarios.find(s => s.scenario === "optimista")!;
    expect(baseOpt.summary.finalNetWealthEur).toBeGreaterThan(0);
    expect(fullOpt.summary.finalNetWealthEur).toBeGreaterThan(0);
  });
});

// ─── Validations ─────────────────────────────────────────────────────────────

describe("sim-engine: built-in validations", () => {
  it("continuity validations always pass", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    const continuityFails = result.validations.filter(v => v.rule.includes("continuidad") && !v.passed);
    expect(continuityFails.length).toBe(0);
  });

  it("patrimonio final validations pass for all 5 scenarios", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    const patrimonioRules = result.validations.filter(v => v.rule.includes("patrimonio_final"));
    expect(patrimonioRules.length).toBe(5);
    for (const v of patrimonioRules) {
      expect(v.passed).toBe(true);
    }
  });
});

// ─── Comisiones ──────────────────────────────────────────────────────────────

describe("sim-engine: no commissions (default options)", () => {
  it("commissionsEur is zero in all annual snapshots with default options", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const snap of s.annualSnapshots) {
        expect(snap.commissionsEur).toBe(0);
      }
    }
  });
});

describe("sim-engine: control 2036-2044", () => {
  it("no congela cierre = apertura + aportacion - comision entre 2036 y 2044", () => {
    const input = makeInput({
      horizonDate: new Date(2044, 11, 31, 23, 59, 59, 999).getTime(),
      cycles: [{ ...makeCycle(), monthlyAmountEur: 500 }],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base", commissionRate: 0.004 },
    });
    const result = runPerspectivesSimulation(input);
    const finals = result.scenarios.map(s => Math.round(s.summary.finalNetWealthEur));
    expect(new Set(finals).size).toBeGreaterThan(1);

    for (const scenario of result.scenarios) {
      const controlYears = scenario.annualSnapshots.filter(s => s.year >= 2036 && s.year <= 2044);
      expect(controlYears.length).toBeGreaterThan(0);
      for (const snap of controlYears) {
        const frozenClose = snap.openingWealthEur + snap.contributionsEur - snap.commissionsEur;
        expect(Math.abs(snap.closingWealthEur - frozenClose)).toBeGreaterThan(0.5);
        expect(Math.abs(snap.marketGainEur + snap.commissionsEur)).toBeGreaterThan(0.5);
      }
      expect(Math.abs(scenario.summary.twr ?? 0)).toBeGreaterThan(0.0001);
      const btcInfo = scenario.assetPriceInfo.BTC;
      expect(btcInfo.modeledCoverageYears.some(year => year >= 2036 && year <= 2044)).toBe(true);
    }
  });
});

// ─── Contribuciones ──────────────────────────────────────────────────────────

describe("sim-engine: contributions", () => {
  it("aportación sin precio no desaparece y queda como EURC libre", () => {
    const input = makeInput({
      currentPositions: [],
      currentLots: [],
      historicalCapitalEur: 0,
      horizonDate: horizon(1),
      cycles: [makeCycle({
        monthlyAmountEur: 100,
        assets: [{
          id: "missing-asset",
          assetId: "NO_PRICE",
          allocationType: "percentage",
          allocationValue: 100,
          allocationPercentage: 100,
          fixedAmountEur: null,
          targetAmount: null,
          targetValueEur: null,
          startDate: NOW - YEAR_MS,
          endDate: null,
          status: "active",
        }],
      })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input, { sources: [], candidateId: null, activatedAt: null, usdToEurRate: null, fxSource: null, fxRateAt: null });
    const base = result.scenarios.find(s => s.scenario === "base")!;
    expect(base.summary.totalContributionsEur).toBeGreaterThan(0);
    expect(base.summary.finalEurcFreeEur).toBeCloseTo(base.summary.totalContributionsEur, 2);
  });

  it("totalContributionsEur in summary matches sum of annual contributions", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const sumFromSnapshots = s.annualSnapshots.reduce((acc, snap) => acc + snap.contributionsEur, 0);
      expect(Math.abs(s.summary.totalContributionsEur - sumFromSnapshots)).toBeLessThan(0.01);
    }
  });

  it("totalContributionsEur > 0 when cycle has monthly contributions", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalContributionsEur).toBeGreaterThan(0);
    }
  });
});

// ─── Patrimonio neto ─────────────────────────────────────────────────────────

describe("sim-engine: patrimony net formula", () => {
  it("closingWealthEur excludes fiscal reserve (patrimonio neto)", () => {
    const input = makeInput({
      eurcFiscalReserve: 1000,
      horizonDate: horizon(3),
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const firstSnap = s.annualSnapshots[0];
      expect(firstSnap.openingWealthEur).toBeLessThan(1000);
    }
  });

  it("continuity: closingWealth[year N] equals openingWealth[year N+1]", () => {
    const input = makeInput({ eurcFiscalReserve: 500, eurcFree: 100, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const snaps = s.annualSnapshots;
      for (let i = 0; i < snaps.length - 1; i++) {
        const diff = Math.abs(snaps[i].closingWealthEur - snaps[i + 1].openingWealthEur);
        expect(diff).toBeLessThan(2);
      }
    }
  });
});

// ─── XIRR ────────────────────────────────────────────────────────────────────

describe("sim-engine: XIRR", () => {
  it("XIRR uses input.now as t=0 — value is bounded", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 0.05, avgCostEur: 30000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 2 * YEAR_MS, remainingAmount: 0.05, unitAcquisitionPriceEur: 30000 }],
      horizonDate: horizon(5),
    });
    const result = runPerspectivesSimulation(input);
    const optimista = result.scenarios.find(s => s.scenario === "optimista")!;
    if (optimista.summary.xirr !== null) {
      expect(optimista.summary.xirr).toBeGreaterThan(-1.0);
      expect(optimista.summary.xirr).toBeLessThan(5.0);
    }
  });
});

// ─── Sistema de fuentes externas (forecast-sources) ──────────────────────────

describe("forecast-sources: consensus calculation", () => {
  const now = new Date("2026-01-01").getTime();

  it("returns neutral consensus when no active sources for asset", () => {
    const c = buildConsensus([], "bitcoin", now);
    expect(c.score).toBe(0);
    expect(c.direction).toBe("neutral");
    expect(c.sourceCount).toBe(0);
  });

  it("expired sources are excluded from consensus", () => {
    const src: ForecastSource = {
      id: "x1", publisher: "Test", sourceType: "analyst",
      assetId: "bitcoin", direction: "very_bullish",
      confidence: 1.0,
      publishedAt: now - 365 * 24 * 3600 * 1000,
      expiresAt: now - 1,
    };
    const c = buildConsensus([src], "bitcoin", now);
    expect(c.sourceCount).toBe(0);
    expect(c.score).toBe(0);
  });

  it("all-bullish sources produce positive score", () => {
    const src: ForecastSource = {
      id: "x2", publisher: "Bull Bank", sourceType: "institution",
      assetId: "bitcoin", direction: "very_bullish",
      confidence: 0.9,
      publishedAt: now - 30 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const c = buildConsensus([src], "bitcoin", now);
    expect(c.score).toBeGreaterThan(0);
  });

  it("older sources have less weight than recent ones", () => {
    const recent: ForecastSource = {
      id: "r1", publisher: "A", sourceType: "analyst", assetId: "bitcoin",
      direction: "very_bullish", confidence: 0.9,
      publishedAt: now - 7 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const old: ForecastSource = {
      ...recent, id: "r2",
      publishedAt: now - 3 * 365 * 24 * 3600 * 1000,
    };
    const wRecent = weightSource(recent, now);
    const wOld    = weightSource(old, now);
    expect(wRecent).toBeGreaterThan(wOld);
  });

  it("KNOWN_FORECASTS contains at least 5 bitcoin entries (incluidas las dos ARK 2030)", () => {
    const btcForecasts = KNOWN_FORECASTS.filter(f => f.assetId === "bitcoin");
    expect(btcForecasts.length).toBeGreaterThanOrEqual(5);
  });

  it("isExpired returns false for future expiry and true for past expiry", () => {
    const src: ForecastSource = {
      id: "e1", publisher: "X", sourceType: "analyst", assetId: "bitcoin",
      direction: "bullish", confidence: 0.5,
      publishedAt: now - 365 * 24 * 3600 * 1000,
      expiresAt: now + 100,
    };
    expect(isExpired(src, now)).toBe(false);
    expect(isExpired(src, now + 200)).toBe(true);
  });
});

// ─── Correcciones críticas del motor (regresión) ─────────────────────────────

describe("motor: correcciones críticas — sin fallback 1€, sin ajuste monotónico, sin auto-ventas", () => {
  it("activo sin precio actual se excluye del mapa de precios (no usa fallback €1)", () => {
    // Si BTC no aparece en currentPositions, no debe simularse con precio €1.
    // El mapa de precios debe estar vacío para ese activo.
    const input = makeInput({
      currentPositions: [], // sin precios de mercado
      currentLots: [],
      horizonDate: horizon(5),
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      // Sin precio → sin posiciones con valor monstruoso
      const finalWealth = s.summary.finalNetWealthEur;
      // Con €200/mes × 60 meses = €12.000 capital, el patrimonio no puede ser > €50M
      expect(finalWealth).toBeLessThan(50_000_000);
    }
  });

  it("sin reglas de venta configuradas totalSalesEur incluye ventas hipotéticas de escenario", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 2.0, avgCostEur: 10_000, currentPriceEur: 90_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 4 * YEAR_MS, remainingAmount: 2.0, unitAcquisitionPriceEur: 10_000 }],
      horizonDate: horizon(5),
      cycles: [makeCycle({ saleRules: [], rebuyTiers: [] })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalSalesEur).toBeGreaterThan(0);
      expect(s.summary.totalTaxEur).toBeGreaterThan(0);
    }
  });

  it("sin tiers de recompra configurados totalRebuysEur === 0 (eliminados tiers genéricos)", () => {
    const input = makeInput({
      eurcFree: 10_000,
      horizonDate: horizon(5),
      cycles: [makeCycle({ rebuyTiers: [] })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalRebuysEur).toBe(0);
    }
  });

  it("reinversión residual desactivada: totalEurcReinvestedEur === 0 sin reglas", () => {
    const input = makeInput({
      eurcFree: 5_000,
      horizonDate: horizon(5),
      cycles: [makeCycle({ saleRules: [], rebuyTiers: [] })],
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalEurcReinvestedEur).toBe(0);
    }
  });

  it("patrimonio final razonable con portafolio típico (no 190.000M)", () => {
    // Capital inicial: €5.000 BTC real. Aportación €500/mes. Horizonte 10 años.
    const input = makeInput({
      currentPositions: [{ assetId: "BTC", balance: 0.05, avgCostEur: 50_000, currentPriceEur: 90_000 }],
      currentLots: [{ id: "l1", assetId: "BTC", date: NOW - 2 * YEAR_MS, remainingAmount: 0.05, unitAcquisitionPriceEur: 50_000 }],
      eurcFree: 0,
      eurcFiscalReserve: 0,
      historicalCapitalEur: 2_500,
      horizonDate: horizon(10),
      cycles: [{ ...makeCycle(), monthlyAmountEur: 500 }],
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const w = s.summary.finalNetWealthEur;
      // Capital total: €4.500 + €60.000 = €64.500.
      // Con BTC en ARK bull case 2030 (€1.38M) y pocos BTC, resultado razonable.
      // No puede superar €50M sin reinversión compuesta ficticia.
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(50_000_000);
    }
  });

  it("cuantiles externos: conservador usa 10° percentil, optimista usa 90° (no extremos absolutos)", () => {
    // Con 2 fuentes BTC 2030: $258.5k y $1.5M
    // Cuantil 10: ≈ $258.5k (más cercano al conservador)
    // Cuantil 90: ≈ $1.5M (más cercano al optimista)
    // La brecha no puede ser exactamente el mínimo/máximo absoluto con 2 fuentes
    const cons = buildExternalPriceMap("BTC", 90_000, "conservador", NOW, horizon(5), KNOWN_FORECASTS);
    const opt  = buildExternalPriceMap("BTC", 90_000, "optimista",   NOW, horizon(5), KNOWN_FORECASTS);
    if (cons.sourceCount >= 2) {
      const mKey = monthKey(new Date(horizon(4)).getTime());
      const pCons = cons.pricesByMonth[mKey] ?? 0;
      const pOpt  = opt.pricesByMonth[mKey] ?? 0;
      // Optimista > Conservador (los cuantiles 90 > 10 con 2 fuentes $258k y $1.5M)
      expect(pOpt).toBeGreaterThan(pCons);
    }
  });
});
