import { describe, test, expect } from "vitest";
import {
  calculateAssetHealth,
  buildAssetPlanStatus,
  buildPlanAlerts,
  deduplicatePlanAlerts,
  type MonitoringAsset,
  type MonitoringPosition,
  type MonitoringCycle,
} from "./plan-monitoring";

const now = new Date("2026-06-18T00:00:00Z").getTime();

function makeAsset(overrides: Partial<MonitoringAsset> = {}): MonitoringAsset {
  return {
    id: "ia-1",
    assetId: "BTC",
    cycleId: "cycle-1",
    investmentAssetId: "ia-1",
    targetAllocationPct: 60,
    status: "active",
    targetAmount: 0.1,
    targetValueEur: 5_000,
    targetPortfolioPercentage: null,
    goalReachedAt: null,
    endDate: null,
    ...overrides,
  };
}

function makePosition(overrides: Partial<MonitoringPosition> = {}): MonitoringPosition {
  return {
    assetId: "BTC",
    balance: 0.05,
    currentValueEur: 3_000,
    averagePriceEur: 50_000,
    ...overrides,
  };
}

function makeCycle(overrides: Partial<MonitoringCycle> = {}): MonitoringCycle {
  return {
    id: "cycle-1",
    planId: "plan-1",
    endDate: null,
    monthlyAmountEur: 200,
    ...overrides,
  };
}

// ── calculateAssetHealth ──────────────────────────────────────────────────────

describe("calculateAssetHealth", () => {
  test("objetivo alcanzado → excelente", () => {
    const asset = makeAsset({ goalReachedAt: now - 86_400_000 });
    const { status } = calculateAssetHealth(asset, null, null, 0);
    expect(status).toBe("excelente");
  });

  test("activo pausado → vigilancia", () => {
    const { status } = calculateAssetHealth(makeAsset({ status: "paused" }), makePosition(), 10_000, 0);
    expect(status).toBe("vigilancia");
  });

  test("sin datos de valoración → neutral", () => {
    const { status } = calculateAssetHealth(makeAsset(), makePosition({ currentValueEur: null }), null, 0);
    expect(status).toBe("neutral");
  });

  test("activo infraponderado >15% → vigilancia", () => {
    // target 60% de 10000 = 6000; current 3000 → deviation -50%
    const { status } = calculateAssetHealth(makeAsset({ targetAllocationPct: 60 }), makePosition({ currentValueEur: 3_000 }), 10_000, 0);
    expect(status).toBe("vigilancia");
  });

  test("activo sobreponderado >15% → vigilancia", () => {
    // target 20% de 10000 = 2000; current 5000 → deviation +150%
    const { status } = calculateAssetHealth(makeAsset({ targetAllocationPct: 20 }), makePosition({ currentValueEur: 5_000 }), 10_000, 0);
    expect(status).toBe("vigilancia");
  });

  test("activo en rango → excelente", () => {
    // target 60% de 5000 = 3000; current 3000 → sin desviación
    const { status } = calculateAssetHealth(makeAsset({ targetAllocationPct: 60 }), makePosition({ currentValueEur: 3_000 }), 5_000, 0);
    expect(status).toBe("excelente");
  });

  test("activo con reglas activadas → estado activada", () => {
    const { status } = calculateAssetHealth(makeAsset(), makePosition(), 10_000, 2);
    expect(status).toBe("activada" as any);
  });

  test("activo sin datos → neutral", () => {
    const { status } = calculateAssetHealth(makeAsset(), null, null, 0);
    expect(status).toBe("neutral");
  });
});

// ── buildAssetPlanStatus ──────────────────────────────────────────────────────

describe("buildAssetPlanStatus", () => {
  test("calcula desviación correctamente", () => {
    // target 60% de 10000 = 6000; current 3000 → deviación -3000
    const s = buildAssetPlanStatus(makeAsset({ targetAllocationPct: 60 }), makePosition({ currentValueEur: 3_000 }), 10_000, 0, 0, null);
    expect(s.deviationEur).toBeCloseTo(-3_000);
    expect(s.isUnderweight).toBe(true);
  });

  test("progreso del objetivo por cantidad", () => {
    // target 0.1 BTC, balance 0.05 → 50%
    const s = buildAssetPlanStatus(makeAsset({ targetAmount: 0.1 }), makePosition({ balance: 0.05 }), null, 0, 0, null);
    expect(s.goalProgress).toBeCloseTo(50);
  });

  test("activo sobreponderado → isUnderweight false", () => {
    const s = buildAssetPlanStatus(makeAsset({ targetAllocationPct: 20 }), makePosition({ currentValueEur: 5_000 }), 10_000, 0, 0, null);
    expect(s.isUnderweight).toBe(false);
  });
});

// ── buildPlanAlerts ───────────────────────────────────────────────────────────

describe("buildPlanAlerts", () => {
  test("déficit genera aviso media prioridad", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 150, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    expect(alerts.some(a => a.type === "deficit")).toBe(true);
    expect(alerts.find(a => a.type === "deficit")?.priority).toBe("media");
  });

  test("cero déficit no genera aviso de déficit", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    expect(alerts.some(a => a.type === "deficit")).toBe(false);
  });

  test("reglas de venta activadas → aviso alta prioridad", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 1, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    const a = alerts.find(x => x.type === "venta_parcial_activada");
    expect(a?.priority).toBe("alta");
  });

  test("reglas de recompra activadas → aviso alta prioridad", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 2, pendingSubstitutions: 0, cycle: makeCycle(), now });
    expect(alerts.some(a => a.type === "compra_caida_activada")).toBe(true);
  });

  test("sustitución pendiente → aviso", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 1, cycle: makeCycle(), now });
    expect(alerts.some(a => a.type === "sustitucion_pendiente")).toBe(true);
  });

  test("etapa próxima a fin (dentro de 90 días) → aviso", () => {
    const soonEnd = now + 30 * 24 * 3600 * 1000; // 30 días
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle({ endDate: soonEnd }), now });
    expect(alerts.some(a => a.type === "etapa_proxima_fin")).toBe(true);
  });

  test("objetivo próximo (>90%) → aviso", () => {
    const asset = makeAsset({ goalReachedAt: null });
    const status = buildAssetPlanStatus(makeAsset(), makePosition({ balance: 0.095 }), null, 0, 0, null);
    // goalProgress ≈ 95%
    const fakeStatus = { ...status, goalProgress: 95, assetId: "BTC" };
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [asset], assetStatuses: [fakeStatus], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    expect(alerts.some(a => a.type === "objetivo_proximo")).toBe(true);
  });

  test("no genera aviso vacío sin acciones", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    expect(alerts.length).toBe(0);
  });

  test("deduplicación elimina alertas duplicadas", () => {
    const dup = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 50, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    const doubled = [...dup, ...dup];
    const dedup = deduplicatePlanAlerts(doubled);
    expect(dedup.length).toBe(dup.length);
  });

  test("aviso tiene acción concreta cuando corresponde", () => {
    const alerts = buildPlanAlerts({ cycleId: "cycle-1", assets: [], assetStatuses: [], deficitEur: 100, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, cycle: makeCycle(), now });
    const deficit = alerts.find(a => a.type === "deficit");
    expect(deficit?.actionAvailable).not.toBeNull();
  });
});
