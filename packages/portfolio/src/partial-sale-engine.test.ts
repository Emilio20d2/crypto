import { describe, test, expect } from "vitest";
import {
  evaluatePartialSaleRule,
  evaluatePartialSaleRules,
  buildPreparedSaleOperation,
  calculateSpanishSavingsTax,
  type PartialSaleRule,
  type PositionData,
  type MarketData,
} from "./partial-sale-engine";

function makeRule(overrides: Partial<PartialSaleRule> = {}): PartialSaleRule {
  return {
    id: "rule-1",
    assetId: "BTC",
    cycleId: "cycle-1",
    name: "Venta al objetivo",
    conditionType: "price_target",
    conditionValue: 100_000,
    conditionValue2: null,
    sellPercentage: 25,
    priority: 0,
    status: "activa",
    effectiveDate: null,
    notes: null,
    ...overrides,
  };
}

function makePosition(overrides: Partial<PositionData> = {}): PositionData {
  return {
    assetId: "BTC",
    balance: 0.1,
    averagePriceEur: 50_000,
    totalInvestedEur: 5_000,
    ...overrides,
  };
}

const market: MarketData = { currentPriceEur: 90_000, marketPhase: null, isEuphoria: false };
const marketHigh: MarketData = { currentPriceEur: 110_000, marketPhase: null, isEuphoria: false };

// ── calculateSpanishSavingsTax ────────────────────────────────────────────────

describe("calculateSpanishSavingsTax", () => {
  test("cero ganancia → cero impuesto", () => {
    expect(calculateSpanishSavingsTax(0)).toBe(0);
  });

  test("ganancia negativa → cero impuesto", () => {
    expect(calculateSpanishSavingsTax(-100)).toBe(0);
  });

  test("ganancia de 6000 € → 19%", () => {
    expect(calculateSpanishSavingsTax(6_000)).toBeCloseTo(1_140);
  });

  test("ganancia de 10000 € → tramos 19% + 21%", () => {
    // 6000 × 19% = 1140; 4000 × 21% = 840; total = 1980
    expect(calculateSpanishSavingsTax(10_000)).toBeCloseTo(1_980);
  });
});

// ── price_target ──────────────────────────────────────────────────────────────

describe("evaluatePartialSaleRule — price_target", () => {
  test("precio no alcanzado → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule(), makePosition(), market);
    expect(r.isTriggered).toBe(false);
    expect(r.preview).toBeNull();
    expect(r.notTriggeredReason).toMatch(/objetivo/i);
  });

  test("precio alcanzado → activada con preview", () => {
    const r = evaluatePartialSaleRule(makeRule(), makePosition(), marketHigh);
    expect(r.isTriggered).toBe(true);
    expect(r.preview).not.toBeNull();
    expect(r.triggeredReason).toMatch(/≥/);
  });

  test("sin precio disponible → no evaluable", () => {
    const r = evaluatePartialSaleRule(makeRule(), makePosition(), { currentPriceEur: null, marketPhase: null, isEuphoria: false });
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/precio/i);
  });

  test("preview: cantidad correcta a vender", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 25 }), makePosition({ balance: 0.4 }), marketHigh);
    expect(r.preview?.quantityToSell).toBeCloseTo(0.1); // 25% de 0.4
  });

  test("preview: importe bruto correcto", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 50 }), makePosition({ balance: 0.1 }), marketHigh);
    // 50% de 0.1 BTC × 110000 = 5500
    expect(r.preview?.grossProceedsEur).toBeCloseTo(5_500);
  });

  test("preview: plusvalía estimada positiva", () => {
    // coste base 50% de 5000 = 2500; precio venta 5500; ganancia 3000
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 50 }), makePosition({ balance: 0.1, totalInvestedEur: 5_000 }), marketHigh);
    expect(r.preview?.estimatedGainEur).toBeCloseTo(3_000);
  });

  test("preview: reserva fiscal", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 50 }), makePosition(), marketHigh);
    expect(r.preview?.fiscalReserveEur).toBeGreaterThan(0);
    expect(r.preview?.fiscalReserveEur).toEqual(r.preview?.estimatedTaxEur);
  });

  test("preview: EURC neto = bruto - impuesto", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 50 }), makePosition(), marketHigh);
    if (!r.preview) throw new Error("No preview");
    expect(r.preview.netEurcEur).toBeCloseTo(r.preview.grossProceedsEur - r.preview.estimatedTaxEur);
  });

  test("preview: posición restante correcta", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 25 }), makePosition({ balance: 0.1 }), marketHigh);
    expect(r.preview?.remainingBalance).toBeCloseTo(0.075);
  });
});

// ── cost_multiple ─────────────────────────────────────────────────────────────

describe("evaluatePartialSaleRule — cost_multiple", () => {
  test("múltiplo no alcanzado → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "cost_multiple", conditionValue: 3 }), makePosition({ averagePriceEur: 50_000 }), { currentPriceEur: 120_000, marketPhase: null, isEuphoria: false });
    // 120000/50000 = 2.4x < 3x
    expect(r.isTriggered).toBe(false);
  });

  test("múltiplo alcanzado → activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "cost_multiple", conditionValue: 2 }), makePosition({ averagePriceEur: 50_000 }), { currentPriceEur: 110_000, marketPhase: null, isEuphoria: false });
    // 110000/50000 = 2.2x ≥ 2x
    expect(r.isTriggered).toBe(true);
  });

  test("coste medio ausente → no evaluable", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "cost_multiple", conditionValue: 2 }), makePosition({ averagePriceEur: null }), marketHigh);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/coste/i);
  });
});

// ── gain_percentage ───────────────────────────────────────────────────────────

describe("evaluatePartialSaleRule — gain_percentage", () => {
  test("porcentaje de subida no alcanzado → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "gain_percentage", conditionValue: 150 }), makePosition({ averagePriceEur: 50_000 }), { currentPriceEur: 90_000, marketPhase: null, isEuphoria: false });
    // ganancia = (90000-50000)/50000 * 100 = 80% < 150%
    expect(r.isTriggered).toBe(false);
  });

  test("porcentaje de subida alcanzado → activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "gain_percentage", conditionValue: 100 }), makePosition({ averagePriceEur: 50_000 }), { currentPriceEur: 110_000, marketPhase: null, isEuphoria: false });
    // ganancia = 120% ≥ 100%
    expect(r.isTriggered).toBe(true);
  });

  test("coste medio ausente → no evaluable", () => {
    const r = evaluatePartialSaleRule(makeRule({ conditionType: "gain_percentage", conditionValue: 50 }), makePosition({ averagePriceEur: null }), marketHigh);
    expect(r.notTriggeredReason).toMatch(/coste/i);
  });
});

// ── estado y validaciones ─────────────────────────────────────────────────────

describe("evaluatePartialSaleRule — estado y validaciones", () => {
  test("regla pausada → no evaluada", () => {
    const r = evaluatePartialSaleRule(makeRule({ status: "pausada" }), makePosition(), marketHigh);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/pausada/i);
  });

  test("regla cancelada → no evaluada", () => {
    const r = evaluatePartialSaleRule(makeRule({ status: "cancelada" }), makePosition(), marketHigh);
    expect(r.isTriggered).toBe(false);
  });

  test("fecha efectiva futura → no evaluada", () => {
    const future = Date.now() + 86_400_000 * 30;
    const r = evaluatePartialSaleRule(makeRule({ effectiveDate: future }), makePosition(), marketHigh, Date.now());
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/efectiva/i);
  });

  test("sin posición → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule(), null, marketHigh);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/posición/i);
  });

  test("porcentaje inválido (0) → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 0 }), makePosition(), marketHigh);
    expect(r.isTriggered).toBe(false);
  });

  test("porcentaje inválido (>100) → no activada", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 101 }), makePosition(), marketHigh);
    expect(r.isTriggered).toBe(false);
  });

  test("rechaza venta del 100% para mantener posición residual", () => {
    const r = evaluatePartialSaleRule(makeRule({ sellPercentage: 100 }), makePosition({ balance: 0.5 }), marketHigh);
    expect(r.isTriggered).toBe(false);
    expect(r.preview).toBeNull();
    expect(r.notTriggeredReason).toMatch(/inválido/i);
  });
});

// ── evaluatePartialSaleRules ──────────────────────────────────────────────────

describe("evaluatePartialSaleRules — batch", () => {
  test("múltiples reglas evaluadas por orden de prioridad", () => {
    const rules = [
      makeRule({ id: "r1", priority: 2, conditionValue: 120_000 }),
      makeRule({ id: "r2", priority: 1, conditionValue: 80_000 }),
    ];
    const positions = { BTC: makePosition() };
    const markets = { BTC: { currentPriceEur: 110_000, marketPhase: null, isEuphoria: false } };
    const results = evaluatePartialSaleRules(rules, positions, markets);
    // r2 (prioridad 1) aparece primero, r1 no activada (110000 < 120000)
    expect(results[0].rule.id).toBe("r2");
    expect(results[0].isTriggered).toBe(true);
    expect(results[1].rule.id).toBe("r1");
    expect(results[1].isTriggered).toBe(false);
  });

  test("dos tramos alcanzados se calculan sobre la posición restante", () => {
    const rules = [
      makeRule({ id: "r1", conditionType: "gain_percentage", conditionValue: 50, sellPercentage: 10, priority: 1 }),
      makeRule({ id: "r2", conditionType: "gain_percentage", conditionValue: 100, sellPercentage: 15, priority: 2 }),
    ];
    const positions = { BTC: makePosition({ balance: 1, averagePriceEur: 50_000, totalInvestedEur: 50_000 }) };
    const markets = { BTC: { currentPriceEur: 110_000, marketPhase: null, isEuphoria: false } };
    const results = evaluatePartialSaleRules(rules, positions, markets);
    expect(results[0].preview?.quantityToSell).toBeCloseTo(0.1);
    expect(results[0].preview?.remainingBalance).toBeCloseTo(0.9);
    expect(results[1].preview?.quantityToSell).toBeCloseTo(0.135);
    expect(results[1].preview?.remainingBalance).toBeCloseTo(0.765);
    expect(results[1].preview?.remainingPercentage).toBeCloseTo(85);
  });

  test("varios tramos agresivos no liquidan la posición", () => {
    const rules = [
      makeRule({ id: "r1", conditionValue: 80_000, sellPercentage: 60, priority: 1 }),
      makeRule({ id: "r2", conditionValue: 90_000, sellPercentage: 60, priority: 2 }),
    ];
    const results = evaluatePartialSaleRules(
      rules,
      { BTC: makePosition({ balance: 1, totalInvestedEur: 50_000 }) },
      { BTC: marketHigh },
    );
    expect(results.every(r => r.isTriggered)).toBe(true);
    expect(results[0].preview?.remainingBalance).toBeCloseTo(0.4);
    expect(results[1].preview?.remainingBalance).toBeCloseTo(0.16);
  });

  test("preparar venta no ejecuta la venta", () => {
    const rule = makeRule();
    const r = evaluatePartialSaleRule(rule, makePosition(), marketHigh);
    const op = buildPreparedSaleOperation(r);
    expect(op).not.toBeNull();
    expect(op?.status).toBe("preparada");
    expect(op?.type).toBe("prepared_partial_sale");
    // No hay campo "executed" — solo preparada
    expect(op?.executedAt).toBeUndefined();
  });

  test("buildPreparedSaleOperation devuelve null si no activada", () => {
    const rule = makeRule();
    const r = evaluatePartialSaleRule(rule, makePosition(), market); // precio 90k < 100k
    expect(buildPreparedSaleOperation(r)).toBeNull();
  });
});
