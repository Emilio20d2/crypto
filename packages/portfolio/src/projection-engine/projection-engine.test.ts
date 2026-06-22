import { describe, test, expect } from "vitest";
import { runProjection } from "./projection-engine";
import { SPANISH_FISCAL_CONFIG_2024, buildCacheKey } from "./types";
import { buildDefaultHypotheses } from "./asset-simulator";
import { computeEffectiveAllocation } from "./contribution-simulator";
import { computeTaxOnGain } from "./tax-simulator";
import { simulateSaleRules } from "./sale-simulator";
import { simulateRebuyTiers } from "./rebuy-simulator";
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

  test("una moneda con fecha inicio futura no recibe compras antes de activarse", () => {
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
            allocationPercentage: 50, allocationValue: null, allocationType: "percentage",
            priority: 1, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: null, startDate: makeSnapshot().projectionStartDate, endDate: null,
          },
          {
            id: "ia-ton", assetId: "TON", cycleId: "cycle-1", status: "active",
            allocationPercentage: 50, allocationValue: null, allocationType: "percentage",
            priority: 2, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: null, startDate: new Date("2028-01-01").getTime(), endDate: null,
          },
        ],
      }],
      prices: { BTC: 80_000, ETH: 2_000, TON: 2 },
    });

    const result = runProjection(makeInput(snap, 1));
    const tonResult = result.assetResults.find(a => a.assetId === "TON");

    expect(result.cycleResults[0]?.buysByAsset["TON"] ?? 0).toBe(0);
    expect(tonResult?.finalBalance ?? 0).toBe(0);
  });

  test("los importes fijos reservan su parte y el resto se reparte por porcentaje", () => {
    const now = makeSnapshot().projectionStartDate;
    const allocation = computeEffectiveAllocation([
      {
        id: "ia-ada", assetId: "ADA", cycleId: "cycle-1", status: "active",
        allocationPercentage: null, allocationValue: 50, allocationType: "amount",
        priority: 1, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
        goalReachedAt: null, startDate: now, endDate: null,
      },
      {
        id: "ia-btc", assetId: "BTC", cycleId: "cycle-1", status: "active",
        allocationPercentage: 100, allocationValue: null, allocationType: "percentage",
        priority: 2, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
        goalReachedAt: null, startDate: now, endDate: null,
      },
    ], new Set(), now, 200);

    expect(allocation.ADA).toBeCloseTo(0.25, 4);
    expect(allocation.BTC).toBeCloseTo(0.75, 4);
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

  test("dos recompras en el mismo periodo usan porcentajes sobre EURC restante", () => {
    let lotId = 0;
    const results = simulateRebuyTiers(
      "cycle-1",
      Date.now(),
      [
        { id: "tier-1", cycleId: "cycle-1", assetId: "BTC", drawdownPercentage: 15, usagePercentage: 20, priority: 1, status: "activa", referenceType: "manual", referenceValue: 100_000, lastTriggeredAt: null },
        { id: "tier-2", cycleId: "cycle-1", assetId: "BTC", drawdownPercentage: 25, usagePercentage: 30, priority: 2, status: "activa", referenceType: "manual", referenceValue: 100_000, lastTriggeredAt: null },
      ],
      { BTC: 70_000 },
      1_000,
      new Set(),
      { next: () => `lot-${++lotId}` },
    );

    const triggered = results.filter(result => result.triggered);
    expect(triggered).toHaveLength(2);
    expect(triggered[0].eurcConsumedEur).toBeCloseTo(200);
    expect(triggered[1].eurcConsumedEur).toBeCloseTo(240);
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

// ── Proyección multiactivo y estrategia completa ─────────────────────────────

describe("runProjection — multiactivo sin proxy BTC", () => {
  test("BTC puede caer mientras ETH sube con hipótesis independientes", () => {
    const snap = makeSnapshot();
    const input = makeInput(snap, 2);
    const result = runProjection({
      ...input,
      scenarioHypotheses: {
        ...input.scenarioHypotheses,
        assetRates: [
          { assetId: "BTC", annualGrowthRate: -0.25, volatility: 0.6, correctionDepth: 0.5 },
          { assetId: "ETH", annualGrowthRate: 0.35, volatility: 0.6, correctionDepth: 0.4 },
        ],
        defaultAnnualGrowthRate: 0,
      },
    });

    const first = result.periods[0].positions;
    const last = result.periods[result.periods.length - 1].positions;
    expect(last.BTC.priceEur!).toBeLessThan(first.BTC.priceEur!);
    expect(last.ETH.priceEur!).toBeGreaterThan(first.ETH.priceEur!);
  });

  test("una cartera sin BTC se proyecta sin crear BTC ni usarlo como activo implícito", () => {
    const now = makeSnapshot().projectionStartDate;
    const snap = makeSnapshot({
      cycles: [{
        id: "cycle-eth-ada",
        planId: "plan-1",
        name: "Ciclo ETH/ADA",
        startDate: now,
        endDate: null,
        monthlyAmountEur: 200,
        status: "active",
        assets: [
          {
            id: "ia-eth", assetId: "ETH", cycleId: "cycle-eth-ada", status: "active",
            allocationPercentage: 50, allocationValue: null, allocationType: "percentage",
            priority: 1, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: null, startDate: now, endDate: null,
          },
          {
            id: "ia-ada", assetId: "ADA", cycleId: "cycle-eth-ada", status: "active",
            allocationPercentage: 50, allocationValue: null, allocationType: "percentage",
            priority: 2, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null,
            goalReachedAt: null, startDate: now, endDate: null,
          },
        ],
      }],
      positions: {
        ETH: { assetId: "ETH", balance: 0.5, avgCostEur: 2_000, currentValueEur: 1_000, currentPriceEur: 2_000 },
      },
      prices: { ETH: 2_000, ADA: 0.5 },
      historicalCapitalEur: 1_000,
    });

    const result = runProjection(makeInput(snap, 2));
    expect(result.assetResults.map(asset => asset.assetId)).not.toContain("BTC");
    expect(result.scenarioHypotheses.assetRates.map(rate => rate.assetId)).not.toContain("BTC");
    expect(result.assetResults.find(asset => asset.assetId === "ADA")?.finalBalance).toBeGreaterThan(0);
  });

  test("varios ciclos activos de planes distintos suman aportaciones sin pisarse", () => {
    const now = makeSnapshot().projectionStartDate;
    const baseCycle = makeSnapshot().cycles[0];
    const snap = makeSnapshot({
      plans: [
        { id: "plan-1", name: "Plan A", status: "active", baseCurrency: "EUR" },
        { id: "plan-2", name: "Plan B", status: "active", baseCurrency: "EUR" },
      ],
      cycles: [
        { ...baseCycle, id: "cycle-a", planId: "plan-1", monthlyAmountEur: 100, assets: baseCycle.assets.map(a => ({ ...a, cycleId: "cycle-a" })) },
        { ...baseCycle, id: "cycle-b", planId: "plan-2", monthlyAmountEur: 50, assets: baseCycle.assets.map(a => ({ ...a, id: `${a.id}-b`, cycleId: "cycle-b" })) },
      ],
    });

    const result = runProjection(makeInput(snap, 1));
    const a = result.cycleResults.find(cycle => cycle.cycleId === "cycle-a")!;
    const b = result.cycleResults.find(cycle => cycle.cycleId === "cycle-b")!;

    expect(a.simulatedContributionEur).toBeGreaterThan(0);
    expect(b.simulatedContributionEur).toBeGreaterThan(0);
    expect(result.periods[result.periods.length - 1].futureCapitalEur).toBeCloseTo(
      a.simulatedContributionEur + b.simulatedContributionEur,
      1,
    );
    expect(now).toBe(snap.projectionStartDate);
  });

  test("un ciclo pausado no genera compras futuras", () => {
    const baseCycle = makeSnapshot().cycles[0];
    const snap = makeSnapshot({
      cycles: [
        baseCycle,
        {
          ...baseCycle,
          id: "cycle-paused",
          name: "Ciclo pausado",
          status: "paused",
          monthlyAmountEur: 999,
          assets: baseCycle.assets.map(a => ({ ...a, id: `${a.id}-paused`, cycleId: "cycle-paused" })),
        },
      ],
    });

    const result = runProjection(makeInput(snap, 1));
    const paused = result.cycleResults.find(cycle => cycle.cycleId === "cycle-paused")!;
    expect(paused.simulatedContributionEur).toBe(0);
    expect(paused.plannedContributionEur).toBe(0);
  });

  test("una aportación extraordinaria pendiente se proyecta una sola vez al activo destino", () => {
    const now = makeSnapshot().projectionStartDate;
    const snap = makeSnapshot({
      prices: { BTC: 80_000, ETH: 2_000, ADA: 0.5 },
      futureContributions: [{
        id: "extra-ada",
        cycleId: "cycle-1",
        type: "extraordinaria",
        plannedDate: now + 3 * MONTH,
        amountEur: 500,
        destinationAssetId: "ADA",
        status: "pendiente",
        executedAt: null,
      }],
    });
    const input = makeInput(snap, 1);
    const result = runProjection({
      ...input,
      options: { ...input.options, projectExtraordinaryContributions: true },
    });

    const ada = result.assetResults.find(asset => asset.assetId === "ADA")!;
    expect(ada.balanceBoughtExtraordinary).toBeGreaterThan(0);
    expect(result.cycleResults[0].extraordinaryContributionEur).toBeCloseTo(500, 1);
    expect(ada.events.some(event => event.type === "extraordinary_contribution")).toBe(true);
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

  test("dos tramos de venta alcanzados en un mes se aplican sobre la posición restante", () => {
    const rules = [
      {
        id: "rule-1", cycleId: "cycle-1", assetId: "BTC", name: "Beneficio 50%",
        conditionType: "gain_percentage", conditionValue: 50, conditionValue2: null,
        sellPercentage: 10, priority: 1, status: "activa",
      },
      {
        id: "rule-2", cycleId: "cycle-1", assetId: "BTC", name: "Beneficio 100%",
        conditionType: "gain_percentage", conditionValue: 100, conditionValue2: null,
        sellPercentage: 15, priority: 2, status: "activa",
      },
    ];
    const results = simulateSaleRules(
      "cycle-1", Date.now(), rules,
      { BTC: 1 }, { BTC: 50_000 }, { BTC: 110_000 },
      [{ lotId: "lot-1", assetId: "BTC", acquiredAt: 0, quantity: 1, costPerUnitEur: 50_000, remaining: 1, source: "historical" }],
      SPANISH_FISCAL_CONFIG_2024,
      new Set(),
    );
    const triggered = results.filter((r: any) => r.triggered);
    expect(triggered).toHaveLength(2);
    expect(triggered[0].quantitySold).toBeCloseTo(0.1);
    expect(triggered[1].quantitySold).toBeCloseTo(0.135);
    expect(triggered[0].lotsConsumed[0].quantity).toBeCloseTo(0.1);
    expect(triggered[1].lotsConsumed[0].quantity).toBeCloseTo(0.135);
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

// ── Bloque B1: validación de orden entre escenarios ───────────────────────────

import { runAllScenarios } from "./scenario-engine";

describe("ordenación de escenarios — regresión inversión", () => {
  const now = new Date("2026-01-01").getTime();
  const YEAR = 365.25 * DAY;

  function makeSnapshotWithBTC(btcBalance: number, monthlyEur: number): PlanConsolidatedSnapshot {
    return makeSnapshot({
      cycles: [{
        id: "cycle-1",
        planId: "plan-1",
        name: "Ciclo largo",
        startDate: now,
        endDate: now + 30 * YEAR,
        monthlyAmountEur: monthlyEur,
        status: "active",
        assets: [
          {
            id: "ia-btc",
            assetId: "BTC",
            cycleId: "cycle-1",
            status: "active",
            allocationPercentage: 100,
            allocationValue: null,
            allocationType: "percentage",
            priority: 1,
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
        BTC: { assetId: "BTC", balance: btcBalance, avgCostEur: 93_000, currentValueEur: btcBalance * 93_000, currentPriceEur: 93_000 },
      },
      prices: { BTC: 93_000 },
    });
  }

  test("conservador ≤ moderado ≤ base ≤ favorable ≤ muy_favorable ≤ optimista a 18 años", () => {
    const snap = makeSnapshotWithBTC(0.005, 200);
    const horizon18y = now + 18 * YEAR;
    const set = runAllScenarios(snap, horizon18y, {}, SPANISH_FISCAL_CONFIG_2024, now);

    const c  = set.conservador.summary.finalGrossWealthEur;
    const m  = set.moderado.summary.finalGrossWealthEur;
    const b  = set.base.summary.finalGrossWealthEur;
    const f  = set.favorable.summary.finalGrossWealthEur;
    const mf = set.muy_favorable.summary.finalGrossWealthEur;
    const o  = set.optimista.summary.finalGrossWealthEur;

    expect(m).toBeGreaterThanOrEqual(c - 1);
    expect(b).toBeGreaterThanOrEqual(m - 1);
    expect(f).toBeGreaterThanOrEqual(b - 1);
    expect(mf).toBeGreaterThanOrEqual(f - 1);
    expect(o).toBeGreaterThanOrEqual(mf - 1);
  }, 60_000);
});

// ── Bloque B2: propuestas hipotéticas de venta ────────────────────────────────

import { simulateProposedSales, buildSalesZeroExplanation } from "./sale-simulator";
import { simulateProposedRebuys, buildRebuysZeroExplanation } from "./rebuy-simulator";
import type { ProjectionLot } from "./types";

describe("simulateProposedSales", () => {
  const FIFO_LOT: ProjectionLot = {
    lotId: "lot-1",
    assetId: "BTC",
    acquiredAt: new Date("2024-01-01").getTime(),
    quantity: 0.1,
    costPerUnitEur: 40_000,
    remaining: 0.1,
    source: "purchase",
  };

  test("dispara cuando ganancia >= 50%", () => {
    const triggered = new Set<string>();
    const { results } = simulateProposedSales(
      "cycle-1", Date.now(), "base", "plan-1",
      { BTC: 0.1 },
      { BTC: 40_000 },
      { BTC: 65_000 },  // +62.5% → first tier
      [{ ...FIFO_LOT }],
      SPANISH_FISCAL_CONFIG_2024,
      triggered,
    );
    const btcSale = results.find(r => r.assetId === "BTC" && r.triggered);
    expect(btcSale).toBeDefined();
    expect(btcSale!.quantitySold).toBeGreaterThan(0);
  });

  test("no dispara cuando ganancia < 50%", () => {
    const triggered = new Set<string>();
    const { results } = simulateProposedSales(
      "cycle-1", Date.now(), "base", "plan-1",
      { BTC: 0.1 },
      { BTC: 40_000 },
      { BTC: 55_000 }, // +37.5% < 50%
      [{ ...FIFO_LOT }],
      SPANISH_FISCAL_CONFIG_2024,
      triggered,
    );
    expect(results.every(r => !r.triggered)).toBe(true);
  });

  test("no re-dispara la misma tier si la clave ya está usada", () => {
    const triggered = new Set<string>(["BTC-gain50"]);
    const { results } = simulateProposedSales(
      "cycle-1", Date.now(), "base", "plan-1",
      { BTC: 0.1 },
      { BTC: 40_000 },
      { BTC: 65_000 },
      [{ ...FIFO_LOT }],
      SPANISH_FISCAL_CONFIG_2024,
      triggered,
    );
    expect(results.every(r => !r.triggered)).toBe(true);
  });

  test("nunca deja balance a cero", () => {
    const triggered = new Set<string>();
    const { results } = simulateProposedSales(
      "cycle-1", Date.now(), "base", "plan-1",
      { BTC: 0.001 },
      { BTC: 40_000 },
      { BTC: 500_000 }, // +1150% → tier 200%
      [{ ...FIFO_LOT, quantity: 0.001, remaining: 0.001 }],
      SPANISH_FISCAL_CONFIG_2024,
      triggered,
    );
    const triggeredSale = results.find(r => r.triggered);
    if (triggeredSale) {
      const remaining = 0.001 - triggeredSale.quantitySold;
      expect(remaining).toBeGreaterThan(0);
    }
  });
});

// ── Bloque B2: propuestas hipotéticas de recompra ────────────────────────────

describe("simulateProposedRebuys", () => {
  test("no dispara sin EURC disponible", () => {
    const { results } = simulateProposedRebuys(
      "cycle-1", Date.now(), "base", "plan-1",
      ["BTC"], { BTC: 50_000 }, 0,
      { BTC: 70_000 }, new Set<string>(),
      { next: () => "lot-new" },
    );
    expect(results.every(r => !r.triggered)).toBe(true);
  });

  test("no dispara sin precio de referencia (sin ventas previas)", () => {
    const { results } = simulateProposedRebuys(
      "cycle-1", Date.now(), "base", "plan-1",
      ["BTC"], { BTC: 50_000 }, 1_000,
      {}, // no lastSalePrice
      new Set<string>(),
      { next: () => "lot-new" },
    );
    expect(results.every(r => !r.triggered)).toBe(true);
  });

  test("dispara recompra cuando caída >= 15% desde precio de venta", () => {
    const { results } = simulateProposedRebuys(
      "cycle-1", Date.now(), "base", "plan-1",
      ["BTC"],
      { BTC: 55_000 },  // actual price
      5_000,             // EURC available
      { BTC: 70_000 },   // last sale price → caída 21.4%
      new Set<string>(),
      { next: () => "lot-new" },
    );
    const rebuy = results.find(r => r.triggered);
    expect(rebuy).toBeDefined();
    expect(rebuy!.eurcConsumedEur).toBeGreaterThan(0);
  });

  test("usa EURC generado por ventas propuestas previas", () => {
    const triggeredSaleKeys = new Set<string>();
    const fifoLot: ProjectionLot = {
      lotId: "lot-a",
      assetId: "BTC",
      acquiredAt: new Date("2024-01-01").getTime(),
      quantity: 0.1,
      costPerUnitEur: 40_000,
      remaining: 0.1,
      source: "purchase",
    };

    const { results: saleResults, proposals: saleProps } = simulateProposedSales(
      "cycle-1", Date.now(), "base", "plan-1",
      { BTC: 0.1 },
      { BTC: 40_000 },
      { BTC: 65_000 }, // +62.5%
      [fifoLot],
      SPANISH_FISCAL_CONFIG_2024,
      triggeredSaleKeys,
    );

    const sale = saleResults.find(r => r.triggered);
    expect(sale).toBeDefined();
    expect(saleProps.length).toBeGreaterThan(0);
    const eurcFromSale = sale!.netEurcEur;
    expect(eurcFromSale).toBeGreaterThan(0);

    // Now simulate a price drop to test rebuy
    const { results: rebuyResults } = simulateProposedRebuys(
      "cycle-1", Date.now() + 1000, "base", "plan-1",
      ["BTC"],
      { BTC: 50_000 }, // price dropped from 65k
      eurcFromSale,
      { BTC: 65_000 }, // reference = last sale price
      new Set<string>(),
      { next: (() => { let n = 0; return () => `lot-r-${++n}`; })() },
    );
    const rebuy = rebuyResults.find(r => r.triggered);
    expect(rebuy).toBeDefined();
    expect(rebuy!.eurcConsumedEur).toBeGreaterThan(0);
  });
});
