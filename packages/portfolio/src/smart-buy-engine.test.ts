import { describe, test, expect } from "vitest";
import {
  calculateSmartBuyAllocation,
  validateSmartBuyProposal,
  rankSmartBuyCandidates,
  type SmartBuyAsset,
  type SmartBuyPosition,
  type TreasurySnapshot,
} from "./smart-buy-engine";

function makeAsset(overrides: Partial<SmartBuyAsset> = {}): SmartBuyAsset {
  return {
    assetId: "BTC",
    status: "active",
    targetAllocationPct: 60,
    goalReachedAt: null,
    ...overrides,
  };
}

function makePosition(overrides: Partial<SmartBuyPosition> = {}): SmartBuyPosition {
  return {
    assetId: "BTC",
    balance: 0.05,
    currentValueEur: 3_000,
    averagePriceEur: 55_000,
    currentPriceEur: 60_000,
    ...overrides,
  };
}

const treasury: TreasurySnapshot = { eurcBalance: 500, fiscalReserveBalance: 100, freeRebuyLiquidity: 0 };

const assets2 = [
  makeAsset({ assetId: "BTC", targetAllocationPct: 60 }),
  makeAsset({ assetId: "ETH", targetAllocationPct: 40 }),
];
const positions2: Record<string, SmartBuyPosition> = {
  BTC: makePosition({ assetId: "BTC", currentValueEur: 4_000, currentPriceEur: 60_000 }),
  ETH: makePosition({ assetId: "ETH", currentValueEur: 2_000, currentPriceEur: 3_000, averagePriceEur: 3_200 }),
};

// ── importe inválido ──────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — importe inválido", () => {
  test("importe cero → sin recomendaciones", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 0, null, "plan", "cash", null);
    expect(r.recommendations.length).toBe(0);
    expect(r.restrictionsApplied.some(x => /inválido/i.test(x))).toBe(true);
  });

  test("importe negativo → sin recomendaciones", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, -100, null, "plan", "cash", null);
    expect(r.recommendations.length).toBe(0);
  });
});

// ── modo plan ─────────────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — modo plan", () => {
  test("cumple el plan y puede corregir infraponderación frente al reparto base", () => {
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "plan", "cash", null);
    const btc = r.recommendations.find(x => x.assetId === "BTC");
    const eth = r.recommendations.find(x => x.assetId === "ETH");
    expect(btc?.baseAmountEur).toBeCloseTo(60);
    expect(eth?.baseAmountEur).toBeCloseTo(40);
    expect(btc!.recommendedAmountEur).toBeLessThan(btc!.baseAmountEur);
    expect(eth!.recommendedAmountEur).toBeGreaterThan(eth!.baseAmountEur);
  });

  test("resultado contiene modo y origen", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 100, null, "plan", "cash", null);
    expect(r.mode).toBe("plan");
    expect(r.originType).toBe("cash");
  });
});

// ── modo equilibrar ───────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — modo equilibrar", () => {
  test("prioriza el activo más infraponderado", () => {
    // BTC: target 60% de 6100 = 3660; actual 4000 → sobreponderado
    // ETH: target 40% de 6100 = 2440; actual 2000 → infraponderado (440 EUR)
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "equilibrar", "cash", null);
    const eth = r.recommendations.find(x => x.assetId === "ETH");
    const btc = r.recommendations.find(x => x.assetId === "BTC");
    expect(eth!.recommendedAmountEur).toBeGreaterThan(btc!.recommendedAmountEur);
  });
});

// ── activos no elegibles ──────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — activos no elegibles", () => {
  test("activo pausado queda clasificado y sin importe", () => {
    const assets = [makeAsset({ status: "paused" })];
    const r = calculateSmartBuyAllocation(assets, {}, 100, null, "plan", "cash", null);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].action).toBe("pausado");
    expect(r.recommendations[0].recommendedAmountEur).toBe(0);
  });

  test("activo cerrado queda clasificado y sin importe", () => {
    const assets = [makeAsset({ status: "closed" })];
    const r = calculateSmartBuyAllocation(assets, {}, 100, null, "plan", "cash", null);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].action).toBe("no_elegible");
    expect(r.recommendations[0].recommendedAmountEur).toBe(0);
  });

  test("activo retirado queda clasificado y sin importe", () => {
    const assets = [makeAsset({ status: "goal_reached" })];
    const r = calculateSmartBuyAllocation(assets, {}, 100, null, "plan", "cash", null);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].action).toBe("no_elegible");
    expect(r.recommendations[0].recommendedAmountEur).toBe(0);
  });

  test("objetivo alcanzado excluido de compra normal (cash)", () => {
    const assets = [makeAsset({ goalReachedAt: Date.now() - 86_400_000 })];
    const r = calculateSmartBuyAllocation(assets, {}, 100, null, "plan", "cash", null);
    expect(r.recommendations.every(x => x.recommendedAmountEur === 0)).toBe(true);
  });
});

// ── origen EURC ───────────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — EURC", () => {
  test("reserva fiscal excluida del EURC disponible", () => {
    // eurcBalance 500, fiscalReserve 100 → disponible 400
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 500, null, "plan", "eurc", treasury);
    expect(r.restrictionsApplied.some(x => /eurc/i.test(x))).toBe(true);
  });

  test("sin EURC disponible → sin recomendaciones", () => {
    const noEurc: TreasurySnapshot = { eurcBalance: 100, fiscalReserveBalance: 100, freeRebuyLiquidity: 0 };
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 100, null, "plan", "eurc", noEurc);
    expect(r.recommendations.length).toBe(0);
  });

  test("tesorería no disponible → sin recomendaciones", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 100, null, "plan", "eurc", null);
    expect(r.recommendations.length).toBe(0);
    expect(r.restrictionsApplied.some(x => /tesorería/i.test(x))).toBe(true);
  });
});

// ── límite de desviación ──────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — límite de desviación", () => {
  test("no asigna más del límite desde el base", () => {
    // Con maxDeviationPct=0, no puede desviarse del base
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "equilibrar", "cash", null, 0);
    for (const rec of r.recommendations) {
      expect(rec.recommendedAmountEur).toBeLessThanOrEqual(rec.baseAmountEur + 0.01);
    }
  });
});

// ── importe pendiente ─────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — importe pendiente", () => {
  test("importe asignado + pendiente = importe analizado", () => {
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "plan", "cash", null);
    const allocated = r.recommendations.reduce((s, x) => s + x.recommendedAmountEur, 0);
    expect(allocated + r.pendingAmountEur).toBeCloseTo(100, 1);
  });
});

// ── calidad de datos ──────────────────────────────────────────────────────────

describe("calculateSmartBuyAllocation — calidad de datos", () => {
  test("sin posición → sin_datos o parcial", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, 100, null, "plan", "cash", null);
    expect(["sin_datos", "parcial"]).toContain(r.dataQuality);
  });

  test("con precio disponible → completo", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], { BTC: makePosition() }, 100, 5_000, "plan", "cash", null);
    expect(r.dataQuality).toBe("completo");
  });
});

// ── propuesta preparada ───────────────────────────────────────────────────────

describe("validateSmartBuyProposal", () => {
  test("propuesta válida pasa validación", () => {
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "plan", "cash", null);
    const v = validateSmartBuyProposal(r);
    expect(v.valid).toBe(true);
  });

  test("propuesta sin datos es inválida", () => {
    const r = calculateSmartBuyAllocation([makeAsset({ status: "paused" })], {}, 100, null, "plan", "cash", null);
    const v = validateSmartBuyProposal(r);
    expect(v.valid).toBe(false);
    expect(v.reason).not.toBeNull();
  });

  test("importe negativo es inválido", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], {}, -1, null, "plan", "cash", null);
    const v = validateSmartBuyProposal(r);
    expect(v.valid).toBe(false);
  });

  test("la propuesta NO ejecuta nada — solo devuelve datos", () => {
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "plan", "cash", null);
    // No hay campo 'executedAt' ni 'status' en el resultado
    expect((r as any).executedAt).toBeUndefined();
    expect((r as any).status).toBeUndefined();
  });

  test("recomendación incluye razón y confianza determinista", () => {
    const r = calculateSmartBuyAllocation([makeAsset()], { BTC: makePosition() }, 100, 5_000, "plan", "cash", null);
    const rec = r.recommendations[0];
    expect(rec.confidenceLevel).toMatch(/alta|media|baja|no_evaluable/);
    expect(rec.reason.length).toBeGreaterThan(0);
  });

  test("modo mixto genera recomendaciones para todos los activos elegibles", () => {
    const r = calculateSmartBuyAllocation(assets2, positions2, 100, 6_000, "mixto", "cash", null);
    expect(r.recommendations.length).toBe(2);
  });
});
