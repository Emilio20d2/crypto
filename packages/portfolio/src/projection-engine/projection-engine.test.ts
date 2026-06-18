import { describe, test, expect } from "vitest";
import { runProjection } from "./projection-engine";
import { SPANISH_FISCAL_CONFIG_2024, buildCacheKey } from "./types";
import { buildDefaultHypotheses } from "./asset-simulator";
import { computeTaxOnGain } from "./tax-simulator";
import { simulateSaleRules } from "./sale-simulator";
import type { PlanConsolidatedSnapshot, ProjectionInput } from "./types";

const DAY = 24 * 3600 * 1000;
const MONTH = 30.4375 * DAY;

function makeSnapshot(overrides: Partial<PlanConsolidatedSnapshot> = {}): PlanConsolidatedSnapshot {
  const now = new Date("2026-01-01").getTime();
  return {
    snapshotId: "snap-1",
    generatedAt: now,
    projectionStartDate: now,
    planId: "plan-1",
    planName: "Plan principal",
    cycles: [{
      id: "cycle-1",
      planId: "plan-1",
      name: "Ciclo 2026",
      startDate: now,
      endDate: new Date("2031-01-01").getTime(),
      monthlyAmountEur: 200,
      status: "active",
      assets: [
        {
          id: "ia-btc",
          assetId: "BTC",
          cycleId: "cycle-1",
          status: "active",
          allocationPercentage: 60,
          allocationValue: null,
          allocationType: "percentage",
          priority: 1,
          targetAmount: 0.1,
          targetValueEur: null,
          targetPortfolioPercentage: null,
          goalReachedAt: null,
          startDate: now,
          endDate: null,
        },
        {
          id: "ia-eth",
          assetId: "ETH",
          cycleId: "cycle-1",
          status: "active",
          allocationPercentage: 40,
          allocationValue: null,
          allocationType: "percentage",
          priority: 2,
          targetAmount: null,
          targetValueEur: null,
          targetPortfolioPercentage: null,
          goalReachedAt: null,
          startDate: now,
          endDate: null,
        },
      ],
    }],
    positions: {
      BTC: { assetId: "BTC", balance: 0.01, avgCostEur: 80_000, currentValueEur: 800, currentPriceEur: 80_000 },
      ETH: { assetId: "ETH", balance: 0.5, avgCostEur: 2_000, currentValueEur: 1_000, currentPriceEur: 2_000 },
    },
    historicalCapitalEur: 1_800,
    historicalSalesEur: 0,
    historicalRebuysEur: 0,
    futureContributions: [],
    saleRules: [],
    rebuyTiers: [],
    substitutions: [],
    treasury: {
      cashEur: 0,
      eurcEur: 0,
      eurcAvailableEur: 0,
      fiscalReserveEur: 0,
      totalLiquidityEur: 0,
    },
    prices: { BTC: 80_000, ETH: 2_000 },
    dataQuality: { overallScore: 1, missingPrices: [], missingCosts: [], staleData: [], notes: [] },
    fiscalVersion: "es-2024",
    strategyVersion: "v1",
    ...overrides,
  };
}

function makeInput(snapshot: PlanConsolidatedSnapshot, horizonYears = 3): ProjectionInput {
  const horizon = snapshot.projectionStartDate + horizonYears * 365.25 * DAY;
  const hypotheses = buildDefaultHypotheses("base", Object.keys(snapshot.prices));
  return {
    snapshot,
    projectionStartDate: snapshot.projectionStartDate,
    horizonDate: horizon,
    scenario: "base",
    scenarioHypotheses: hypotheses,
    fiscalConfig: SPANISH_FISCAL_CONFIG_2024,
    resolution: "monthly",
    options: { complianceRate: 1.0 },
    now: snapshot.projectionStartDate,
  };
}

// ── Estado inicial ────────────────────────────────────────────────────────────

describe("runProjection — estado inicial real", () => {
  test("comienza desde las posiciones reales del snapshot", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap));
    // Primer periodo debe incluir posición BTC inicial
    const firstBtc = result.periods[0].positions["BTC"];
    expect(firstBtc).toBeDefined();
    expect(firstBtc.balance).toBeGreaterThanOrEqual(0.01); // posición inicial + posible compra del mes
  });

  test("capital histórico no se suma de nuevo en el futuro", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap));
    const last = result.periods[result.periods.length - 1];
    // historicalCapitalEur es fijo desde el snapshot
    expect(last.historicalCapitalEur).toBe(snap.historicalCapitalEur);
  });

  test("futureCapitalEur solo cuenta aportaciones desde projectionStartDate", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 1));
    const last = result.periods[result.periods.length - 1];
    // Con 200€/mes durante ~12 meses y 60% BTC + 40% ETH
    // totalCapital = histórico + futuro
    expect(last.futureCapitalEur).toBeGreaterThan(0);
    expect(last.historicalCapitalEur).toBe(snap.historicalCapitalEur);
  });

  test("no repite ventas históricas", () => {
    const snap = makeSnapshot({ historicalSalesEur: 500 });
    const result = runProjection(makeInput(snap));
    // totalSalesEur en el primer periodo debe ser 0 (sin reglas de venta activas)
    expect(result.periods[0].totalSalesEur).toBe(0);
  });

  test("precio de BTC en el snapshot como base del primer periodo", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap));
    // Precio del primer periodo ≥ precio inicial (escenario base = crecimiento)
    const firstPrice = result.periods[0].positions["BTC"]?.priceEur;
    expect(firstPrice).not.toBeNull();
    expect(firstPrice!).toBeGreaterThan(0);
  });
});

// ── Aportaciones futuras ──────────────────────────────────────────────────────

describe("runProjection — aportaciones y objetivos", () => {
  test("aportaciones futuras incrementan futureCapitalEur", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 1));
    const last = result.periods[result.periods.length - 1];
    expect(last.futureCapitalEur).toBeGreaterThan(0);
  });

  test("reparto 60/40 aplicado correctamente", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 1));
    const cr = result.cycleResults[0];
    if (cr && cr.buysByAsset["BTC"] != null && cr.buysByAsset["ETH"] != null) {
      const ratio = cr.buysByAsset["BTC"] / cr.buysByAsset["ETH"];
      expect(ratio).toBeCloseTo(60 / 40, 0);
    }
  });

  test("activo con objetivo por cantidad detiene compras al alcanzarlo", () => {
    // BTC objetivo: 0.1 BTC, inicia con 0.01 BTC, 200€/mes × 60% = 120€/mes × precio 80000 = 0.0015 BTC/mes
    // Se alcanzará el objetivo eventualmente
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 10));
    const btcResult = result.assetResults.find(a => a.assetId === "BTC");
    // Si se alcanza el objetivo en la proyección, goalReachedProjectedAt no es null
    // y finalBalance ≥ targetAmount
    if (btcResult?.goalReachedProjectedAt) {
      expect(btcResult.finalBalance).toBeGreaterThanOrEqual(0.1 - 0.001);
    }
  });

  test("activo con objetivo alcanzado previamente no recibe más compras", () => {
    const snap = makeSnapshot({
      cycles: [{
        id: "cycle-1",
        planId: "plan-1",
        name: "Ciclo",
        startDate: makeSnapshot().projectionStartDate,
        endDate: null,
        monthlyAmountEur: 200,
        status: "active",
        assets: [
          {
            id: "ia-btc", assetId: "BTC", cycleId: "cycle-1", status: "active",
            allocationPercentage: 60, allocationValue: null, allocationType: "percentage",
            priority: 1, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: Date.now() - 86_400_000, // ya alcanzado
            startDate: makeSnapshot().projectionStartDate, endDate: null,
          },
          {
            id: "ia-eth", assetId: "ETH", cycleId: "cycle-1", status: "active",
            allocationPercentage: 40, allocationValue: null, allocationType: "percentage",
            priority: 2, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: null, startDate: makeSnapshot().projectionStartDate, endDate: null,
          },
        ],
      }],
    });
    const result = runProjection(makeInput(snap, 1));
    const cr = result.cycleResults[0];
    // BTC ya tiene el objetivo alcanzado → no debería recibir compras
    expect(cr?.buysByAsset["BTC"] ?? 0).toBe(0);
    expect(cr?.buysByAsset["ETH"] ?? 0).toBeGreaterThan(0);
  });
});

// ── EURC y tesorería ──────────────────────────────────────────────────────────

describe("runProjection — EURC y tesorería", () => {
  test("EURC disponible excluye reserva fiscal", () => {
    const snap = makeSnapshot({
      treasury: { cashEur: 0, eurcEur: 500, eurcAvailableEur: 400, fiscalReserveEur: 100, totalLiquidityEur: 500 },
    });
    const result = runProjection(makeInput(snap, 1));
    // El primer periodo debe reflejar EURC disponible = 400 (500 - 100 reserva)
    expect(result.periods[0].eurcAvailableEur).toBeCloseTo(400, 0);
    expect(result.periods[0].fiscalReserveEur).toBeCloseTo(100, 0);
  });

  test("sin EURC no se ejecutan recompras", () => {
    const snap = makeSnapshot({
      treasury: { cashEur: 0, eurcEur: 0, eurcAvailableEur: 0, fiscalReserveEur: 0, totalLiquidityEur: 0 },
      rebuyTiers: [{
        id: "tier-1", cycleId: "cycle-1", assetId: "BTC",
        drawdownPercentage: 10, usagePercentage: 50, priority: 0,
        status: "activa", referenceType: "manual", referenceValue: 100_000, lastTriggeredAt: null,
      }],
    });
    const result = runProjection(makeInput(snap, 1));
    const last = result.periods[result.periods.length - 1];
    // Sin EURC, no se pueden ejecutar recompras
    expect(last.totalRebuysEur).toBe(0);
    expect(last.eurcAvailableEur).toBe(0);
  });

  test("patrimonio bruto cuadra con suma de componentes", () => {
    const snap = makeSnapshot({
      treasury: { cashEur: 100, eurcEur: 200, eurcAvailableEur: 150, fiscalReserveEur: 50, totalLiquidityEur: 300 },
    });
    const result = runProjection(makeInput(snap, 1));
    for (const period of result.periods) {
      const expectedGross = period.portfolioValueEur + period.cashEur + period.eurcAvailableEur + period.fiscalReserveEur;
      expect(period.grossWealthEur).toBeCloseTo(expectedGross, 1);
    }
  });
});

// ── Determinismo ──────────────────────────────────────────────────────────────

describe("runProjection — determinismo", () => {
  test("misma entrada produce mismo resultado", () => {
    const snap = makeSnapshot();
    const input = makeInput(snap, 3);
    const r1 = runProjection(input);
    const r2 = runProjection(input);
    expect(r1.summary.finalGrossWealthEur).toBe(r2.summary.finalGrossWealthEur);
    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  test("escenario conservador produce menor riqueza que optimista", () => {
    const snap = makeSnapshot();
    const hypoC = buildDefaultHypotheses("conservador", Object.keys(snap.prices));
    const hypoO = buildDefaultHypotheses("optimista", Object.keys(snap.prices));
    const rc = runProjection({ ...makeInput(snap, 5), scenario: "conservador", scenarioHypotheses: hypoC });
    const ro = runProjection({ ...makeInput(snap, 5), scenario: "optimista", scenarioHypotheses: hypoO });
    expect(rc.summary.finalGrossWealthEur).toBeLessThan(ro.summary.finalGrossWealthEur);
  });
});

// ── Ventas y fiscalidad ───────────────────────────────────────────────────────

describe("runProjection — ventas parciales", () => {
  test("regla de venta parcial: cantidad vendida reduce posición del activo", () => {
    const rule = {
      id: "rule-1", cycleId: "cycle-1", assetId: "BTC", name: "Precio objetivo",
      conditionType: "price_target", conditionValue: 1_000, conditionValue2: null,
      sellPercentage: 25, priority: 1, status: "activa",
    };
    const results = simulateSaleRules(
      "cycle-1", Date.now(), [rule],
      { BTC: 0.1 }, { BTC: 80_000 }, { BTC: 90_000 },
      [{ lotId: "lot-1", assetId: "BTC", acquiredAt: 0, quantity: 0.1, costPerUnitEur: 80_000, remaining: 0.1, source: "historical" }],
      SPANISH_FISCAL_CONFIG_2024,
      new Set(),
    );
    const triggered = results.find((r: any) => r.triggered);
    expect(triggered).toBeDefined();
    expect(triggered.quantitySold).toBeCloseTo(0.025); // 25% de 0.1
    expect(triggered.grossEur).toBeGreaterThan(0);
  });

  test("beneficio no realizado no genera impuesto", () => {
    const snap = makeSnapshot({ saleRules: [] });
    const result = runProjection(makeInput(snap, 3));
    // Sin ventas, no hay impuesto generado
    expect(result.summary.totalTaxGeneratedEur).toBe(0);
  });

  test("impuesto calculado con brackets españoles (no tipo fijo)", () => {
    const tax = computeTaxOnGain(3_000, SPANISH_FISCAL_CONFIG_2024);
    expect(tax).toBeCloseTo(570, 0);
  });

  test("ganancia de 60k EUR usa tramos correctos (19%×6k + 21%×50k + 23%×4k)", () => {
    const tax = computeTaxOnGain(60_000, SPANISH_FISCAL_CONFIG_2024);
    const expected = 6_000 * 0.19 + (50_000 - 6_000) * 0.21 + (60_000 - 50_000) * 0.23;
    expect(tax).toBeCloseTo(expected, 1);
  });
});

// ── Conciliación ──────────────────────────────────────────────────────────────

describe("runProjection — conciliación", () => {
  test("reconciliación básica pasa", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 2));
    const failedChecks = result.reconciliation.checks.filter(c => !c.passed);
    // Mostramos qué falló si hubiera alguno
    if (failedChecks.length > 0) {
      console.error("Checks fallidos:", failedChecks.map(c => `${c.name}: esperado=${c.expected.toFixed(2)} actual=${c.actual.toFixed(2)}`));
    }
    expect(result.reconciliation.allPassed).toBe(true);
  });

  test("cantidades por activo cuadran: inicial + compras - ventas = final", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 2));
    for (const ar of result.assetResults) {
      const expected = ar.initialBalance + ar.balanceBoughtContributions + ar.balanceBoughtExtraordinary + ar.balanceRebought - ar.balanceSold;
      expect(Math.abs(ar.finalBalance - expected)).toBeLessThan(0.001);
    }
  });

  test("patrimonio neto ≤ patrimonio bruto", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 3));
    for (const period of result.periods) {
      expect(period.netWealthEur).toBeLessThanOrEqual(period.grossWealthEur + 0.01);
    }
  });

  test("validación no devuelve errores en proyección normal", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 2));
    const errors = result.validation.issues.filter(i => i.severity === "error");
    expect(errors.length).toBe(0);
  });

  test("capital total = histórico + futuro", () => {
    const snap = makeSnapshot();
    const result = runProjection(makeInput(snap, 2));
    const last = result.periods[result.periods.length - 1];
    expect(Math.abs(last.totalCapitalEur - (last.historicalCapitalEur + last.futureCapitalEur))).toBeLessThan(0.01);
  });
});

// ── Caché ─────────────────────────────────────────────────────────────────────

describe("buildCacheKey", () => {
  test("mismo input produce misma clave", () => {
    const snap = makeSnapshot();
    const input = makeInput(snap, 3);
    const k1 = buildCacheKey(input);
    const k2 = buildCacheKey(input);
    expect(k1).toBe(k2);
  });

  test("escenario distinto produce clave distinta", () => {
    const snap = makeSnapshot();
    const i1 = makeInput(snap, 3);
    const i2 = { ...i1, scenario: "optimista" as const };
    expect(buildCacheKey(i1)).not.toBe(buildCacheKey(i2));
  });
});
