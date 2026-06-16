import { describe, test, expect } from "vitest";
import { computeBackfillForLeg, priceAtOrBefore } from "./cost-basis-backfill";

describe("computeBackfillForLeg", () => {
  test("computes EUR value from a real historical price", () => {
    const result = computeBackfillForLeg({ id: "leg-1", assetId: "ADA", amount: 100, transactionDate: 1000 }, 0.5);
    expect(result).toEqual({ legId: "leg-1", acquisitionValueEur: 50, unitAcquisitionPriceEur: 0.5 });
  });

  test("uses the absolute amount regardless of leg direction (source vs destination)", () => {
    const result = computeBackfillForLeg({ id: "leg-2", assetId: "BTC", amount: -0.01, transactionDate: 1000 }, 50_000);
    expect(result?.acquisitionValueEur).toBeCloseTo(500);
  });

  test("never fabricates a value when no price was resolved", () => {
    expect(computeBackfillForLeg({ id: "leg-3", assetId: "SEI", amount: 10, transactionDate: 1000 }, null)).toBeNull();
  });

  test("never fabricates a value for a non-finite or non-positive price", () => {
    expect(computeBackfillForLeg({ id: "leg-4", assetId: "SUI", amount: 10, transactionDate: 1000 }, 0)).toBeNull();
    expect(computeBackfillForLeg({ id: "leg-5", assetId: "SUI", amount: 10, transactionDate: 1000 }, -5)).toBeNull();
    expect(computeBackfillForLeg({ id: "leg-6", assetId: "SUI", amount: 10, transactionDate: 1000 }, NaN)).toBeNull();
  });

  test("skips legs with a zero amount", () => {
    expect(computeBackfillForLeg({ id: "leg-7", assetId: "SUI", amount: 0, transactionDate: 1000 }, 3)).toBeNull();
  });
});

describe("priceAtOrBefore", () => {
  const series = [
    { time: 1000, price: 10 },
    { time: 2000, price: 20 },
    { time: 3000, price: 30 },
  ];

  test("finds the most recent price at or before the target", () => {
    expect(priceAtOrBefore(series, 2500)).toBe(20);
    expect(priceAtOrBefore(series, 2000)).toBe(20);
  });

  test("returns null when the target is before any known price (never interpolates backwards)", () => {
    expect(priceAtOrBefore(series, 500)).toBeNull();
  });

  test("returns the latest price for a target after all known points (never a future price)", () => {
    expect(priceAtOrBefore(series, 5000)).toBe(30);
  });

  test("returns null for an empty series", () => {
    expect(priceAtOrBefore([], 1000)).toBeNull();
  });
});
