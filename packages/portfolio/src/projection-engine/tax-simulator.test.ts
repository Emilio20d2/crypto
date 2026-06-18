import { describe, test, expect } from "vitest";
import { computeTaxOnGain, effectiveTaxRate } from "./tax-simulator";
import { SPANISH_FISCAL_CONFIG_2024 } from "./types";

describe("computeTaxOnGain — brackets españoles", () => {
  test("ganancia cero → impuesto cero", () => {
    expect(computeTaxOnGain(0, SPANISH_FISCAL_CONFIG_2024)).toBe(0);
  });

  test("ganancia negativa → impuesto cero", () => {
    expect(computeTaxOnGain(-500, SPANISH_FISCAL_CONFIG_2024)).toBe(0);
  });

  test("3000 EUR → 19% = 570", () => {
    expect(computeTaxOnGain(3_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(570, 1);
  });

  test("6000 EUR → 19% × 6000 = 1140", () => {
    expect(computeTaxOnGain(6_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(1_140, 1);
  });

  test("50000 EUR → 19%×6k + 21%×44k", () => {
    const expected = 6_000 * 0.19 + 44_000 * 0.21;
    expect(computeTaxOnGain(50_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(expected, 1);
  });

  test("200000 EUR — tres tramos", () => {
    const expected = 6_000 * 0.19 + (50_000 - 6_000) * 0.21 + (200_000 - 50_000) * 0.23;
    expect(computeTaxOnGain(200_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(expected, 1);
  });

  test("300000 EUR — cuatro tramos", () => {
    const expected = 6_000 * 0.19 + (50_000 - 6_000) * 0.21 + (150_000) * 0.23 + (100_000) * 0.27;
    expect(computeTaxOnGain(300_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(expected, 1);
  });

  test("400000 EUR — cinco tramos (último: 28%)", () => {
    const expected =
      6_000 * 0.19 +
      (50_000 - 6_000) * 0.21 +
      (200_000 - 50_000) * 0.23 +
      (300_000 - 200_000) * 0.27 +
      (400_000 - 300_000) * 0.28;
    expect(computeTaxOnGain(400_000, SPANISH_FISCAL_CONFIG_2024)).toBeCloseTo(expected, 1);
  });

  test("tipo efectivo menor que el tipo marginal", () => {
    const rate = effectiveTaxRate(100_000, SPANISH_FISCAL_CONFIG_2024);
    expect(rate).toBeGreaterThan(0.19);
    expect(rate).toBeLessThan(0.23);
  });

  test("no hardcodea tipo fijo 19%", () => {
    // Para ganancias muy grandes, el tipo efectivo debe ser mayor que 19%
    const rate = effectiveTaxRate(500_000, SPANISH_FISCAL_CONFIG_2024);
    expect(rate).toBeGreaterThan(0.19);
  });
});
