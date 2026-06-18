import { describe, test, expect } from "vitest";
import {
  validateAssetSubstitution,
  applyAssetSubstitution,
  canCancelSubstitution,
  canApplySubstitution,
  validateAllocationBudget,
  getCycleAssetsAtDate,
  type SubstitutionCycleInput,
  type SubstitutionAssetInput,
  type SubstitutionInput,
} from "./plan-substitutions";

const DAY = 86_400_000;

function makeDate(s: string): number {
  return new Date(s + "T00:00:00Z").getTime();
}

function makeCycle(overrides: Partial<SubstitutionCycleInput> = {}): SubstitutionCycleInput {
  return {
    id: "cycle-1",
    startDate: makeDate("2026-01-01"),
    endDate: null,
    monthlyAmountEur: 500,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<SubstitutionAssetInput> = {}): SubstitutionAssetInput {
  return {
    id: "ia-1",
    assetId: "ADA",
    cycleId: "cycle-1",
    status: "active",
    allocationType: "percentage",
    allocationValue: 60,
    allocationPercentage: 60,
    fixedAmountEur: null,
    startDate: makeDate("2026-01-01"),
    endDate: null,
    isActive: true,
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubstitutionInput> = {}): SubstitutionInput {
  return {
    cycleId: "cycle-1",
    fromAssetId: "ADA",
    toAssetId: "SUI",
    effectiveDate: makeDate("2026-03-01"),
    allocationTransferMode: "full",
    allocationTransferPercentage: null,
    allocationTransferAmount: null,
    reason: "Mejor potencial",
    ...overrides,
  };
}

// ── validateAssetSubstitution ────────────────────────────────────────────────

describe("validateAssetSubstitution", () => {
  test("sustitución válida → valid: true", () => {
    const cycle = makeCycle();
    const assets = [makeAsset()];
    const sub = makeSub();
    expect(validateAssetSubstitution(sub, cycle, assets)).toEqual({ valid: true });
  });

  test("misma moneda como origen y destino → error", () => {
    const cycle = makeCycle();
    const assets = [makeAsset()];
    const sub = makeSub({ toAssetId: "ADA" });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/mismo/i);
  });

  test("activo saliente inexistente → error", () => {
    const cycle = makeCycle();
    const assets = [makeAsset({ assetId: "BTC" })];
    const sub = makeSub({ fromAssetId: "ADA" });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/no existe/i);
  });

  test("fecha efectiva anterior al inicio del ciclo → error", () => {
    const cycle = makeCycle({ startDate: makeDate("2026-01-01") });
    const assets = [makeAsset()];
    const sub = makeSub({ effectiveDate: makeDate("2025-12-01") });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/anterior/i);
  });

  test("fecha efectiva posterior al fin del ciclo cerrado → error", () => {
    const cycle = makeCycle({ endDate: makeDate("2026-06-30") });
    const assets = [makeAsset()];
    const sub = makeSub({ effectiveDate: makeDate("2026-07-15") });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/posterior/i);
  });

  test("activo entrante duplicado con fechas solapadas → error", () => {
    const cycle = makeCycle();
    const suiAsset = makeAsset({ id: "ia-2", assetId: "SUI", startDate: makeDate("2026-01-01") });
    const assets = [makeAsset(), suiAsset];
    const sub = makeSub({ toAssetId: "SUI", effectiveDate: makeDate("2026-03-01") });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/ya está activo/i);
  });

  test("porcentaje de transferencia negativo → error", () => {
    const cycle = makeCycle();
    const assets = [makeAsset()];
    const sub = makeSub({
      allocationTransferMode: "custom",
      allocationTransferPercentage: -10,
    });
    const r = validateAssetSubstitution(sub, cycle, assets);
    expect(r.valid).toBe(false);
  });

  test("retirada sin activo entrante (toAssetId null) → válido", () => {
    const cycle = makeCycle();
    const assets = [makeAsset()];
    const sub = makeSub({ toAssetId: null });
    expect(validateAssetSubstitution(sub, cycle, assets)).toEqual({ valid: true });
  });
});

// ── applyAssetSubstitution ────────────────────────────────────────────────────

describe("applyAssetSubstitution", () => {
  test("sustitución full transfiere toda la asignación al entrante", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada", allocationValue: 60, allocationPercentage: 60 });
    const sub = { ...makeSub(), id: "sub-1" };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);

    expect(effect.fromAssetId).toBe("ADA");
    expect(effect.fromInvestmentAssetId).toBe("ia-ada");
    expect(effect.toAssetId).toBe("SUI");
    expect(effect.toInvestmentAssetNewConfig?.allocationValue).toBeCloseTo(60);
    expect(effect.toInvestmentAssetNewConfig?.allocationType).toBe("percentage");
    expect(effect.toInvestmentAssetNewConfig?.startDate).toBe(makeDate("2026-03-01"));
  });

  test("sustitución custom con porcentaje específico", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada", allocationValue: 60, allocationPercentage: 60 });
    const sub = {
      ...makeSub(),
      id: "sub-1",
      allocationTransferMode: "custom" as const,
      allocationTransferPercentage: 40,
    };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);
    expect(effect.toInvestmentAssetNewConfig?.allocationValue).toBeCloseTo(40);
  });

  test("sustitución pending → toInvestmentAssetNewConfig con 0 asignación", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada", allocationValue: 60 });
    const sub = { ...makeSub(), id: "sub-1", allocationTransferMode: "pending" as const };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);
    expect(effect.toInvestmentAssetNewConfig?.allocationValue).toBeCloseTo(0);
  });

  test("retirada sin toAssetId → toInvestmentAssetNewConfig null", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada" });
    const sub = { ...makeSub({ toAssetId: null }), id: "sub-1" };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);
    expect(effect.toInvestmentAssetNewConfig).toBeNull();
  });

  test("changesJson tiene type: asset_substitution", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada" });
    const sub = { ...makeSub(), id: "sub-1" };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);
    const data = JSON.parse(effect.revisionChangesJson) as Record<string, unknown>;
    expect(data.type).toBe("asset_substitution");
    expect(data.fromAssetId).toBe("ADA");
    expect(data.toAssetId).toBe("SUI");
  });

  test("no ejecuta venta ni conversión (no hay legs de venta en el effect)", () => {
    const cycle = makeCycle();
    const fromAsset = makeAsset({ id: "ia-ada" });
    const sub = { ...makeSub(), id: "sub-1" };
    const effect = applyAssetSubstitution(sub, fromAsset, cycle);
    // El efecto no tiene legs de operación, solo configuración
    expect(effect).not.toHaveProperty("saleLegs");
    expect(effect).not.toHaveProperty("conversionLegs");
  });
});

// ── canCancelSubstitution / canApplySubstitution ──────────────────────────────

describe("canCancelSubstitution", () => {
  test("borrador → cancelable", () => expect(canCancelSubstitution("borrador")).toBe(true));
  test("programada → cancelable", () => expect(canCancelSubstitution("programada")).toBe(true));
  test("aplicada → NO cancelable", () => expect(canCancelSubstitution("aplicada")).toBe(false));
  test("cancelada → NO cancelable", () => expect(canCancelSubstitution("cancelada")).toBe(false));
});

describe("canApplySubstitution", () => {
  test("borrador → aplicable", () => expect(canApplySubstitution("borrador")).toBe(true));
  test("programada → aplicable", () => expect(canApplySubstitution("programada")).toBe(true));
  test("aplicada → NO aplicable", () => expect(canApplySubstitution("aplicada")).toBe(false));
  test("cancelada → NO aplicable", () => expect(canApplySubstitution("cancelada")).toBe(false));
});

// ── validateAllocationBudget ──────────────────────────────────────────────────

describe("validateAllocationBudget", () => {
  test("reparto sin sobrepasar 100% → válido", () => {
    const assets = [
      makeAsset({ assetId: "ADA", allocationValue: 60, allocationPercentage: 60 }),
      makeAsset({ id: "ia-2", assetId: "ETH", allocationValue: 25, allocationPercentage: 25 }),
    ];
    // Retiring ADA (60%) and adding SUI with 60% — only ETH remains (25%), so 25+60=85 ≤ 100
    const r = validateAllocationBudget(assets, "ADA", 60, "percentage", 500);
    expect(r.valid).toBe(true);
  });

  test("reparto que supera 100% → error", () => {
    const assets = [
      makeAsset({ assetId: "ADA", allocationValue: 40, allocationPercentage: 40 }),
      makeAsset({ id: "ia-2", assetId: "ETH", allocationValue: 50, allocationPercentage: 50 }),
    ];
    // Retiring ADA (40%), ETH remains (50%). Adding SUI with 60% → 50+60=110% > 100%
    const r = validateAllocationBudget(assets, "ADA", 60, "percentage", 500);
    expect(r.valid).toBe(false);
    expect((r as { valid: false; reason: string }).reason).toMatch(/100%/i);
  });
});

// ── getCycleAssetsAtDate ──────────────────────────────────────────────────────

describe("getCycleAssetsAtDate", () => {
  test("devuelve solo activos vigentes en la fecha dada", () => {
    const assets = [
      makeAsset({ assetId: "ADA", startDate: makeDate("2026-01-01"), endDate: makeDate("2026-03-01") }),
      makeAsset({ id: "ia-2", assetId: "SUI", startDate: makeDate("2026-03-02"), endDate: null }),
    ];
    const atFeb = getCycleAssetsAtDate(assets, "cycle-1", makeDate("2026-02-01"));
    expect(atFeb.map(a => a.assetId)).toEqual(["ADA"]);

    const atMar = getCycleAssetsAtDate(assets, "cycle-1", makeDate("2026-04-01"));
    expect(atMar.map(a => a.assetId)).toEqual(["SUI"]);
  });

  test("excluye activos de otro ciclo", () => {
    const assets = [
      makeAsset({ assetId: "ADA", cycleId: "cycle-2" }),
    ];
    expect(getCycleAssetsAtDate(assets, "cycle-1", makeDate("2026-06-01"))).toHaveLength(0);
  });
});
