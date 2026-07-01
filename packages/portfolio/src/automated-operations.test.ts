import { describe, expect, it } from "vitest";
import {
  evaluateAutomatedOperation,
  isProposalExecutable,
  type AutomatedOperationPolicy,
  type AutomationMarketContext,
} from "./automated-operations";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

function authorization(autoExecute = true) {
  return {
    enabled: true,
    autoExecute,
    authorizedAt: NOW - 86_400_000,
    expiresAt: NOW + 365 * 86_400_000,
    authorizationVersion: "v1",
    maxSingleOperationEur: 10_000,
    maxDailyOperations: 4,
    maxDailyNotionalEur: 20_000,
  };
}

function commonContext(): AutomationMarketContext {
  return {
    evaluatedAt: NOW,
    assetId: "BTC",
    currentPriceEur: 120_000,
    referencePriceEur: 100_000,
    assetUnits: 1,
    assetMarketValueEur: 120_000,
    assetCostBasisEur: 60_000,
    totalPortfolioValueEur: 150_000,
    operatingEurcEur: 30_000,
    fiscalReserveEur: 5_000,
    cashEur: 0,
    regime: "EUPHORIA",
    sentimentDirection: "very_bullish",
    sentimentScore: 74,
    confidence: 88,
    independentSourceCount: 8,
    dataState: "live",
    newestMarketDataAt: NOW - 60_000,
    missingSignals: [],
    stabilizationScore: 70,
    executionsToday: 0,
    notionalExecutedTodayEur: 0,
    goal: {
      goalId: "goal-1",
      targetValueEur: 250_000,
      currentProjectedValueEur: 150_000,
      targetDate: Date.UTC(2032, 0, 1),
      reached: false,
    },
  };
}

function bullPolicy(): AutomatedOperationPolicy {
  return {
    id: "sell-btc-euphoria",
    kind: "BULL_PARTIAL_SALE",
    assetId: "BTC",
    cycleId: "cycle-1",
    planId: "plan-1",
    goalId: "goal-1",
    enabled: true,
    simulationOnly: false,
    createdAt: NOW - 86_400_000,
    startsAt: NOW - 86_400_000,
    expiresAt: NOW + 365 * 86_400_000,
    cooldownHours: 24,
    maxExecutions: 4,
    executionCount: 0,
    lastExecutedAt: null,
    minConfidence: 70,
    minIndependentSources: 4,
    requireCompleteData: true,
    maxMarketDataAgeMinutes: 15,
    maxOperationEur: 15_000,
    bull: {
      allowedRegimes: ["BULL_EXPANSION", "EUPHORIA", "DISTRIBUTION"],
      minimumUnrealizedGainPct: 50,
      minimumSentimentScore: 55,
      sellPercentage: 10,
      minimumResidualPositionPct: 50,
    },
    authorization: authorization(true),
  };
}

function bearPolicy(): AutomatedOperationPolicy {
  return {
    ...bullPolicy(),
    id: "rebuy-btc-bear",
    kind: "BEAR_REBUY",
    bull: undefined,
    bear: {
      allowedRegimes: ["CORRECTION", "BEAR_MARKET", "CAPITULATION", "EARLY_RECOVERY"],
      minimumDrawdownPct: 20,
      maximumSentimentScore: -20,
      rebuyPercentageOfFreeEurc: 25,
      minimumStabilizationScore: 55,
    },
  };
}

describe("automated operation guard", () => {
  it("prepares a capped partial sale during a validated bull regime", () => {
    const proposal = evaluateAutomatedOperation(bullPolicy(), commonContext());

    expect(proposal.state).toBe("READY_TO_PREVIEW");
    expect(proposal.operationType).toBe("sell");
    expect(proposal.amountEur).toBe(10_000);
    expect(proposal.baseUnits).toBeCloseTo(0.08333333, 8);
    expect(isProposalExecutable(proposal)).toBe(true);
  });

  it("blocks real execution when market inputs are partial", () => {
    const context = { ...commonContext(), dataState: "partial" as const, missingSignals: ["Volumen"] };
    const proposal = evaluateAutomatedOperation(bullPolicy(), context);

    expect(proposal.state).toBe("BLOCKED_DATA");
    expect(proposal.blockers.join(" ")).toMatch(/parciales/);
    expect(isProposalExecutable(proposal)).toBe(false);
  });

  it("uses only free EURC and never the fiscal reserve for a staged rebuy", () => {
    const context: AutomationMarketContext = {
      ...commonContext(),
      currentPriceEur: 70_000,
      referencePriceEur: 100_000,
      regime: "EARLY_RECOVERY",
      sentimentDirection: "bearish",
      sentimentScore: -35,
      stabilizationScore: 72,
      operatingEurcEur: 30_000,
      fiscalReserveEur: 5_000,
    };
    const proposal = evaluateAutomatedOperation(bearPolicy(), context);

    expect(proposal.state).toBe("READY_TO_PREVIEW");
    expect(proposal.operationType).toBe("rebuy");
    expect(proposal.amountEur).toBe(6_250);
    expect(proposal.fiscalReserveExcludedEur).toBe(5_000);
    expect(proposal.drawdownPct).toBe(30);
  });

  it("requires review when automatic authorization is not enabled", () => {
    const policy = bullPolicy();
    policy.authorization = authorization(false);
    const proposal = evaluateAutomatedOperation(policy, commonContext());

    expect(proposal.state).toBe("REVIEW_REQUIRED");
    expect(proposal.requiresUserAuthorization).toBe(true);
  });
});
