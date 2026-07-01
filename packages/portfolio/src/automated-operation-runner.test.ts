import { describe, expect, it } from "vitest";
import {
  AutomatedOperationRunner,
  type AutomatedOperationRunRepository,
  type AutomationRunRecord,
} from "./automated-operation-runner";
import type {
  AutomatedOperationPolicy,
  AutomatedOperationProposal,
  AutomatedOperationState,
  AutomationMarketContext,
} from "./automated-operations";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

function policy(autoExecute: boolean): AutomatedOperationPolicy {
  return {
    id: "policy-btc-sell",
    kind: "BULL_PARTIAL_SALE",
    assetId: "BTC",
    cycleId: "cycle-1",
    planId: "plan-1",
    goalId: "goal-1",
    enabled: true,
    simulationOnly: false,
    createdAt: NOW - 1,
    startsAt: NOW - 1,
    expiresAt: NOW + 1_000_000,
    cooldownHours: 24,
    maxExecutions: 3,
    executionCount: 0,
    lastExecutedAt: null,
    minConfidence: 60,
    minIndependentSources: 3,
    requireCompleteData: true,
    maxMarketDataAgeMinutes: 10,
    maxOperationEur: 8_000,
    bull: {
      allowedRegimes: ["EUPHORIA"],
      minimumUnrealizedGainPct: 50,
      minimumSentimentScore: 55,
      sellPercentage: 10,
      minimumResidualPositionPct: 50,
    },
    authorization: {
      enabled: true,
      autoExecute,
      authorizedAt: NOW - 1,
      expiresAt: NOW + 1_000_000,
      authorizationVersion: "v1",
      maxSingleOperationEur: 10_000,
      maxDailyOperations: 3,
      maxDailyNotionalEur: 20_000,
    },
  };
}

function context(): AutomationMarketContext {
  return {
    evaluatedAt: NOW,
    assetId: "BTC",
    currentPriceEur: 100_000,
    referencePriceEur: 80_000,
    assetUnits: 1,
    assetMarketValueEur: 100_000,
    assetCostBasisEur: 50_000,
    totalPortfolioValueEur: 120_000,
    operatingEurcEur: 0,
    fiscalReserveEur: 0,
    cashEur: 0,
    regime: "EUPHORIA",
    sentimentDirection: "very_bullish",
    sentimentScore: 70,
    confidence: 90,
    independentSourceCount: 6,
    dataState: "live",
    newestMarketDataAt: NOW - 30_000,
    missingSignals: [],
    stabilizationScore: 70,
    executionsToday: 0,
    notionalExecutedTodayEur: 0,
    goal: {
      goalId: "goal-1",
      targetValueEur: 250_000,
      currentProjectedValueEur: 120_000,
      targetDate: null,
      reached: false,
    },
  };
}

class MemoryRepository implements AutomatedOperationRunRepository {
  records = new Map<string, AutomationRunRecord>();

  constructor(private policies: AutomatedOperationPolicy[]) {}

  listEnabledPolicies() {
    return this.policies;
  }

  claimProposal(runId: string, proposal: AutomatedOperationProposal): AutomationRunRecord {
    const existing = [...this.records.values()].find((record) => record.idempotencyKey === proposal.idempotencyKey);
    if (existing) return existing;
    const record: AutomationRunRecord = {
      id: runId,
      policyId: proposal.policyId,
      idempotencyKey: proposal.idempotencyKey,
      state: proposal.state,
      proposal,
      previewToken: null,
      previewId: null,
      orderIds: [],
    };
    this.records.set(record.id, record);
    return record;
  }

  updateRun(input: {
    id: string;
    state: AutomatedOperationState;
    previewToken?: string | null;
    previewId?: string | null;
    orderIds?: string[];
  }): AutomationRunRecord {
    const current = this.records.get(input.id)!;
    const updated = {
      ...current,
      state: input.state,
      previewToken: input.previewToken !== undefined ? input.previewToken : current.previewToken,
      previewId: input.previewId !== undefined ? input.previewId : current.previewId,
      orderIds: input.orderIds ?? current.orderIds,
    };
    this.records.set(input.id, updated);
    return updated;
  }
}

describe("AutomatedOperationRunner", () => {
  it("previews and submits an authorized operation exactly once per cycle", async () => {
    const repository = new MemoryRepository([policy(true)]);
    let previewCalls = 0;
    let submitCalls = 0;
    const runner = new AutomatedOperationRunner({
      repository,
      buildContext: async () => context(),
      preview: async () => {
        previewCalls += 1;
        return { previewToken: "token-1", previewId: "preview-1", expiresAt: NOW + 60_000, notionalEur: 8_000 };
      },
      submit: async () => {
        submitCalls += 1;
        return { orderIds: ["order-1"], completed: true };
      },
      now: () => NOW,
    });

    const result = await runner.runOnce();
    expect(result.completed).toBe(1);
    expect(previewCalls).toBe(1);
    expect(submitCalls).toBe(1);
    expect(result.records[0].idempotencyKey).toContain("policy-btc-sell");
  });

  it("stores review-required proposals without submitting an order", async () => {
    const repository = new MemoryRepository([policy(false)]);
    let previewCalls = 0;
    const runner = new AutomatedOperationRunner({
      repository,
      buildContext: async () => context(),
      preview: async () => {
        previewCalls += 1;
        return { previewToken: "unused", previewId: null, expiresAt: NOW + 60_000, notionalEur: 8_000 };
      },
      submit: async () => ({ orderIds: [], completed: false }),
      now: () => NOW,
    });

    const result = await runner.runOnce();
    expect(result.reviewRequired).toBe(1);
    expect(previewCalls).toBe(0);
  });
});
