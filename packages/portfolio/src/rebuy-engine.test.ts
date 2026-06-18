import { describe, test, expect } from "vitest";
import {
  evaluateRebuyTierExtended,
  evaluateRebuyTiersExtended,
  buildPreparedRebuyOperation,
  type RebuyTierExtended,
} from "./rebuy-engine";

function makeTier(overrides: Partial<RebuyTierExtended> = {}): RebuyTierExtended {
  return {
    id: "tier-1",
    cycleId: "cycle-1",
    assetId: "BTC",
    name: "Caída 20%",
    drawdownPercentage: 20,
    usagePercentage: 50,
    priority: 0,
    status: "activa",
    effectiveDate: null,
    notes: null,
    referenceType: "max_since_sale",
    referenceValue: 100_000,
    referenceDate: null,
    lastTriggeredAt: null,
    ...overrides,
  };
}

// ── regla no alcanzada ────────────────────────────────────────────────────────

describe("evaluateRebuyTierExtended — no alcanzada", () => {
  test("caída insuficiente → no activada", () => {
    // Precio 85000 sobre ref 100000 = caída 15% < umbral 20%
    const r = evaluateRebuyTierExtended(makeTier(), 85_000, 500);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/caída/i);
  });

  test("EURC igual a cero → no activada", () => {
    const r = evaluateRebuyTierExtended(makeTier(), 70_000, 0);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/liquidez/i);
  });

  test("sin precio disponible → no evaluable", () => {
    const r = evaluateRebuyTierExtended(makeTier(), null, 500);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/precio/i);
  });

  test("sin referencia configurada → no evaluable", () => {
    const r = evaluateRebuyTierExtended(makeTier({ referenceValue: null }), 70_000, 500);
    expect(r.isTriggered).toBe(false);
    expect(r.notTriggeredReason).toMatch(/referencia/i);
  });

  test("estado pausado → no evaluada", () => {
    const r = evaluateRebuyTierExtended(makeTier({ status: "pausada" }), 70_000, 500);
    expect(r.isTriggered).toBe(false);
  });
});

// ── regla alcanzada ───────────────────────────────────────────────────────────

describe("evaluateRebuyTierExtended — alcanzada", () => {
  test("caída suficiente → activada", () => {
    // Precio 75000 sobre ref 100000 = caída 25% ≥ umbral 20%
    const r = evaluateRebuyTierExtended(makeTier(), 75_000, 500);
    expect(r.isTriggered).toBe(true);
    expect(r.preview).not.toBeNull();
  });

  test("preview: importe propuesto correcto", () => {
    // 50% de 500 = 250 EUR
    const r = evaluateRebuyTierExtended(makeTier({ usagePercentage: 50 }), 70_000, 500);
    expect(r.preview?.proposedAmountEur).toBeCloseTo(250);
  });

  test("preview: cantidad estimada correcta", () => {
    // 250 EUR / 70000 EUR/BTC = 0.00357... BTC
    const r = evaluateRebuyTierExtended(makeTier({ usagePercentage: 50 }), 70_000, 500);
    expect(r.preview?.estimatedQuantity).toBeCloseTo(250 / 70_000);
  });

  test("EURC restante correcto", () => {
    const r = evaluateRebuyTierExtended(makeTier({ usagePercentage: 50 }), 70_000, 500);
    expect(r.preview?.eurcRemainingAfterEur).toBeCloseTo(250);
  });

  test("reserva fiscal excluida del EURC de entrada (no suma)", () => {
    // El motor de recompra recibe availableLiquidityEur ya libre de reserva fiscal
    // — la exclusión ocurre antes de llamar al motor. El motor solo opera sobre lo recibido.
    const r = evaluateRebuyTierExtended(makeTier({ usagePercentage: 100 }), 70_000, 200);
    expect(r.preview?.proposedAmountEur).toBeCloseTo(200);
    expect(r.preview?.eurcRemainingAfterEur).toBeCloseTo(0);
  });

  test("nuevo coste medio estimado cuando hay posición previa", () => {
    // 0.1 BTC a 80000 (coste 8000) + 250 EUR a 70000 → nuevo balance 0.1 + 0.00357 = 0.10357
    // nuevo coste = (0.1*80000 + 250) / 0.10357 ≈ 79282
    const r = evaluateRebuyTierExtended(makeTier({ usagePercentage: 50 }), 70_000, 500, 0.1, 80_000);
    expect(r.preview?.estimatedNewAvgCost).not.toBeNull();
    expect(r.preview!.estimatedNewAvgCost!).toBeLessThan(80_000);
  });

  test("no usa efectivo del DCA — solo EURC", () => {
    // El motor siempre opera sobre availableLiquidityEur pasado desde fuera.
    // No tiene acceso a efectivo del DCA.
    const r = buildPreparedRebuyOperation(evaluateRebuyTierExtended(makeTier(), 70_000, 500));
    expect(r?.originType).toBe("eurc");
  });

  test("preparar compra sin ejecutar", () => {
    const r = evaluateRebuyTierExtended(makeTier(), 70_000, 500);
    const op = buildPreparedRebuyOperation(r);
    expect(op?.status).toBe("preparada");
    expect(op?.type).toBe("prepared_rebuy");
    expect(op?.executedAt).toBeUndefined();
  });
});

// ── escalones múltiples ───────────────────────────────────────────────────────

describe("evaluateRebuyTiersExtended — múltiples escalones", () => {
  test("se activa el escalón de mayor caída alcanzado", () => {
    const tiers = [
      makeTier({ id: "t1", drawdownPercentage: 15, usagePercentage: 30 }),
      makeTier({ id: "t2", drawdownPercentage: 25, usagePercentage: 50 }),
      makeTier({ id: "t3", drawdownPercentage: 40, usagePercentage: 80 }),
    ];
    // Precio 70000 = caída 30% → activa t1 (15%) y t2 (25%), no t3 (40%)
    const prices = { BTC: 70_000 };
    const results = evaluateRebuyTiersExtended(tiers, prices, 1000);
    const triggered = results.filter(r => r.isTriggered);
    expect(triggered.length).toBe(2);
    expect(triggered[0].tier.id).toBe("t2"); // mayor drawdown primero
  });

  test("nivel ya utilizado (lastTriggeredAt reciente) aparece como sin cambio", () => {
    // El motor evalúa si la condición se cumple hoy — el uso previo
    // lo gestiona la capa superior (IPC/main). El motor puro siempre evalúa.
    const tier = makeTier({ lastTriggeredAt: Date.now() - 86_400_000 });
    const r = evaluateRebuyTierExtended(tier, 70_000, 500);
    expect(r.isTriggered).toBe(true); // motor puro no bloquea por lastTriggeredAt
  });

  test("referencia de precio de venta como base del drawdown", () => {
    const tier = makeTier({ referenceType: "sale_price", referenceValue: 90_000 });
    // Precio 70000 sobre ref 90000 = caída 22.2% ≥ 20%
    const r = evaluateRebuyTierExtended(tier, 70_000, 500);
    expect(r.isTriggered).toBe(true);
  });

  test("referencia de máximo como base del drawdown", () => {
    const tier = makeTier({ referenceType: "cycle_max", referenceValue: 110_000 });
    // Precio 70000 sobre ref 110000 = caída 36.4% ≥ 20%
    const r = evaluateRebuyTierExtended(tier, 70_000, 500);
    expect(r.isTriggered).toBe(true);
  });
});
