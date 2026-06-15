import { describe, test, expect } from "vitest";
import type { TransactionInput } from "@crypto-control/portfolio";
import {
  reconstructAssetQuantities,
  getQtyAtTime,
  buildPortfolioSeries,
  sliceByPeriod,
  findPriceAtOrBefore,
} from "./portfolioHistory";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBuyTx(id: string, assetId: string, amount: number, date: number): TransactionInput {
  return {
    id,
    type: "buy",
    date,
    legs: [{ assetId, amount, legType: "destination", valuationEur: amount * 10 }],
    fees: [],
  };
}

function makeSellTx(id: string, assetId: string, amount: number, date: number): TransactionInput {
  return {
    id,
    type: "sell",
    date,
    legs: [{ assetId, amount: -amount, legType: "source", valuationEur: amount * 12 }],
    fees: [],
  };
}

function makeConvertTx(
  id: string,
  fromAsset: string, fromAmount: number,
  toAsset: string, toAmount: number,
  date: number
): TransactionInput {
  return {
    id,
    type: "convert",
    date,
    legs: [
      { assetId: fromAsset, amount: -fromAmount, legType: "source",      valuationEur: fromAmount * 10 },
      { assetId: toAsset,   amount:  toAmount,   legType: "destination", valuationEur: fromAmount * 10 },
    ],
    fees: [],
  };
}

// ── reconstructAssetQuantities ───────────────────────────────────────────────

describe("reconstructAssetQuantities", () => {
  test("compra aumenta cantidad desde su fecha", () => {
    const txs = [makeBuyTx("t1", "BTC", 0.1, 1_000_000)];
    const events = reconstructAssetQuantities(txs);

    expect(getQtyAtTime(events["BTC"] ?? [], 999_999)).toBe(0);
    expect(getQtyAtTime(events["BTC"] ?? [], 1_000_000)).toBeCloseTo(0.1, 8);
    expect(getQtyAtTime(events["BTC"] ?? [], 2_000_000)).toBeCloseTo(0.1, 8);
  });

  test("venta reduce cantidad desde su fecha", () => {
    const txs = [
      makeBuyTx("t1",  "BTC", 0.5, 1_000_000),
      makeSellTx("t2", "BTC", 0.2, 2_000_000),
    ];
    const events = reconstructAssetQuantities(txs);

    expect(getQtyAtTime(events["BTC"] ?? [], 1_500_000)).toBeCloseTo(0.5, 8);
    expect(getQtyAtTime(events["BTC"] ?? [], 2_000_000)).toBeCloseTo(0.3, 8);
    expect(getQtyAtTime(events["BTC"] ?? [], 3_000_000)).toBeCloseTo(0.3, 8);
  });

  test("conversión reduce activo origen y aumenta activo destino", () => {
    const txs = [
      makeBuyTx("t1", "BTC", 1.0, 1_000_000),
      makeConvertTx("t2", "BTC", 0.5, "ETH", 8.0, 2_000_000),
    ];
    const events = reconstructAssetQuantities(txs);

    expect(getQtyAtTime(events["BTC"] ?? [], 2_000_000)).toBeCloseTo(0.5, 8);
    expect(getQtyAtTime(events["ETH"] ?? [], 2_000_000)).toBeCloseTo(8.0, 8);
  });

  test("activo sin transacciones devuelve qty = 0", () => {
    const events = reconstructAssetQuantities([]);
    expect(getQtyAtTime(events["BTC"] ?? [], 1_000_000)).toBe(0);
  });

  test("múltiples compras se acumulan en orden cronológico", () => {
    const txs = [
      makeBuyTx("t2", "BTC", 0.3, 2_000_000),
      makeBuyTx("t1", "BTC", 0.1, 1_000_000), // desordenado
    ];
    const events = reconstructAssetQuantities(txs);

    expect(getQtyAtTime(events["BTC"] ?? [], 1_000_000)).toBeCloseTo(0.1, 8);
    expect(getQtyAtTime(events["BTC"] ?? [], 2_000_000)).toBeCloseTo(0.4, 8);
  });
});

// ── findPriceAtOrBefore ───────────────────────────────────────────────────────

describe("findPriceAtOrBefore", () => {
  const prices = [
    { time: 1000, price: 100 },
    { time: 2000, price: 200 },
    { time: 3000, price: 300 },
  ];

  test("devuelve precio exacto en el timestamp", () => {
    expect(findPriceAtOrBefore(prices, 2000)).toBe(200);
  });

  test("carry-forward: usa último precio conocido antes del timestamp", () => {
    expect(findPriceAtOrBefore(prices, 2500)).toBe(200);
  });

  test("antes del primer precio devuelve null", () => {
    expect(findPriceAtOrBefore(prices, 500)).toBeNull();
  });
});

// ── buildPortfolioSeries ─────────────────────────────────────────────────────

describe("buildPortfolioSeries", () => {
  test("genera puntos correctos de valor cuando hay datos", () => {
    const txs = [makeBuyTx("t1", "BTC", 1.0, 1_000_000)];
    const prices = { BTC: [{ time: 2_000_000, price: 50000 }] };
    const series = buildPortfolioSeries(txs, prices);

    expect(series).toHaveLength(1);
    expect(series[0].value).toBeCloseTo(50000, 2);
  });

  test("no genera puntos antes de ninguna compra", () => {
    const txs = [makeBuyTx("t1", "BTC", 1.0, 2_000_000)];
    // Price at t=1_000_000, before the buy
    const prices = { BTC: [{ time: 1_000_000, price: 40000 }] };
    const series = buildPortfolioSeries(txs, prices);

    // At t=1_000_000 qty=0 → no point generated
    expect(series).toHaveLength(0);
  });

  test("no genera línea falsa con menos de 2 puntos reales", () => {
    const txs = [makeBuyTx("t1", "BTC", 0.5, 1_000_000)];
    const prices = { BTC: [{ time: 2_000_000, price: 30000 }] };
    const series = buildPortfolioSeries(txs, prices);

    // Only 1 price point → only 1 data point
    expect(series).toHaveLength(1);
    // MarketChart requires >= 2 to render; the chart itself enforces the no-diagonal-line rule
  });

  test("suma múltiples activos en el mismo timestamp", () => {
    const txs = [
      makeBuyTx("t1", "BTC", 1.0, 1_000_000),
      makeBuyTx("t2", "ETH", 10.0, 1_000_000),
    ];
    const prices = {
      BTC: [{ time: 2_000_000, price: 50000 }],
      ETH: [{ time: 2_000_000, price: 3000 }],
    };
    const series = buildPortfolioSeries(txs, prices);

    expect(series).toHaveLength(1);
    expect(series[0].value).toBeCloseTo(50000 + 30000, 2);
  });
});

// ── sliceByPeriod ─────────────────────────────────────────────────────────────

describe("sliceByPeriod", () => {
  // Points spanning 8 days (Unix seconds)
  const DAY = 86400;
  const now = 1_700_000_000; // fixed reference
  const points = [
    { time: now - 7 * DAY, value: 1000 },
    { time: now - 3 * DAY, value: 2000 },
    { time: now - 1 * DAY, value: 3000 },
    { time: now,           value: 4000 },
  ];

  test("24h y 7d devuelven series distintas", () => {
    const slice24h = sliceByPeriod(points, DAY);
    const slice7d  = sliceByPeriod(points, 7 * DAY);

    expect(slice24h.length).toBeLessThan(slice7d.length);
    expect(slice24h).not.toEqual(slice7d);
  });

  test("windowSeconds=null devuelve la serie completa", () => {
    expect(sliceByPeriod(points, null)).toEqual(points);
  });

  test("ventana 24h contiene solo puntos del último día", () => {
    const slice = sliceByPeriod(points, DAY);
    // Points at now - 1*DAY and now are within 24h of the latest (now)
    expect(slice.length).toBe(2);
    expect(slice[0].value).toBe(3000);
    expect(slice[1].value).toBe(4000);
  });

  test("ventana más grande que la serie devuelve todos los puntos", () => {
    const slice = sliceByPeriod(points, 365 * DAY);
    expect(slice).toEqual(points);
  });

  test("serie vacía devuelve array vacío", () => {
    expect(sliceByPeriod([], DAY)).toHaveLength(0);
  });
});
