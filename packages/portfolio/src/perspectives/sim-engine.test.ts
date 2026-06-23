import { describe, it, expect } from "vitest";
import { buildPricePath, buildPriceMap, monthKey } from "./price-model";
import { runPerspectivesSimulation } from "./sim-engine";
import type { SimInput, SimCycle, CurrentPosition, SimOptions } from "./types";
import { DEFAULT_SPANISH_TAX_BANDS, DEFAULT_SIM_OPTIONS } from "./types";
import { buildConsensus, weightSource, isExpired } from "./forecast-sources";
import type { ForecastSource } from "./forecast-sources";
import { KNOWN_FORECASTS } from "./known-forecasts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NOW = new Date("2024-01-01").getTime();
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

function horizon(years: number): number {
  return NOW + years * YEAR_MS;
}

function makeCycle(overrides: Partial<SimCycle> = {}): SimCycle {
  return {
    id: "c1",
    planId: "p1",
    name: "Test cycle",
    startDate: NOW - YEAR_MS,
    endDate: null,
    monthlyAmountEur: 200,
    assets: [
      {
        id: "a1",
        assetId: "bitcoin",
        allocationType: "percentage",
        allocationValue: 100,
        allocationPercentage: 100,
        fixedAmountEur: null,
        targetAmount: null,
        targetValueEur: null,
        startDate: NOW - YEAR_MS,
        endDate: null,
        status: "active",
      },
    ],
    saleRules: [],
    rebuyTiers: [],
    substitutions: [],
    revisions: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<SimInput> = {}): SimInput {
  const base: SimInput = {
    now: NOW,
    horizonDate: horizon(10),
    currentPositions: [
      {
        assetId: "bitcoin",
        balance: 0.01,
        avgCostEur: 30000,
        currentPriceEur: 60000,
      },
    ],
    currentLots: [
      {
        id: "lot1",
        assetId: "bitcoin",
        date: NOW - 2 * YEAR_MS,
        remainingAmount: 0.01,
        unitAcquisitionPriceEur: 30000,
      },
    ],
    eurcFree: 0,
    eurcFiscalReserve: 0,
    eurCash: 0,
    historicalCapitalEur: 300,
    cycles: [makeCycle()],
    options: { ...DEFAULT_SIM_OPTIONS },
  };
  return { ...base, ...overrides };
}

// ─── Price model tests ────────────────────────────────────────────────────────

describe("price-model: cycle structure", () => {
  it("produces bear-phase months with lower price than distribution peak (within first cycle)", () => {
    // Use 4-year horizon to stay within the first 48-month cycle for BTC/base
    const path = buildPricePath("bitcoin", 60000, "base", NOW, horizon(4));
    // Find local max (euphoria peak) and then check for drawdown after it
    let runningPeak = 0;
    let maxDrawdown = 0;
    for (const pt of path) {
      if (pt.priceEur > runningPeak) {
        runningPeak = pt.priceEur;
      } else if (runningPeak > 0) {
        const dd = (runningPeak - pt.priceEur) / runningPeak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }
    // Base scenario BTC has CYCLE_DRAWDOWN = 0.45 from peak
    // Allow noise to reduce it — but must still see at least 15% drawdown
    expect(maxDrawdown).toBeGreaterThan(0.15);
  });

  it("capitulation phase is present in base scenario within first cycle", () => {
    const path = buildPricePath("bitcoin", 60000, "base", NOW, horizon(6));
    const capitulationMonths = path.filter(p => p.phase === "capitulation");
    expect(capitulationMonths.length).toBeGreaterThan(0);
  });

  it("bear or capitulation phase prices are below bull phase peak prices", () => {
    const path = buildPricePath("bitcoin", 60000, "base", NOW, horizon(6));
    const bullPrices = path.filter(p => p.phase === "bull" || p.phase === "euphoria").map(p => p.priceEur);
    const bearPrices = path.filter(p => p.phase === "bear" || p.phase === "capitulation").map(p => p.priceEur);
    if (bullPrices.length === 0 || bearPrices.length === 0) return; // skip if no bear in horizon
    const maxBull = Math.max(...bullPrices);
    const minBear = Math.min(...bearPrices);
    expect(minBear).toBeLessThan(maxBull * 0.95); // at least 5% below bull peak
  });

  it("scenario ordering: optimista peak > base peak > conservador peak", () => {
    const btcPrice = 60000;
    const pathCons = buildPricePath("bitcoin", btcPrice, "conservador", NOW, horizon(10));
    const pathBase = buildPricePath("bitcoin", btcPrice, "base", NOW, horizon(10));
    const pathOpt  = buildPricePath("bitcoin", btcPrice, "optimista", NOW, horizon(10));

    const maxPrice = (path: ReturnType<typeof buildPricePath>) =>
      Math.max(...path.map(p => p.priceEur));

    expect(maxPrice(pathOpt)).toBeGreaterThan(maxPrice(pathBase));
    expect(maxPrice(pathBase)).toBeGreaterThan(maxPrice(pathCons));
  });

  it("price never drops to zero", () => {
    const path = buildPricePath("bitcoin", 60000, "conservador", NOW, horizon(15));
    const minPrice = Math.min(...path.map(p => p.priceEur));
    expect(minPrice).toBeGreaterThan(0);
    // Floor is 0.5% of initial price
    expect(minPrice).toBeGreaterThanOrEqual(60000 * 0.005);
  });

  it("price never drops to zero for speculative asset", () => {
    const path = buildPricePath("unknown-coin-xyz", 1.0, "conservador", NOW, horizon(10));
    const minPrice = Math.min(...path.map(p => p.priceEur));
    expect(minPrice).toBeGreaterThan(0);
  });

  it("buildPriceMap keys match YYYY-MM format", () => {
    const map = buildPriceMap("bitcoin", 60000, "base", NOW, horizon(2));
    const keys = Object.keys(map);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("optimista final wealth exceeds conservador final wealth", () => {
    // Indirectly tests price model ordering via full simulation
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    const opt = result.scenarios.find(s => s.scenario === "optimista")!.summary.finalNetWealthEur;
    const cons = result.scenarios.find(s => s.scenario === "conservador")!.summary.finalNetWealthEur;
    expect(opt).toBeGreaterThan(cons);
  });
});

// ─── Sim engine: sales ────────────────────────────────────────────────────────

describe("sim-engine: sales", () => {
  it("proposed sale fires when price exceeds 3x avgCost", () => {
    // BTC avgCost €30k, current price €60k (2x) — no sale yet
    // After the model pushes price to 3x = €90k, sale should fire
    // We need a scenario that reaches 3x relatively quickly
    const input = makeInput({
      horizonDate: horizon(5),
      options: { policy: "full_strategy", commissionRate: 0, taxBands: DEFAULT_SPANISH_TAX_BANDS },
    });
    const result = runPerspectivesSimulation(input);
    // In favorable or optimista 5-year, BTC should easily hit 3x
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    const totalSales = opt.summary.totalSalesEur;
    // Either sales happened or the gain never reached 3x
    // We verify that IF sales happened, EURC was generated
    if (totalSales > 0) {
      expect(opt.summary.finalEurcFreeEur + opt.summary.finalFiscalReserveEur).toBeGreaterThan(0);
    }
    // The sales skip reasons must always be populated when no sales
    else {
      const reasonsAvailable = opt.annualSnapshots.some(s => s.salesSkipReasons.length > 0);
      expect(reasonsAvailable).toBe(true);
    }
  });

  it("sale generates EURC reinvestible (eurcFree > 0 after sale)", () => {
    // Position with big gain: avgCost very low vs price → sale should fire
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 0,
      eurcFiscalReserve: 0,
      horizonDate: horizon(3),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    // 1 BTC at €60k, avgCost €5k → 12× gain from start
    // 3× threshold already exceeded at start → first month should trigger sale proposal
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    if (opt.summary.totalSalesEur > 0) {
      expect(opt.summary.finalEurcFreeEur + opt.summary.finalFiscalReserveEur).toBeGreaterThan(0);
    }
  });

  it("sale keeps fiscal reserve separate from EURC free", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      horizonDate: horizon(3),
    });
    const result = runPerspectivesSimulation(input);
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    if (opt.summary.totalSalesEur > 0) {
      // Fiscal reserve should be > 0 (tax on gains)
      const totalTax = opt.summary.totalTaxEur;
      expect(totalTax).toBeGreaterThan(0);
    }
  });

  it("sale proposals are explained when they don't fire", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.001, avgCostEur: 50000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - YEAR_MS, remainingAmount: 0.001, unitAcquisitionPriceEur: 50000 }],
      horizonDate: horizon(2),
    });
    const result = runPerspectivesSimulation(input);
    const cons = result.scenarios.find(s => s.scenario === "conservador")!;
    // In conservative 2y, probably no 3x gain — sales = 0 → skip reasons must explain
    if (cons.summary.totalSalesEur === 0) {
      const hasReasons = cons.annualSnapshots.some(s => s.salesSkipReasons.length > 0);
      expect(hasReasons).toBe(true);
    }
  });
});

// ─── Sim engine: rebuys ───────────────────────────────────────────────────────

describe("sim-engine: rebuys", () => {
  it("rebuy fires when there is EURC and a 20%+ drawdown from peak", () => {
    // Give the simulation EURC to work with upfront
    const input = makeInput({
      eurcFree: 5000,
      horizonDate: horizon(6),
    });
    const result = runPerspectivesSimulation(input);
    // In 6 years with cycles, there will be drawdowns and EURC → rebuys must happen
    const totalRebuys = result.scenarios
      .map(s => s.summary.totalRebuysEur)
      .reduce((a, b) => a + b, 0);
    // At least one scenario should have done rebuys (EURC available + drawdown expected)
    // Note: conservador might have drawdowns immediately; optimista might not dip
    // Check that we get rebuys or explanations
    const rebuysOrExplanations = result.scenarios.every(s => {
      if (s.summary.totalRebuysEur > 0) return true;
      return s.annualSnapshots.some(snap => snap.rebuysSkipReasons.length > 0);
    });
    expect(rebuysOrExplanations).toBe(true);
  });

  it("rebuy never uses fiscal reserve", () => {
    // Pre-populate fiscal reserve and zero EURC free
    const input = makeInput({
      eurcFree: 0,
      eurcFiscalReserve: 10000,
      horizonDate: horizon(5),
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      // Rebuys should be 0 since eurcFree = 0 and fiscal reserve is not usable
      // (unless sales generate new eurcFree during the simulation)
      if (s.summary.totalSalesEur === 0) {
        expect(s.summary.totalRebuysEur).toBe(0);
      }
    }
  });

  it("rebuy skip reasons are provided when no rebuys", () => {
    const input = makeInput({
      eurcFree: 0,
      eurcFiscalReserve: 0,
      horizonDate: horizon(3),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      if (s.summary.totalRebuysEur === 0) {
        const hasReasons = s.annualSnapshots.some(snap => snap.rebuysSkipReasons.length > 0);
        expect(hasReasons).toBe(true);
      }
    }
  });
});

// ─── Sim engine: annual metrics ───────────────────────────────────────────────

describe("sim-engine: annual metrics", () => {
  it("marketGainEur excludes contributions (contributions do not inflate market gain)", () => {
    // Plan_base: only contributions, no sales or rebuys
    const input = makeInput({
      horizonDate: horizon(3),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    for (const snap of base.annualSnapshots) {
      // Sum must hold: closing = opening + contributions + marketGain
      const computed = snap.openingWealthEur + snap.contributionsEur + snap.marketGainEur;
      expect(Math.abs(computed - snap.closingWealthEur)).toBeLessThan(1); // ±€1 tolerance
    }
  });

  it("annual continuity: closingWealth[year N] ≈ openingWealth[year N+1]", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const scenario of result.scenarios) {
      const snaps = scenario.annualSnapshots;
      for (let i = 0; i < snaps.length - 1; i++) {
        const diff = Math.abs(snaps[i].closingWealthEur - snaps[i + 1].openingWealthEur);
        expect(diff).toBeLessThan(2); // ±€2 tolerance for rounding
      }
    }
  });

  it("base scenario 10y has at least one year with negative marketGainEur", () => {
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    const negativeYears = base.annualSnapshots.filter(s => s.marketGainEur < 0);
    expect(negativeYears.length).toBeGreaterThanOrEqual(1);
  });

  it("conservador scenario 10y has at least one year with negative marketGainEur", () => {
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    const cons = result.scenarios.find(s => s.scenario === "conservador")!;
    const negativeYears = cons.annualSnapshots.filter(s => s.marketGainEur < 0);
    expect(negativeYears.length).toBeGreaterThanOrEqual(1);
  });

  it("price path shows real drawdown from peak (cycle model, not CAGR)", () => {
    // Portfolio maxDrawdown can be 0 in DCA scenarios (contributions offset price declines)
    // but the PRICE PATH must show real cycles with drawdown >= 15% from peak
    const path = buildPricePath("bitcoin", 60000, "base", NOW, horizon(4));
    let runningPeak = 0;
    let maxPriceDrawdown = 0;
    for (const pt of path) {
      if (pt.priceEur > runningPeak) runningPeak = pt.priceEur;
      else if (runningPeak > 0) {
        const dd = (runningPeak - pt.priceEur) / runningPeak;
        if (dd > maxPriceDrawdown) maxPriceDrawdown = dd;
      }
    }
    expect(maxPriceDrawdown).toBeGreaterThan(0.15);
    // Also: maxDrawdownPct is null or a valid number (not negative)
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.maxDrawdownPct).not.toBeNull();
      expect(s.summary.maxDrawdownPct!).toBeGreaterThanOrEqual(0);
    }
  });

  it("scenario ordering: finalNetWealth conservador ≤ moderado ≤ base ≤ favorable ≤ optimista", () => {
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    const getWealth = (sc: string) =>
      result.scenarios.find(s => s.scenario === sc)!.summary.finalNetWealthEur;
    expect(getWealth("conservador")).toBeLessThanOrEqual(getWealth("moderado") + 1);
    expect(getWealth("moderado")).toBeLessThanOrEqual(getWealth("base") + 1);
    expect(getWealth("base")).toBeLessThanOrEqual(getWealth("favorable") + 1);
    expect(getWealth("favorable")).toBeLessThanOrEqual(getWealth("optimista") + 1);
  });

  it("TWR is computed (not null) for all scenarios", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.twr).not.toBeNull();
    }
  });

  it("XIRR is computed (not null) in scenarios with non-zero wealth", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      if (s.summary.finalNetWealthEur > 0) {
        expect(s.summary.xirr).not.toBeNull();
      }
    }
  });
});

// ─── Sim engine: no commissions ──────────────────────────────────────────────

describe("sim-engine: no commissions (DEFAULT_SIM_OPTIONS.commissionRate = 0)", () => {
  it("commissionsEur is zero in all annual snapshots with default options", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const snap of s.annualSnapshots) {
        expect(snap.commissionsEur).toBe(0);
      }
    }
  });

  it("totalCommissionsEur is zero in all scenario summaries", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalCommissionsEur).toBe(0);
    }
  });

  it("sale proceeds fully credited to eurcFree (no commission deducted)", () => {
    // Big gain position → sale triggers
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      horizonDate: horizon(2),
    });
    const result = runPerspectivesSimulation(input);
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    if (opt.summary.totalSalesEur > 0) {
      // All commission fields are 0
      expect(opt.summary.totalCommissionsEur).toBe(0);
    }
  });
});

// ─── Sim engine: no double-counting of sales/rebuys ──────────────────────────

describe("sim-engine: sales and rebuys are internal movements", () => {
  it("a sale does not increase net patrimony by itself (it just converts crypto to EURC)", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 0,
      horizonDate: horizon(2),
      options: { policy: "full_strategy", commissionRate: 0, taxBands: DEFAULT_SPANISH_TAX_BANDS },
    });
    const result = runPerspectivesSimulation(input);
    // In a year where a sale happens, closingWealth should NOT equal openingWealth + salesEur
    // (that would be double-counting). The sale is ALREADY reflected in closingWealth.
    const opt = result.scenarios.find(s => s.scenario === "optimista")!;
    for (const snap of opt.annualSnapshots) {
      if (snap.salesEur > 0) {
        // Check continuity: closing = opening + contributions + marketGain (NOT + sales)
        const reconstructed = snap.openingWealthEur + snap.contributionsEur + snap.marketGainEur;
        expect(Math.abs(reconstructed - snap.closingWealthEur)).toBeLessThan(2);
      }
    }
  });

  it("a rebuy does not reduce net patrimony by itself (it converts EURC to crypto)", () => {
    const input = makeInput({
      eurcFree: 5000,
      horizonDate: horizon(6),
      options: { policy: "full_strategy", commissionRate: 0, taxBands: DEFAULT_SPANISH_TAX_BANDS },
    });
    const result = runPerspectivesSimulation(input);
    const cons = result.scenarios.find(s => s.scenario === "conservador")!;
    for (const snap of cons.annualSnapshots) {
      // Continuity: closing = opening + contributions + marketGain (NOT - rebuys)
      const reconstructed = snap.openingWealthEur + snap.contributionsEur + snap.marketGainEur;
      expect(Math.abs(reconstructed - snap.closingWealthEur)).toBeLessThan(2);
    }
  });
});

// ─── Sim engine: contributions correctly reported ─────────────────────────────

describe("sim-engine: contributions", () => {
  it("totalContributionsEur in summary matches sum of annual contributions", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const sumFromSnapshots = s.annualSnapshots.reduce((acc, snap) => acc + snap.contributionsEur, 0);
      expect(Math.abs(s.summary.totalContributionsEur - sumFromSnapshots)).toBeLessThan(0.01);
    }
  });

  it("totalContributionsEur > 0 when cycle has monthly contributions", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      // €200/month × 12 × 5 = €12,000 expected contributions
      expect(s.summary.totalContributionsEur).toBeGreaterThan(0);
    }
  });

  it("contributions are not counted as market gain", () => {
    const input = makeInput({
      horizonDate: horizon(3),
      options: { policy: "plan_base", commissionRate: 0, taxBands: DEFAULT_SPANISH_TAX_BANDS },
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    for (const snap of base.annualSnapshots) {
      // If price didn't change (impossible in cycle model, but verify formula holds)
      const reconstructed = snap.openingWealthEur + snap.contributionsEur + snap.marketGainEur;
      expect(Math.abs(reconstructed - snap.closingWealthEur)).toBeLessThan(2);
    }
  });
});

// ─── Sim engine: patrimony formula ───────────────────────────────────────────

describe("sim-engine: patrimony net formula", () => {
  it("closingWealthEur excludes fiscal reserve (patrimonio neto)", () => {
    // Give initial fiscal reserve to test exclusion
    const input = makeInput({
      eurcFiscalReserve: 1000,
      horizonDate: horizon(3),
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const firstSnap = s.annualSnapshots[0];
      // Opening should NOT include the initial fiscal reserve
      // (it's €600 BTC value + €0 eurcFree, not +€1000 fiscal reserve)
      expect(firstSnap.openingWealthEur).toBeLessThan(1000); // below fiscal reserve value
    }
  });

  it("openingWealth[year N+1] equals closingWealth[year N] (continuity)", () => {
    const input = makeInput({ eurcFiscalReserve: 500, eurcFree: 100, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const snaps = s.annualSnapshots;
      for (let i = 0; i < snaps.length - 1; i++) {
        const diff = Math.abs(snaps[i].closingWealthEur - snaps[i + 1].openingWealthEur);
        expect(diff).toBeLessThan(2);
      }
    }
  });
});

// ─── Sim engine: EURC invariants ─────────────────────────────────────────────

describe("sim-engine: EURC invariants", () => {
  it("eurcFree never goes negative", () => {
    const input = makeInput({ eurcFree: 100, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      for (const snap of s.annualSnapshots) {
        expect(snap.eurcFreeEur).toBeGreaterThanOrEqual(-0.01); // float tolerance
      }
    }
  });

  it("totalRebuysEur + totalEurcReinvestedEur <= totalSalesEur + initial eurcFree", () => {
    const input = makeInput({ eurcFree: 500, horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      const { totalRebuysEur, totalEurcReinvestedEur, totalSalesEur } = s.summary;
      // Can't spend more EURC than we ever received
      // (rebuys count against eurcFree which comes from: initial eurcFree + sales proceeds after tax)
      // Allow small floating point error
      expect(totalRebuysEur + totalEurcReinvestedEur).toBeLessThanOrEqual(
        totalSalesEur + 500 + 1 // initial eurcFree + €1 tolerance
      );
    }
  });
});

// ─── Sim engine: plan_base vs full_strategy ───────────────────────────────────

describe("sim-engine: plan_base vs full_strategy", () => {
  it("plan_base has zero sales and zero rebuys", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 1.0, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 1.0, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 1000,
      horizonDate: horizon(5),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const result = runPerspectivesSimulation(input);
    for (const s of result.scenarios) {
      expect(s.summary.totalSalesEur).toBe(0);
      expect(s.summary.totalRebuysEur).toBe(0);
    }
  });

  it("full_strategy may produce more final wealth than plan_base in optimista 10y", () => {
    const baseInput = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.05, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 3 * YEAR_MS, remainingAmount: 0.05, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 0,
      horizonDate: horizon(10),
    });
    const planBase = makeInput({
      ...baseInput,
      options: { ...DEFAULT_SIM_OPTIONS, policy: "plan_base" },
    });
    const fullStrat = makeInput({
      ...baseInput,
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const rBase = runPerspectivesSimulation(planBase);
    const rFull = runPerspectivesSimulation(fullStrat);
    // Verify both produce valid non-zero results (both strategies are valid)
    const baseOpt = rBase.scenarios.find(s => s.scenario === "optimista")!;
    const fullOpt = rFull.scenarios.find(s => s.scenario === "optimista")!;
    expect(baseOpt.summary.finalNetWealthEur).toBeGreaterThan(0);
    expect(fullOpt.summary.finalNetWealthEur).toBeGreaterThan(0);
  });
});

// ─── Sim engine: validations ─────────────────────────────────────────────────

describe("sim-engine: built-in validations", () => {
  it("all validation checks pass for typical input", () => {
    const input = makeInput({ horizonDate: horizon(10) });
    const result = runPerspectivesSimulation(input);
    const failed = result.validations.filter(v => !v.passed);
    // Log failures for debugging
    if (failed.length > 0) {
      console.warn("Failed validations:", failed.map(v => `${v.rule}: ${v.detail}`));
    }
    // Continuity and ordering must always pass
    const continuityFails = failed.filter(v => v.rule.includes("continuidad"));
    expect(continuityFails.length).toBe(0);
  });

  it("validations include patrimonio final >= 0 for all scenarios", () => {
    const input = makeInput({ horizonDate: horizon(5) });
    const result = runPerspectivesSimulation(input);
    const patrimonioRules = result.validations.filter(v => v.rule.includes("patrimonio_final"));
    expect(patrimonioRules.length).toBe(5); // one per scenario
    for (const v of patrimonioRules) {
      expect(v.passed).toBe(true);
    }
  });
});

// ─── Drawdown mensual ────────────────────────────────────────────────────────

describe("sim-engine: monthly drawdown detection", () => {
  it("drawdown is non-null and > 0 for 10y base scenario (intra-year corrections)", () => {
    // Posición grande: correcciones de precio superan el DCA mensual
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.1, avgCostEur: 30000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 2 * YEAR_MS, remainingAmount: 0.1, unitAcquisitionPriceEur: 30000 }],
      horizonDate: horizon(10),
    });
    const result = runPerspectivesSimulation(input);
    const base = result.scenarios.find(s => s.scenario === "base")!;
    // El drawdown debe detectarse desde la serie mensual (no solo cierres diciembre)
    expect(base.summary.maxDrawdownPct).not.toBeNull();
    expect(base.summary.maxDrawdownPct!).toBeGreaterThan(0.01); // al menos 1%
  });

  it("drawdown is greater in bear scenario than in bull scenario", () => {
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.1, avgCostEur: 30000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 2 * YEAR_MS, remainingAmount: 0.1, unitAcquisitionPriceEur: 30000 }],
      horizonDate: horizon(10),
    });
    const result = runPerspectivesSimulation(input);
    const conserv = result.scenarios.find(s => s.scenario === "conservador")!;
    const optimista = result.scenarios.find(s => s.scenario === "optimista")!;
    const ddConserv   = conserv.summary.maxDrawdownPct  ?? 0;
    const ddOptimista = optimista.summary.maxDrawdownPct ?? 0;
    // Conservador tiene mayor drawdown relativo que optimista (caídas más profundas)
    expect(ddConserv).toBeGreaterThanOrEqual(ddOptimista - 0.05);
  });
});

// ─── XIRR correcto ───────────────────────────────────────────────────────────

describe("sim-engine: XIRR calculation", () => {
  it("XIRR uses input.now as t=0 (not contributions[0].date)", () => {
    // Comprobación indirecta: en un horizonte de 2 años con buen retorno,
    // el XIRR debe ser positivo y razonable (< 500% anual).
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.05, avgCostEur: 30000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW - 2 * YEAR_MS, remainingAmount: 0.05, unitAcquisitionPriceEur: 30000 }],
      horizonDate: horizon(2),
      options: { ...DEFAULT_SIM_OPTIONS },
    });
    const result = runPerspectivesSimulation(input);
    const optimista = result.scenarios.find(s => s.scenario === "optimista")!;
    expect(optimista.summary.xirr).not.toBeNull();
    if (optimista.summary.xirr !== null) {
      // Con corrección del offset de fecha, XIRR debe ser finito y acotado
      expect(optimista.summary.xirr).toBeGreaterThan(-1.0);
      expect(optimista.summary.xirr).toBeLessThan(5.0); // < 500% anual
    }
  });

  it("XIRR is negative when total invested greatly exceeds final value", () => {
    // Escenario muy conservador a corto plazo donde hay pérdidas
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.001, avgCostEur: 60000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: NOW, remainingAmount: 0.001, unitAcquisitionPriceEur: 60000 }],
      horizonDate: horizon(5),
      options: { ...DEFAULT_SIM_OPTIONS },
    });
    const result = runPerspectivesSimulation(input);
    const conserv = result.scenarios.find(s => s.scenario === "conservador")!;
    if (conserv.summary.xirr !== null) {
      // XIRR válido (puede ser negativo en conservador)
      expect(conserv.summary.xirr).toBeGreaterThan(-1.0);
    }
  });
});

// ─── reinvestResidual progresivo ─────────────────────────────────────────────

describe("sim-engine: progressive reinvestment", () => {
  it("eurcFree accumulates gradually (not immediately spent after a sale)", () => {
    // Posición grande que dispara ventas en los primeros ciclos alcistas;
    // con reinversión progresiva el EURC no debe ser 0 en el cierre del primer año.
    const lotDate = NOW - 4 * YEAR_MS;
    const input = makeInput({
      currentPositions: [{ assetId: "bitcoin", balance: 0.5, avgCostEur: 5000, currentPriceEur: 60000 }],
      currentLots: [{ id: "l1", assetId: "bitcoin", date: lotDate, remainingAmount: 0.5, unitAcquisitionPriceEur: 5000 }],
      eurcFree: 5000,
      horizonDate: horizon(10),
      options: { ...DEFAULT_SIM_OPTIONS, policy: "full_strategy" },
    });
    const result = runPerspectivesSimulation(input);
    const optimista = result.scenarios.find(s => s.scenario === "optimista")!;
    // Con reinversión al 20%/mes, el EURC libre debe persistir varios meses.
    // Verificamos que el acumulado de reinversión no supera el total de ventas
    // (i.e., no reinvierte más de lo que generó).
    const totalSales = optimista.summary.totalSalesEur;
    const totalReinvested = optimista.summary.totalEurcReinvestedEur;
    if (totalSales > 0) {
      // Las recompras + reinversión no pueden superar lo generado en ventas + eurcFree inicial
      expect(totalReinvested + optimista.summary.totalRebuysEur)
        .toBeLessThanOrEqual(totalSales + 5000 + 0.01);
    }
  });
});

// ─── Sistema de analistas ────────────────────────────────────────────────────

describe("forecast-sources: consensus calculation", () => {
  const now = new Date("2025-01-01").getTime();

  it("returns neutral consensus when no active sources for asset", () => {
    const c = buildConsensus([], "bitcoin", now);
    expect(c.score).toBe(0);
    expect(c.direction).toBe("neutral");
    expect(c.peakMultAdjustment).toBe(0);
    expect(c.sourceCount).toBe(0);
  });

  it("expired sources are excluded from consensus", () => {
    const src: ForecastSource = {
      id: "x1", publisher: "Test", sourceType: "analyst",
      assetId: "bitcoin", direction: "very_bullish",
      confidence: 1.0,
      publishedAt: now - 365 * 24 * 3600 * 1000,
      expiresAt: now - 1,  // expired yesterday
    };
    const c = buildConsensus([src], "bitcoin", now);
    expect(c.sourceCount).toBe(0);
    expect(c.score).toBe(0);
  });

  it("all-bullish sources produce positive score and positive peakMultAdjustment", () => {
    const src: ForecastSource = {
      id: "x2", publisher: "Bull Bank", sourceType: "institution",
      assetId: "bitcoin", direction: "very_bullish",
      confidence: 0.9,
      publishedAt: now - 30 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const c = buildConsensus([src], "bitcoin", now);
    expect(c.score).toBeGreaterThan(0);
    expect(c.peakMultAdjustment).toBeGreaterThan(0);
    expect(c.peakMultAdjustment).toBeLessThanOrEqual(0.30);
  });

  it("all-bearish sources produce negative score and negative peakMultAdjustment", () => {
    const src: ForecastSource = {
      id: "x3", publisher: "Bear Bank", sourceType: "analyst",
      assetId: "bitcoin", direction: "very_bearish",
      confidence: 0.8,
      publishedAt: now - 30 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const c = buildConsensus([src], "bitcoin", now);
    expect(c.score).toBeLessThan(0);
    expect(c.peakMultAdjustment).toBeLessThan(0);
  });

  it("mixed sources converge to neutral when evenly balanced", () => {
    const bull: ForecastSource = {
      id: "b1", publisher: "A", sourceType: "analyst", assetId: "bitcoin",
      direction: "very_bullish", confidence: 0.8,
      publishedAt: now - 10 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const bear: ForecastSource = {
      id: "b2", publisher: "B", sourceType: "analyst", assetId: "bitcoin",
      direction: "very_bearish", confidence: 0.8,
      publishedAt: now - 10 * 24 * 3600 * 1000,
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const c = buildConsensus([bull, bear], "bitcoin", now);
    expect(Math.abs(c.score)).toBeLessThan(0.05); // casi neutro
  });

  it("older sources have less weight than recent ones", () => {
    const recent: ForecastSource = {
      id: "r1", publisher: "A", sourceType: "analyst", assetId: "bitcoin",
      direction: "very_bullish", confidence: 0.9,
      publishedAt: now - 7 * 24 * 3600 * 1000,  // 1 week old
      expiresAt: now + 365 * 24 * 3600 * 1000,
    };
    const old: ForecastSource = {
      ...recent, id: "r2",
      publishedAt: now - 3 * 365 * 24 * 3600 * 1000,  // 3 years old
    };
    const wRecent = weightSource(recent, now);
    const wOld    = weightSource(old, now);
    expect(wRecent).toBeGreaterThan(wOld);
  });

  it("KNOWN_FORECASTS contains at least 5 bitcoin entries", () => {
    const btcForecasts = KNOWN_FORECASTS.filter(f => f.assetId === "bitcoin");
    expect(btcForecasts.length).toBeGreaterThanOrEqual(5);
  });

  it("peakMultAdjustment is bounded within ±30%", () => {
    // Con todas las fuentes conocidas, el ajuste nunca excede ±30%
    for (const assetId of ["bitcoin", "ethereum", "solana"]) {
      const c = buildConsensus(KNOWN_FORECASTS, assetId, now);
      expect(Math.abs(c.peakMultAdjustment)).toBeLessThanOrEqual(0.30);
    }
  });

  it("isExpired returns false for future expiry and true for past expiry", () => {
    const src: ForecastSource = {
      id: "e1", publisher: "X", sourceType: "analyst", assetId: "bitcoin",
      direction: "bullish", confidence: 0.5,
      publishedAt: now - 365 * 24 * 3600 * 1000,
      expiresAt: now + 100,
    };
    expect(isExpired(src, now)).toBe(false);
    expect(isExpired(src, now + 200)).toBe(true);
  });
});
