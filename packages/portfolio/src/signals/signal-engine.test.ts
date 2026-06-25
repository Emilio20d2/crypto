import { describe, it, expect } from "vitest";
import { evaluateSignals } from "./signal-engine";
import type { SignalEngineInput, SignalPosition, SignalRebuyTier, SignalSaleRule, SignalTreasury } from "./types";

const NOW = 1_700_000_000_000;

const makePosition = (assetId: string, price: number, avgCost: number, balance = 1.0): SignalPosition => ({
  assetId,
  balance,
  averagePriceEur: avgCost,
  currentPriceEur: price,
  totalInvestedEur: avgCost * balance,
});

const makeTier = (id: string, drawdownPct: number, usagePct: number, refValue: number, assetId = "BTC"): SignalRebuyTier => ({
  id,
  cycleId: "c1",
  assetId,
  name: id,
  drawdownPercentage: drawdownPct,
  usagePercentage: usagePct,
  priority: 1,
  status: "activa",
  referenceType: "sale_price",
  referenceValue: refValue,
  referenceDate: null,
  effectiveDate: null,
  notes: null,
  lastTriggeredAt: null,
});

const noSaleRules: SignalSaleRule[] = [];

function makeInput(overrides: Partial<SignalEngineInput> = {}): SignalEngineInput {
  return {
    now: NOW,
    positions: [],
    saleRules: noSaleRules,
    rebuyTiers: [],
    treasury: { eurcBalance: 0, fiscalReserveBalance: 0, freeRebuyLiquidity: 0 },
    lastSalePriceByAsset: {},
    activePlanId: "p1",
    activeCycleId: "c1",
    mode: "live",
    ...overrides,
  };
}

// ─── Rebuy signals: executed-sale gate ────────────────────────────────────────

describe("evaluateSignals — rebuy signals (sale gate)", () => {
  const btcPosition = makePosition("BTC", 40_000, 50_000, 0.5);
  const treasury: SignalTreasury = { eurcBalance: 1000, fiscalReserveBalance: 0, freeRebuyLiquidity: 1000 };
  const tier = makeTier("tier-1", 20, 50, 50_000);

  it("does NOT generate rebuy when lastSalePriceByAsset is empty (no executed sales)", () => {
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury,
      lastSalePriceByAsset: {},
    }));
    const rebuySignals = result.signals.filter(s => s.actionType === "rebuy");
    expect(rebuySignals).toHaveLength(0);
  });

  it("generates rebuy when there is an executed sale for the asset", () => {
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury,
      lastSalePriceByAsset: { BTC: 50_000 },
    }));
    const rebuySignals = result.signals.filter(s => s.actionType === "rebuy");
    expect(rebuySignals.length).toBeGreaterThan(0);
  });

  it("generates rebuy using cross-asset sale (sale of different asset still enables rebuy)", () => {
    // EURC from ETH sale can be used to rebuy BTC
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury,
      lastSalePriceByAsset: { ETH: 2000 },
    }));
    const rebuySignals = result.signals.filter(s => s.actionType === "rebuy");
    // Should generate (any executed sale unlocks the rebuy pool)
    expect(rebuySignals.length).toBeGreaterThan(0);
  });

  it("does NOT generate rebuy even with large freeRebuyLiquidity when no sales exist", () => {
    const bigTreasury: SignalTreasury = { eurcBalance: 10_000, fiscalReserveBalance: 0, freeRebuyLiquidity: 10_000 };
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury: bigTreasury,
      lastSalePriceByAsset: {},
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy")).toHaveLength(0);
  });
});

// ─── Rebuy signals: minimum amount gate ──────────────────────────────────────

describe("evaluateSignals — rebuy signals (minimum amount)", () => {
  const btcPosition = makePosition("BTC", 40_000, 50_000, 0.5);
  const tier = makeTier("tier-1", 20, 50, 50_000); // 50% of available

  it("does NOT generate rebuy when proposedAmountEur < 25 EUR (tiny EURC pool)", () => {
    const tinyTreasury: SignalTreasury = { eurcBalance: 40, fiscalReserveBalance: 0, freeRebuyLiquidity: 40 };
    // 50% of 40 = 20 EUR < 25 EUR minimum
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury: tinyTreasury,
      lastSalePriceByAsset: { BTC: 50_000 },
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy")).toHaveLength(0);
  });

  it("generates rebuy when proposedAmountEur >= 25 EUR", () => {
    const enoughTreasury: SignalTreasury = { eurcBalance: 60, fiscalReserveBalance: 0, freeRebuyLiquidity: 60 };
    // 50% of 60 = 30 EUR >= 25 EUR minimum
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury: enoughTreasury,
      lastSalePriceByAsset: { BTC: 50_000 },
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy").length).toBeGreaterThan(0);
  });

  it("skips tier with tiny amount but allows tier with sufficient amount in same run", () => {
    const bigPosition = makePosition("ETH", 1_500, 2_000, 5.0);
    const ethTier = makeTier("tier-eth", 25, 3, 2_000, "ETH"); // 3% of 60 = 1.8 EUR → below minimum
    const btcTierBig = makeTier("tier-btc", 20, 50, 50_000, "BTC"); // 50% of 60 = 30 EUR → above minimum
    const treasury: SignalTreasury = { eurcBalance: 60, fiscalReserveBalance: 0, freeRebuyLiquidity: 60 };

    const result = evaluateSignals(makeInput({
      positions: [makePosition("BTC", 40_000, 50_000, 0.5), bigPosition],
      rebuyTiers: [ethTier, btcTierBig],
      treasury,
      lastSalePriceByAsset: { BTC: 50_000, ETH: 2_000 },
    }));

    const rebuySignals = result.signals.filter(s => s.actionType === "rebuy");
    const assetIds = rebuySignals.map(s => s.assetId);
    expect(assetIds).not.toContain("ETH");
    expect(assetIds).toContain("BTC");
  });
});

// ─── Rebuy signals: fallback path (no configured tiers) ──────────────────────

describe("evaluateSignals — rebuy signals (fallback, no tiers)", () => {
  const btcPosition = makePosition("BTC", 40_000, 100_000, 0.5); // -60% drawdown

  it("fallback: no rebuy without executed sale", () => {
    const treasury: SignalTreasury = { eurcBalance: 500, fiscalReserveBalance: 0, freeRebuyLiquidity: 500 };
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [],
      treasury,
      lastSalePriceByAsset: {},
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy")).toHaveLength(0);
  });

  it("fallback: no rebuy when available EURC < 25 EUR minimum", () => {
    const tinyTreasury: SignalTreasury = { eurcBalance: 20, fiscalReserveBalance: 0, freeRebuyLiquidity: 20 };
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [],
      treasury: tinyTreasury,
      lastSalePriceByAsset: { BTC: 80_000 },
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy")).toHaveLength(0);
  });

  it("fallback: generates rebuy with executed sale and sufficient EURC", () => {
    const treasury: SignalTreasury = { eurcBalance: 100, fiscalReserveBalance: 0, freeRebuyLiquidity: 100 };
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [],
      treasury,
      lastSalePriceByAsset: { BTC: 80_000 },
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy").length).toBeGreaterThan(0);
  });
});

// ─── Rebuy signals: zero / empty treasury ────────────────────────────────────

describe("evaluateSignals — rebuy signals (zero treasury)", () => {
  const btcPosition = makePosition("BTC", 40_000, 50_000, 0.5);
  const tier = makeTier("tier-1", 20, 50, 50_000);
  const zeroTreasury: SignalTreasury = { eurcBalance: 0, fiscalReserveBalance: 0, freeRebuyLiquidity: 0 };

  it("no rebuy when freeRebuyLiquidity = 0 (zero EURC)", () => {
    const result = evaluateSignals(makeInput({
      positions: [btcPosition],
      rebuyTiers: [tier],
      treasury: zeroTreasury,
      lastSalePriceByAsset: { BTC: 50_000 },
    }));
    expect(result.signals.filter(s => s.actionType === "rebuy")).toHaveLength(0);
  });
});

// ─── Sell signals: not affected by rebuy guard ────────────────────────────────

describe("evaluateSignals — sell signals not affected by rebuy changes", () => {
  it("sell signals still generated even with no executed sales", () => {
    const position = makePosition("BTC", 150_000, 50_000, 0.5); // +200% gain
    const result = evaluateSignals(makeInput({
      positions: [position],
      rebuyTiers: [],
      treasury: { eurcBalance: 0, fiscalReserveBalance: 0, freeRebuyLiquidity: 0 },
      lastSalePriceByAsset: {},
    }));
    const sellSignals = result.signals.filter(s => s.actionType === "sell_partial");
    expect(sellSignals.length).toBeGreaterThan(0);
  });
});
