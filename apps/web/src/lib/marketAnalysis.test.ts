import { describe, test, expect } from "vitest";
import { computePeriodChange, rankByPriceChange, computeRelativeStrength, fearGreedLabel } from "./marketAnalysis";

describe("computePeriodChange", () => {
  test("empty → null", () => expect(computePeriodChange([])).toBeNull());
  test("single point → null", () => expect(computePeriodChange([{ time: 1, value: 100 }])).toBeNull());

  test("+10% change", () => {
    expect(computePeriodChange([{ time: 1, value: 100 }, { time: 2, value: 110 }])).toBeCloseTo(10);
  });

  test("-20% change", () => {
    expect(computePeriodChange([{ time: 1, value: 100 }, { time: 2, value: 80 }])).toBeCloseTo(-20);
  });

  test("zero price filtered out", () => {
    const pts = [{ time: 1, value: 0 }, { time: 2, value: 100 }, { time: 3, value: 120 }];
    expect(computePeriodChange(pts)).toBeCloseTo(20);
  });

  test("negative price filtered out", () => {
    const pts = [{ time: 1, value: -1 }, { time: 2, value: 50 }, { time: 3, value: 100 }];
    expect(computePeriodChange(pts)).toBeCloseTo(100);
  });
});

describe("rankByPriceChange", () => {
  const changes: Record<string, number | null> = { BTC: 5, ETH: -3, SOL: 12, ADA: -8, SUI: 2 };

  test("gainers sorted desc", () => {
    const result = rankByPriceChange(changes, "gainers");
    expect(result.map((r) => r.assetId)).toEqual(["SOL", "BTC", "SUI"]);
  });

  test("losers sorted asc (most negative first)", () => {
    const result = rankByPriceChange(changes, "losers");
    expect(result.map((r) => r.assetId)).toEqual(["ADA", "ETH"]);
  });

  test("null values excluded", () => {
    const result = rankByPriceChange({ BTC: 5, ETH: null }, "gainers");
    expect(result).toHaveLength(1);
    expect(result[0].assetId).toBe("BTC");
  });

  test("topN limit respected", () => {
    const manyChanges: Record<string, number> = {};
    for (let i = 0; i < 20; i++) manyChanges[`ASSET${i}`] = i + 1;
    expect(rankByPriceChange(manyChanges, "gainers", 5)).toHaveLength(5);
  });

  test("zero-change assets excluded from gainers", () => {
    const result = rankByPriceChange({ BTC: 0, ETH: 5 }, "gainers");
    expect(result.map((r) => r.assetId)).toEqual(["ETH"]);
  });

  test("zero-change assets excluded from losers", () => {
    const result = rankByPriceChange({ BTC: 0, ETH: -5 }, "losers");
    expect(result.map((r) => r.assetId)).toEqual(["ETH"]);
  });
});

describe("computeRelativeStrength", () => {
  test("empty input → empty output", () => {
    expect(computeRelativeStrength({})).toEqual({});
  });

  test("all same value → all 0", () => {
    const rs = computeRelativeStrength({ BTC: 5, ETH: 5 });
    expect(rs.BTC).toBeCloseTo(0);
    expect(rs.ETH).toBeCloseTo(0);
  });

  test("BTC outperforms avg → positive RS", () => {
    const rs = computeRelativeStrength({ BTC: 10, ETH: 2 });
    expect(rs.BTC).toBeGreaterThan(0);
    expect(rs.ETH).toBeLessThan(0);
  });

  test("null values pass through as null", () => {
    const rs = computeRelativeStrength({ BTC: 10, ETH: null });
    expect(rs.ETH).toBeNull();
    expect(rs.BTC).toBeCloseTo(0);
  });

  test("all null → all null", () => {
    const rs = computeRelativeStrength({ BTC: null, ETH: null });
    expect(rs.BTC).toBeNull();
    expect(rs.ETH).toBeNull();
  });
});

describe("fearGreedLabel", () => {
  test("0 → Miedo Extremo", () => expect(fearGreedLabel(0)).toBe("Miedo Extremo"));
  test("25 → Miedo Extremo", () => expect(fearGreedLabel(25)).toBe("Miedo Extremo"));
  test("30 → Miedo", () => expect(fearGreedLabel(30)).toBe("Miedo"));
  test("50 → Neutral", () => expect(fearGreedLabel(50)).toBe("Neutral"));
  test("70 → Codicia", () => expect(fearGreedLabel(70)).toBe("Codicia"));
  test("90 → Codicia Extrema", () => expect(fearGreedLabel(90)).toBe("Codicia Extrema"));
});
