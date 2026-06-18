import { describe, test, expect } from "vitest";
import { buildPortfolioValueGrid, GRID_STEP_SECONDS, WINDOW_SECONDS } from "./value-grid";
import type { ValueGridPeriod } from "./value-grid";

const NOW = 1_800_000_000; // arbitrary fixed "now", in seconds
const FAR_PAST_TX = NOW - 400 * 86400; // cartera existed well before every window below

function flatValue(value: number) {
  return () => ({ value, hasHolding: true });
}

describe("buildPortfolioValueGrid — same point count/granularity as Mercado", () => {
  test.each<[ValueGridPeriod, number]>([
    ["1h", 61],
    ["24h", 97],
    ["1w", 169],
    ["1m", 121],
    ["1y", 366],
  ])("%s generates exactly the Mercado-equivalent point count (%i)", (period, expectedPoints) => {
    const points = buildPortfolioValueGrid({
      period,
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(100),
    });
    expect(points.length).toBe(expectedPoints);
  });

  test("1h never collapses to 2/3/4 points when prices are resolvable for every minute", () => {
    const points = buildPortfolioValueGrid({
      period: "1h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(50),
    });
    expect(points.length).toBeGreaterThan(50);
  });

  test("each period's window spans exactly its own duration, not another timeframe's", () => {
    for (const period of Object.keys(WINDOW_SECONDS) as ValueGridPeriod[]) {
      const windowSeconds = WINDOW_SECONDS[period];
      if (windowSeconds === null) continue;
      const points = buildPortfolioValueGrid({
        period,
        nowSeconds: NOW,
        firstTxSeconds: FAR_PAST_TX,
        valueAtMs: flatValue(10),
      });
      const span = points[points.length - 1].time - points[0].time;
      expect(span).toBeLessThanOrEqual(windowSeconds);
      expect(span).toBeGreaterThan(windowSeconds - GRID_STEP_SECONDS[period] * 2);
    }
  });

  test("1w does not reuse 1m's range, and 1m does not reuse 1y's", () => {
    const oneWeek = buildPortfolioValueGrid({ period: "1w", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    const oneMonth = buildPortfolioValueGrid({ period: "1m", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    const oneYear = buildPortfolioValueGrid({ period: "1y", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    expect(oneWeek[0].time).not.toBe(oneMonth[0].time);
    expect(oneMonth[0].time).not.toBe(oneYear[0].time);
    expect(oneWeek.length).not.toBe(oneMonth.length);
    expect(oneMonth.length).not.toBe(oneYear.length);
  });
});

describe("buildPortfolioValueGrid — before the first transaction", () => {
  test("shows an explicit zero for every grid point before the cartera existed", () => {
    const firstTx = NOW - 10 * 86400; // 10 days ago
    const points = buildPortfolioValueGrid({
      period: "1y",
      nowSeconds: NOW,
      firstTxSeconds: firstTx,
      valueAtMs: flatValue(500),
    });
    const beforeFirstTx = points.filter((p) => p.time < firstTx);
    expect(beforeFirstTx.length).toBeGreaterThan(0);
    expect(beforeFirstTx.every((p) => p.value === 0)).toBe(true);
    const afterFirstTx = points.filter((p) => p.time >= firstTx);
    expect(afterFirstTx.every((p) => p.value === 500)).toBe(true);
  });

  test("\"all\" starts exactly at the first transaction — no zero-padding before it", () => {
    const firstTx = NOW - 5 * 86400;
    const points = buildPortfolioValueGrid({
      period: "all",
      nowSeconds: NOW,
      firstTxSeconds: firstTx,
      valueAtMs: flatValue(20),
    });
    expect(points[0].time).toBe(firstTx);
    expect(points.some((p) => p.value === 0)).toBe(false);
  });
});

// ─── REGRESSION GUARD ────────────────────────────────────────────────────────
// Estas pruebas protegen las invariantes de las gráficas de Cartera.
// NO eliminar ni modificar sin demostrar el fallo en producción y actualizar
// la lógica correspondiente en apps/desktop/src/main.ts (loadPricesForAsset).
describe("buildPortfolioValueGrid — regresión gráficas de Cartera", () => {
  test("1h: la ventana es exactamente 60 minutos (3600 s)", () => {
    const points = buildPortfolioValueGrid({
      period: "1h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(1000),
    });
    const span = points[points.length - 1].time - points[0].time;
    expect(span).toBeLessThanOrEqual(3600);
    expect(points[0].time).toBeGreaterThanOrEqual(NOW - 3600);
  });

  test("1d (24h): la ventana es exactamente 24 horas (86400 s)", () => {
    const points = buildPortfolioValueGrid({
      period: "24h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(1000),
    });
    const span = points[points.length - 1].time - points[0].time;
    expect(span).toBeLessThanOrEqual(86400);
    expect(points[0].time).toBeGreaterThanOrEqual(NOW - 86400);
  });

  test("1s (1w): la ventana es exactamente 7 días (604800 s)", () => {
    const points = buildPortfolioValueGrid({
      period: "1w",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(1000),
    });
    const span = points[points.length - 1].time - points[0].time;
    expect(span).toBeLessThanOrEqual(7 * 86400);
    expect(points[0].time).toBeGreaterThanOrEqual(NOW - 7 * 86400);
  });

  test("1m (30 días): la ventana arranca antes que 1s (7 días) — no reutiliza el rango", () => {
    const week  = buildPortfolioValueGrid({ period: "1w", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    const month = buildPortfolioValueGrid({ period: "1m", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    // La ventana de 1m empieza antes que la de 1s
    expect(month[0].time).toBeLessThan(week[0].time);
    // El span real es mayor (30 días > 7 días)
    const weekSpan  = week[week.length - 1].time  - week[0].time;
    const monthSpan = month[month.length - 1].time - month[0].time;
    expect(monthSpan).toBeGreaterThan(weekSpan);
  });

  test("1a (365 días): la ventana arranca antes que 1s y 1m — no reutiliza sus rangos", () => {
    const week  = buildPortfolioValueGrid({ period: "1w", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    const month = buildPortfolioValueGrid({ period: "1m", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    const year  = buildPortfolioValueGrid({ period: "1y", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs: flatValue(1) });
    expect(year[0].time).toBeLessThan(month[0].time);
    expect(year[0].time).toBeLessThan(week[0].time);
    const monthSpan = month[month.length - 1].time - month[0].time;
    const yearSpan  = year[year.length - 1].time  - year[0].time;
    expect(yearSpan).toBeGreaterThan(monthSpan);
  });

  test("Todo: arranca exactamente en la primera operación registrada", () => {
    const firstTx = NOW - 900 * 86400; // hace 900 días
    const points = buildPortfolioValueGrid({
      period: "all",
      nowSeconds: NOW,
      firstTxSeconds: firstTx,
      valueAtMs: flatValue(5000),
    });
    expect(points[0].time).toBe(firstTx);
    expect(points.every((p) => p.value > 0)).toBe(true);
  });

  test("valor = 0 antes de la primera compra, nunca valor actual", () => {
    const firstTx = NOW - 15 * 86400; // hace 15 días
    const points = buildPortfolioValueGrid({
      period: "1m",
      nowSeconds: NOW,
      firstTxSeconds: firstTx,
      valueAtMs: (ts) => ts < firstTx * 1000 ? { value: 0, hasHolding: false } : { value: 9999, hasHolding: true },
    });
    const before = points.filter((p) => p.time < firstTx);
    const after  = points.filter((p) => p.time >= firstTx);
    expect(before.every((p) => p.value === 0)).toBe(true);
    expect(after.every((p) => p.value === 9999)).toBe(true);
    // Comprobación clave: el valor anterior a la primera compra nunca es el valor actual
    expect(before.some((p) => p.value === 9999)).toBe(false);
  });

  test("sin datos de precio → el punto se omite (nunca cero-relleno)", () => {
    const points = buildPortfolioValueGrid({
      period: "1h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: () => ({ value: 0, hasHolding: true, complete: false }),
    });
    expect(points).toHaveLength(0);
  });

  test("granularidad 1h coincide con Mercado: paso de 60 s, ~60 puntos", () => {
    const points = buildPortfolioValueGrid({
      period: "1h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(1),
    });
    // 60 minutos / 1 minuto = 60 pasos + punto final = 61
    expect(points.length).toBe(61);
    expect(GRID_STEP_SECONDS["1h"]).toBe(60);
  });

  test("granularidad 1d coincide con Mercado: paso de 900 s, ~96 puntos", () => {
    const points = buildPortfolioValueGrid({
      period: "24h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: flatValue(1),
    });
    // 24h / 15min = 96 pasos + punto final = 97
    expect(points.length).toBe(97);
    expect(GRID_STEP_SECONDS["24h"]).toBe(15 * 60);
  });
});
// ─── FIN REGRESSION GUARD ────────────────────────────────────────────────────

describe("buildPortfolioValueGrid — never fabricates or interpolates data", () => {
  test("omits points after the first transaction when a held asset lacks price (no partial total, no interpolation)", () => {
    let call = 0;
    const points = buildPortfolioValueGrid({
      period: "1h",
      nowSeconds: NOW,
      firstTxSeconds: FAR_PAST_TX,
      valueAtMs: () => {
        call += 1;
        // Every third evaluation has a held asset without a resolvable price.
        if (call % 3 === 0) return { value: 0, hasHolding: true, complete: false };
        return { value: 42, hasHolding: true };
      },
    });
    expect(points.every((p) => p.value === 0 || p.value === 42)).toBe(true);
    expect(points.length).toBeLessThan(61);
  });

  test("sums every held asset's qty × historical price at each timestamp (caller-provided valueAtMs)", () => {
    const prices: Record<string, number> = { BTC: 50_000, ADA: 0.5 };
    const qty: Record<string, number> = { BTC: 0.01, ADA: 100 };
    const valueAtMs = () => {
      const total = Object.keys(prices).reduce((sum, asset) => sum + qty[asset] * prices[asset], 0);
      return { value: total, hasHolding: true };
    };
    const points = buildPortfolioValueGrid({ period: "1h", nowSeconds: NOW, firstTxSeconds: FAR_PAST_TX, valueAtMs });
    expect(points[0].value).toBeCloseTo(0.01 * 50_000 + 100 * 0.5);
  });
});
