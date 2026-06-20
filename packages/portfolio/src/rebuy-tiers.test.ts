import { describe, test, expect } from "vitest";
import { evaluateRebuyTiers } from "./rebuy-tiers";
import type { RebuyTier } from "./rebuy-tiers";

const tiers: RebuyTier[] = [
  { drawdownPercentage: 15, usagePercentage: 20 },
  { drawdownPercentage: 25, usagePercentage: 30 },
  { drawdownPercentage: 40, usagePercentage: 50 },
];

describe("evaluateRebuyTiers", () => {
  test("caída de -15% activa el primer escalón", () => {
    const result = evaluateRebuyTiers(tiers, 15, 1000);
    expect(result.applicableTier).toEqual({ drawdownPercentage: 15, usagePercentage: 20 });
    expect(result.suggestedAmountEur).toBe(200);
  });

  test("caída de -25% activa el segundo escalón, no el primero", () => {
    const result = evaluateRebuyTiers(tiers, 25, 1000);
    expect(result.applicableTier?.drawdownPercentage).toBe(25);
    expect(result.suggestedAmountEur).toBe(300);
  });

  test("caída de -40% activa el escalón más profundo", () => {
    const result = evaluateRebuyTiers(tiers, 45, 1000);
    expect(result.applicableTier?.drawdownPercentage).toBe(40);
    expect(result.suggestedAmountEur).toBe(500);
  });

  test("caída de -10% no alcanza ningún umbral", () => {
    const result = evaluateRebuyTiers(tiers, 10, 1000);
    expect(result.applicableTier).toBeNull();
    expect(result.suggestedAmountEur).toBe(0);
  });

  test("sin niveles configurados: nunca inventa un umbral", () => {
    const result = evaluateRebuyTiers([], 50, 1000);
    expect(result.applicableTier).toBeNull();
    expect(result.reasoning).toContain("No hay niveles");
  });

  test("liquidez negativa nunca produce una sugerencia negativa", () => {
    const result = evaluateRebuyTiers(tiers, 20, -50);
    expect(result.suggestedAmountEur).toBe(0);
  });

  test("un nivel del 100% no produce compra masiva", () => {
    const result = evaluateRebuyTiers([{ drawdownPercentage: 15, usagePercentage: 100 }], 20, 1000);
    expect(result.applicableTier).toBeNull();
    expect(result.suggestedAmountEur).toBe(0);
  });
});
