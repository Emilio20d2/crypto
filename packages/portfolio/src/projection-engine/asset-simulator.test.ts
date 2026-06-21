import { describe, test, expect } from "vitest";
import { projectAssetPrice, buildDefaultHypotheses, getAssetAnnualRate } from "./asset-simulator";

const DAY = 24 * 3600 * 1000;
const BASE = new Date("2026-01-01").getTime();

describe("projectAssetPrice — phase-based growth", () => {
  test("precio base sin cambio cuando target = base", () => {
    const h = buildDefaultHypotheses("base", ["BTC"]);
    expect(projectAssetPrice(80_000, "BTC", BASE, BASE, h)).toBe(80_000);
  });

  test("precio mayor que base en escenario optimista al cabo de un año", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC"]);
    const p = projectAssetPrice(80_000, "BTC", BASE, BASE + 365 * DAY, h);
    expect(p!).toBeGreaterThan(80_000);
  });

  test("orden de escenarios: conservador < moderado < base < favorable < muy_favorable < optimista", () => {
    const future = BASE + 365 * DAY;
    const prices = (["conservador", "moderado", "base", "favorable", "muy_favorable", "optimista"] as const).map(s => {
      const h = buildDefaultHypotheses(s, ["BTC"]);
      return projectAssetPrice(80_000, "BTC", BASE, future, h)!;
    });
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  test("precio nulo para activo con precio base 0", () => {
    const h = buildDefaultHypotheses("base", ["BTC"]);
    expect(projectAssetPrice(0, "BTC", BASE, BASE + 365 * DAY, h)).toBeNull();
  });

  test("activo desconocido usa tasa por defecto", () => {
    const h = buildDefaultHypotheses("base", ["UNKNOWN"]);
    const p = projectAssetPrice(100, "UNKNOWN", BASE, BASE + 365 * DAY, h)!;
    expect(p).toBeGreaterThan(100);
  });

  test("determinista: misma entrada misma salida", () => {
    const h = buildDefaultHypotheses("base", ["BTC"]);
    const future = BASE + 500 * DAY;
    const p1 = projectAssetPrice(80_000, "BTC", BASE, future, h);
    const p2 = projectAssetPrice(80_000, "BTC", BASE, future, h);
    expect(p1).toBe(p2);
  });

  test("tasas decrecientes: BTC optimista en 20 años < BTC optimista tasa plana perpetua", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC"]);
    const future = BASE + 20 * 365 * DAY;
    const phased = projectAssetPrice(80_000, "BTC", BASE, future, h)!;
    // Flat 30% for 20 years would give: 80_000 * 1.30^20 ≈ 11.1M
    const flatPerpetual = 80_000 * Math.pow(1.30, 20);
    expect(phased).toBeLessThan(flatPerpetual);
  });

  test("límite de capitalización aplicado: BTC no supera ×7 precio base", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC"]);
    const future = BASE + 50 * 365 * DAY; // 50 years
    const price = projectAssetPrice(80_000, "BTC", BASE, future, h)!;
    expect(price).toBeLessThanOrEqual(80_000 * 7 + 1); // max ×7, +1 for float tolerance
  });

  test("escenario favorable existe como hipótesis válida", () => {
    const h = buildDefaultHypotheses("favorable", ["BTC"]);
    expect(h.scenario).toBe("favorable");
    expect(h.label).toBe("Favorable");
    expect(h.probability).toBeCloseTo(0.18, 2);
    const r = h.assetRates.find(r => r.assetId === "BTC");
    expect(r?.annualGrowthRate).toBe(0.20);
    expect(r?.decayFactor).toBe(0.65);
    expect(r?.terminalAnnualRate).toBe(0.04);
    expect(r?.maxPriceMultiplier).toBe(7);
  });

  test("escenario muy_favorable existe como hipótesis válida", () => {
    const h = buildDefaultHypotheses("muy_favorable", ["BTC"]);
    expect(h.scenario).toBe("muy_favorable");
    expect(h.label).toBe("Muy favorable");
    expect(h.probability).toBeCloseTo(0.10, 2);
    const r = h.assetRates.find(r => r.assetId === "BTC");
    expect(r?.annualGrowthRate).toBe(0.25);
    expect(r?.decayFactor).toBe(0.60);
  });
});

describe("buildDefaultHypotheses — 6 escenarios estáticos + dinámico", () => {
  test("probabilidades de los 6 escenarios estáticos suman 1.00", () => {
    const probs = (["conservador", "moderado", "base", "favorable", "muy_favorable", "optimista"] as const)
      .map(s => buildDefaultHypotheses(s, ["BTC"]).probability ?? 0);
    const sum = probs.reduce((a, b) => a + b, 0);
    // 0.15+0.22+0.28+0.18+0.10+0.07 = 1.00
    expect(sum).toBeCloseTo(1.0, 2);
  });

  test("dinámico no tiene probabilidad estática (es confianza)", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: 50, btcDominance: null });
    expect(h.probability).toBeNull();
    expect(h.confidence).toBeGreaterThan(0);
  });

  test("escenario dinámico con F&G bajo → tasa conservadora", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: 10, btcDominance: null });
    const rate = getAssetAnnualRate("BTC", h);
    const hBase = buildDefaultHypotheses("base", ["BTC"]);
    const rateBase = getAssetAnnualRate("BTC", hBase);
    expect(rate).toBeLessThan(rateBase);
  });

  test("escenario dinámico con F&G alto → tasa mayor que conservador", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: 90, btcDominance: null });
    const rate = getAssetAnnualRate("BTC", h);
    const hC = buildDefaultHypotheses("conservador", ["BTC"]);
    const rateC = getAssetAnnualRate("BTC", hC);
    expect(rate).toBeGreaterThan(rateC);
  });

  test("dinámico sin datos disponibles → fuentes marcadas como no disponibles", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: null, btcDominance: null });
    expect(h.dynamicFactors?.sourcesUnavailable.length).toBeGreaterThan(0);
  });

  test("hipótesis incluyen decayFactor y terminalAnnualRate y maxPriceMultiplier", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC", "SOL", "UNKNOWN_TOKEN"]);
    for (const r of h.assetRates) {
      expect(r.decayFactor).toBeGreaterThan(0);
      expect(r.decayFactor).toBeLessThanOrEqual(1);
      expect(r.terminalAnnualRate).toBeGreaterThan(0);
      expect(r.maxPriceMultiplier).toBeGreaterThan(1);
      expect(r.cycleLengthYears).toBe(4);
    }
  });

  test("crecimiento decreciente: tasa efectiva del ciclo 1 < tasa inicial en optimista", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC"]);
    const r = h.assetRates.find(a => a.assetId === "BTC")!;
    const cycle1Rate = r.annualGrowthRate * r.decayFactor;
    expect(cycle1Rate).toBeLessThan(r.annualGrowthRate);
  });

  test("aportaciones iguales entre escenarios — mismo activo, diferentes escenarios", () => {
    // Both scenarios should have same cycle length and multiplier structure for same asset
    const hBase = buildDefaultHypotheses("base", ["BTC"]);
    const hOpt  = buildDefaultHypotheses("optimista", ["BTC"]);
    const rBase = hBase.assetRates.find(r => r.assetId === "BTC")!;
    const rOpt  = hOpt.assetRates.find(r => r.assetId === "BTC")!;
    expect(rBase.cycleLengthYears).toBe(rOpt.cycleLengthYears);
    expect(rBase.terminalAnnualRate).toBe(rOpt.terminalAnnualRate);
  });
});
