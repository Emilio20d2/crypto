import { describe, test, expect } from "vitest";
import { projectAssetPrice, buildDefaultHypotheses, getAssetAnnualRate } from "./asset-simulator";

const DAY = 24 * 3600 * 1000;
const BASE = new Date("2026-01-01").getTime();

describe("projectAssetPrice", () => {
  test("precio base sin cambio cuando target = base", () => {
    const h = buildDefaultHypotheses("base", ["BTC"]);
    expect(projectAssetPrice(80_000, "BTC", BASE, BASE, h)).toBe(80_000);
  });

  test("precio mayor que base en escenario optimista al cabo de un año", () => {
    const h = buildDefaultHypotheses("optimista", ["BTC"]);
    const p = projectAssetPrice(80_000, "BTC", BASE, BASE + 365 * DAY, h);
    expect(p!).toBeGreaterThan(80_000);
  });

  test("escenario optimista crece más que el conservador", () => {
    const ho = buildDefaultHypotheses("optimista", ["BTC"]);
    const hc = buildDefaultHypotheses("conservador", ["BTC"]);
    const future = BASE + 365 * DAY;
    const po = projectAssetPrice(80_000, "BTC", BASE, future, ho)!;
    const pc = projectAssetPrice(80_000, "BTC", BASE, future, hc)!;
    expect(po).toBeGreaterThan(pc);
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
});

describe("buildDefaultHypotheses", () => {
  test("escenario dinámico con F&G bajo → tasa conservadora", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: 10, btcDominance: null });
    const rate = getAssetAnnualRate("BTC", h);
    const hBase = buildDefaultHypotheses("base", ["BTC"]);
    const rateBase = getAssetAnnualRate("BTC", hBase);
    expect(rate).toBeLessThan(rateBase);
  });

  test("escenario dinámico con F&G alto → tasa más elevada", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: 90, btcDominance: null });
    const rate = getAssetAnnualRate("BTC", h);
    const hC = buildDefaultHypotheses("conservador", ["BTC"]);
    const rateC = getAssetAnnualRate("BTC", hC);
    expect(rate).toBeGreaterThan(rateC);
  });

  test("probabilidades suman aproximadamente 1 en escenarios estáticos", () => {
    const probs = (["conservador", "base", "optimista"] as const).map(s =>
      buildDefaultHypotheses(s, ["BTC"]).probability ?? 0
    );
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0.85, 1); // 0.25+0.45+0.15
  });

  test("dinámico sin datos disponibles → fuentes marcadas como no disponibles", () => {
    const h = buildDefaultHypotheses("dinamico", ["BTC"], { fearAndGreedIndex: null, btcDominance: null });
    expect(h.dynamicFactors?.sourcesUnavailable.length).toBeGreaterThan(0);
  });
});
