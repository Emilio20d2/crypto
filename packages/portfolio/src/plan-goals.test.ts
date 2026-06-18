import { describe, test, expect } from "vitest";
import {
  evaluateAssetGoal,
  evaluateCycleGoals,
  calculateReleasedAllocation,
  redistributeReleasedAllocation,
  buildGoalReachedRevisionInput,
  getEffectiveAllocationAtDate,
  type PlanAsset,
  type PositionSnapshot,
} from "./plan-goals";

function makeAsset(overrides: Partial<PlanAsset> = {}): PlanAsset {
  return {
    id: "asset-1",
    assetId: "BTC",
    cycleId: "cycle-1",
    allocationType: "percentage",
    allocationValue: 60,
    allocationPercentage: 60,
    fixedAmountEur: null,
    targetAmount: null,
    targetValueEur: null,
    targetPortfolioPercentage: null,
    startDate: 1_000_000,
    endDate: null,
    status: "active",
    isActive: true,
    ...overrides,
  };
}

function makePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    balance: 0,
    currentValueEur: null,
    currentWeightPct: null,
    ...overrides,
  };
}

// ── evaluateAssetGoal ─────────────────────────────────────────────────────────

describe("evaluateAssetGoal", () => {
  test("no goal configured → hasGoal: false", () => {
    const result = evaluateAssetGoal(makeAsset(), makePosition());
    expect(result).toEqual({ hasGoal: false });
  });

  test("quantity goal: no position → observedValue 0, not reached", () => {
    const asset = makeAsset({ targetAmount: 1000 });
    const result = evaluateAssetGoal(asset, undefined);
    expect(result).toMatchObject({ hasGoal: true, goalType: "quantity", target: 1000, observedValue: 0, reached: false, progress: 0 });
  });

  test("quantity goal: balance below target → not reached, correct progress", () => {
    const asset = makeAsset({ targetAmount: 1000 });
    const pos = makePosition({ balance: 600 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "quantity", reached: false, observedValue: 600, progress: 0.6 });
  });

  test("quantity goal: balance exactly at target → reached, progress 1", () => {
    const asset = makeAsset({ targetAmount: 1000 });
    const pos = makePosition({ balance: 1000 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "quantity", reached: true, progress: 1 });
  });

  test("quantity goal: balance above target → reached, progress capped at 1", () => {
    const asset = makeAsset({ targetAmount: 1000 });
    const pos = makePosition({ balance: 1500 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "quantity", reached: true, progress: 1 });
  });

  test("value goal: no position → evaluable: false", () => {
    const asset = makeAsset({ targetValueEur: 5000 });
    const result = evaluateAssetGoal(asset, undefined);
    expect(result).toMatchObject({ hasGoal: true, goalType: "value", evaluable: false });
  });

  test("value goal: currentValueEur null → evaluable: false", () => {
    const asset = makeAsset({ targetValueEur: 5000 });
    const pos = makePosition({ currentValueEur: null });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "value", evaluable: false });
  });

  test("value goal: value below target → not reached", () => {
    const asset = makeAsset({ targetValueEur: 5000 });
    const pos = makePosition({ currentValueEur: 3000 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "value", reached: false, observedValue: 3000, progress: 0.6 });
  });

  test("value goal: value at or above target → reached", () => {
    const asset = makeAsset({ targetValueEur: 5000 });
    const pos = makePosition({ currentValueEur: 5000 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "value", reached: true, progress: 1 });
  });

  test("portfolio_percentage goal: no position → evaluable: false", () => {
    const asset = makeAsset({ targetPortfolioPercentage: 30 });
    const result = evaluateAssetGoal(asset, undefined);
    expect(result).toMatchObject({ hasGoal: true, goalType: "portfolio_percentage", evaluable: false });
  });

  test("portfolio_percentage goal: currentWeightPct null → evaluable: false", () => {
    const asset = makeAsset({ targetPortfolioPercentage: 30 });
    const pos = makePosition({ currentWeightPct: null });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "portfolio_percentage", evaluable: false });
  });

  test("portfolio_percentage goal: below target → not reached", () => {
    const asset = makeAsset({ targetPortfolioPercentage: 30 });
    const pos = makePosition({ currentWeightPct: 20 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "portfolio_percentage", reached: false, observedValue: 20 });
  });

  test("portfolio_percentage goal: at target → reached", () => {
    const asset = makeAsset({ targetPortfolioPercentage: 30 });
    const pos = makePosition({ currentWeightPct: 30 });
    const result = evaluateAssetGoal(asset, pos);
    expect(result).toMatchObject({ hasGoal: true, goalType: "portfolio_percentage", reached: true, progress: 1 });
  });
});

// ── evaluateCycleGoals ────────────────────────────────────────────────────────

describe("evaluateCycleGoals", () => {
  test("returns results only for assets that have goals", () => {
    const assets = [
      makeAsset({ id: "a1", assetId: "BTC", targetAmount: 1 }),
      makeAsset({ id: "a2", assetId: "ETH" }), // no goal
    ];
    const positions = { BTC: makePosition({ balance: 0.5 }) };
    const results = evaluateCycleGoals(assets, positions);
    expect(results.has("a1")).toBe(true);
    expect(results.has("a2")).toBe(false);
  });
});

// ── calculateReleasedAllocation ───────────────────────────────────────────────

describe("calculateReleasedAllocation", () => {
  test("percentage type: returns (pct/100) * monthly", () => {
    const asset = makeAsset({ allocationType: "percentage", allocationValue: 40, allocationPercentage: 40 });
    expect(calculateReleasedAllocation(asset, 500)).toBeCloseTo(200);
  });

  test("percentage type falls back to allocationValue when allocationPercentage is null", () => {
    const asset = makeAsset({ allocationType: "percentage", allocationValue: 25, allocationPercentage: null });
    expect(calculateReleasedAllocation(asset, 400)).toBeCloseTo(100);
  });

  test("fixed amount type: returns fixedAmountEur", () => {
    const asset = makeAsset({ allocationType: "amount", allocationValue: 75, allocationPercentage: null, fixedAmountEur: 75 });
    expect(calculateReleasedAllocation(asset, 500)).toBe(75);
  });

  test("fixed amount type falls back to allocationValue when fixedAmountEur is null", () => {
    const asset = makeAsset({ allocationType: "amount", allocationValue: 50, allocationPercentage: null, fixedAmountEur: null });
    expect(calculateReleasedAllocation(asset, 500)).toBe(50);
  });
});

// ── redistributeReleasedAllocation ───────────────────────────────────────────

describe("redistributeReleasedAllocation", () => {
  test("empty eligible assets → empty result", () => {
    expect(redistributeReleasedAllocation(100, 500, [])).toEqual([]);
  });

  test("releasedAmount of 0 → empty result", () => {
    const asset = makeAsset({ id: "a1", allocationType: "percentage", allocationValue: 60 });
    expect(redistributeReleasedAllocation(0, 500, [asset])).toEqual([]);
  });

  test("proportional fallback: two pct assets receive share proportional to current allocation", () => {
    const a1 = makeAsset({ id: "a1", assetId: "ETH", allocationType: "percentage", allocationValue: 60, allocationPercentage: 60 });
    const a2 = makeAsset({ id: "a2", assetId: "SUI", allocationType: "percentage", allocationValue: 20, allocationPercentage: 20 });
    // released = 100€ out of 500€ monthly → 20% freed
    // a1 gets 60/(60+20)*20% = 15% extra → new 75%
    // a2 gets 20/(60+20)*20% = 5% extra → new 25%
    const changes = redistributeReleasedAllocation(100, 500, [a1, a2]);
    expect(changes).toHaveLength(2);
    const c1 = changes.find(c => c.investmentAssetId === "a1")!;
    const c2 = changes.find(c => c.investmentAssetId === "a2")!;
    expect(c1.newAllocationValue).toBeCloseTo(75);
    expect(c2.newAllocationValue).toBeCloseTo(25);
  });

  test("proportional fallback: fixed-amount assets are skipped", () => {
    const fixed = makeAsset({ id: "a1", allocationType: "amount", allocationValue: 100, fixedAmountEur: 100 });
    const changes = redistributeReleasedAllocation(50, 500, [fixed]);
    expect(changes).toEqual([]);
  });

  test("rule-based: distributes according to explicit percentages", () => {
    const a1 = makeAsset({ id: "a1", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40 });
    const a2 = makeAsset({ id: "a2", allocationType: "percentage", allocationValue: 20, allocationPercentage: 20 });
    // released = 100€ from 500€ monthly; rule: a1 gets 70%, a2 gets 30%
    const rule = [
      { investmentAssetId: "a1", percentage: 70 },
      { investmentAssetId: "a2", percentage: 30 },
    ];
    const changes = redistributeReleasedAllocation(100, 500, [a1, a2], rule);
    expect(changes).toHaveLength(2);
    const c1 = changes.find(c => c.investmentAssetId === "a1")!;
    const c2 = changes.find(c => c.investmentAssetId === "a2")!;
    // a1 gets 70€ → 70/500*100 = 14% extra → new 54%
    expect(c1.newAllocationValue).toBeCloseTo(54);
    // a2 gets 30€ → 30/500*100 = 6% extra → new 26%
    expect(c2.newAllocationValue).toBeCloseTo(26);
  });

  test("rule-based: asset not in eligible list is skipped", () => {
    const a1 = makeAsset({ id: "a1", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40 });
    const rule = [
      { investmentAssetId: "a1", percentage: 50 },
      { investmentAssetId: "missing-id", percentage: 50 },
    ];
    const changes = redistributeReleasedAllocation(100, 500, [a1], rule);
    expect(changes).toHaveLength(1);
    expect(changes[0].investmentAssetId).toBe("a1");
  });

  test("rule-based with fixed-amount asset: adds EUR to fixedAmountEur", () => {
    const fixed = makeAsset({ id: "a1", allocationType: "amount", allocationValue: 50, fixedAmountEur: 50, allocationPercentage: null });
    const rule = [{ investmentAssetId: "a1", percentage: 100 }];
    const changes = redistributeReleasedAllocation(30, 500, [fixed], rule);
    expect(changes).toHaveLength(1);
    expect(changes[0].newAllocationValue).toBeCloseTo(80); // 50 + 30
    expect(changes[0].newAllocationPercentage).toBeNull();
  });
});

// ── buildGoalReachedRevisionInput ─────────────────────────────────────────────

describe("buildGoalReachedRevisionInput", () => {
  test("returns correct revision with goal_reached changesJson", () => {
    const asset = makeAsset({ id: "a1", assetId: "BTC", cycleId: "cycle-99" });
    const changes = [
      { investmentAssetId: "a2", previousAllocationValue: 40, previousAllocationPercentage: 40, newAllocationValue: 60, newAllocationPercentage: 60 },
    ];
    const input = buildGoalReachedRevisionInput(asset, "quantity", 1.5, 200, changes, 1_700_000_000);

    expect(input.cycleId).toBe("cycle-99");
    expect(input.effectiveDate).toBe(1_700_000_000);
    expect(input.title).toContain("BTC");
    expect(input.notes).toBeNull();

    const parsed = JSON.parse(input.changesJson) as Record<string, unknown>;
    expect(parsed.type).toBe("goal_reached");
    expect(parsed.assetId).toBe("BTC");
    expect(parsed.goalType).toBe("quantity");
    expect(parsed.observedValue).toBe(1.5);
    expect(parsed.releasedAmountEur).toBe(200);
    expect(Array.isArray(parsed.redistributions)).toBe(true);
    expect((parsed.redistributions as unknown[]).length).toBe(1);
  });
});

// ── getEffectiveAllocationAtDate ──────────────────────────────────────────────

describe("getEffectiveAllocationAtDate", () => {
  const DAY = 86_400_000;

  test("returns only assets active on the given date", () => {
    const assets = [
      makeAsset({ id: "a1", startDate: 100 * DAY, endDate: 200 * DAY, status: "active" }),
      makeAsset({ id: "a2", startDate: 300 * DAY, endDate: null, status: "active" }),
    ];
    const result = getEffectiveAllocationAtDate(assets, 150 * DAY);
    expect(result.assets.map(a => a.id)).toEqual(["a1"]);
  });

  test("open-ended assets (endDate null) are active after startDate", () => {
    const assets = [makeAsset({ id: "a1", startDate: 100 * DAY, endDate: null, status: "active" })];
    const result = getEffectiveAllocationAtDate(assets, 999 * DAY);
    expect(result.assets).toHaveLength(1);
  });

  test("paused assets are included", () => {
    const assets = [makeAsset({ id: "a1", startDate: 100 * DAY, endDate: null, status: "paused" })];
    const result = getEffectiveAllocationAtDate(assets, 150 * DAY);
    expect(result.assets).toHaveLength(1);
  });

  test("closed and goal_reached assets are excluded", () => {
    const assets = [
      makeAsset({ id: "a1", startDate: 100 * DAY, endDate: null, status: "closed" }),
      makeAsset({ id: "a2", startDate: 100 * DAY, endDate: null, status: "goal_reached" }),
    ];
    const result = getEffectiveAllocationAtDate(assets, 150 * DAY);
    expect(result.assets).toHaveLength(0);
  });

  test("sums percentages and fixed amounts correctly", () => {
    const assets = [
      makeAsset({ id: "a1", allocationType: "percentage", allocationValue: 60, allocationPercentage: 60, startDate: 0, endDate: null, status: "active" }),
      makeAsset({ id: "a2", allocationType: "percentage", allocationValue: 25, allocationPercentage: 25, startDate: 0, endDate: null, status: "active" }),
      makeAsset({ id: "a3", allocationType: "amount", allocationValue: 50, fixedAmountEur: 50, allocationPercentage: null, startDate: 0, endDate: null, status: "active" }),
    ];
    const result = getEffectiveAllocationAtDate(assets, 1);
    expect(result.totalPct).toBeCloseTo(85);
    expect(result.totalFixedEur).toBeCloseTo(50);
  });
});
