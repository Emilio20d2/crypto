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

  constructor(public policies: AutomatedOperationPolicy[]) {}

  listEnabledPolicies() {
    return this.policies.filter((item) => item.enabled);
  }

  claimProposal(runId: string, proposal: AutomatedOperationProposal): AutomationRunRecord {
    const existing = [...this.records.values()].find((record) => record.idempotencyKey === proposal.idempotencyKey);
    if (existing) {
      const retryable = new Set<AutomatedOperationState>(["SCHEDULED", "MONITORING", "BLOCKED_DATA", "BLOCKED_RISK", "REVIEW_REQUIRED", "READY_TO_PREVIEW"]);
      if (retryable.has(existing.state)) {
        const refreshed = { ...existing, state: proposal.state, proposal };
        this.records.set(existing.id, refreshed);
        return refreshed;
      }
      return existing;
    }
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

  markPolicyExecuted(policyId: string, executedAt: number): void {
    const current = this.policies.find((item) => item.id === policyId);
    if (!current) return;
    current.executionCount += 1;
    current.lastExecutedAt = executedAt;
  }
}

describe("AutomatedOperationRunner", () => {
  it("previews, submits and persists the final state once", async () => {
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

    const first = await runner.runOnce();
    const second = await runner.runOnce();

    expect(first.completed).toBe(1);
    expect(first.records[0].state).toBe("COMPLETED");
    expect(previewCalls).toBe(1);
    expect(submitCalls).toBe(1);
    expect(repository.policies[0].executionCount).toBe(1);
    expect(second.blocked).toBe(1);
  });

  it("stores review-required proposals without requesting a preview", async () => {
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

  it("does not submit when a preview exceeds the authorized proposal", async () => {
    const repository = new MemoryRepository([policy(true)]);
    let submitCalls = 0;
    const runner = new AutomatedOperationRunner({
      repository,
      buildContext: async () => context(),
      preview: async () => ({ previewToken: "token-oversized", previewId: "preview-oversized", expiresAt: NOW + 60_000, notionalEur: 9_000 }),
      submit: async () => {
        submitCalls += 1;
        return { orderIds: ["should-not-exist"], completed: true };
      },
      now: () => NOW,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const result = await runner.runOnce();
    expect(result.failed).toBe(1);
    expect(result.records[0].state).toBe("FAILED");
    expect(submitCalls).toBe(0);
  });

  it("does not resubmit an already completed idempotency key", async () => {
    const storedPolicy = policy(true);
    const repository = new MemoryRepository([storedPolicy]);
    const proposal = {
      policyId: storedPolicy.id,
      idempotencyKey: `${storedPolicy.id}:2026-07-01:1`,
      kind: storedPolicy.kind,
      state: "READY_TO_PREVIEW" as const,
      assetId: storedPolicy.assetId,
      cycleId: storedPolicy.cycleId,
      planId: storedPolicy.planId,
      goalId: storedPolicy.goalId,
      evaluatedAt: NOW,
      operationType: "sell" as const,
      amountEur: 8_000,
      baseUnits: 0.08,
      percentage: 8,
      fundingSource: "CRYPTO" as const,
      fiscalReserveExcludedEur: 0,
      currentPriceEur: 100_000,
      referencePriceEur: 80_000,
      drawdownPct: null,
      unrealizedGainPct: 100,
      reasons: [],
      blockers: [],
      requiresFreshPreview: true as const,
      requiresUserAuthorization: false,
      simulationOnly: false,
    };
    const existing = repository.claimProposal(`auto:${proposal.idempotencyKey}`, proposal);
    repository.updateRun({ id: existing.id, state: "COMPLETED", orderIds: ["order-existing"] });

    let submitCalls = 0;
    const runner = new AutomatedOperationRunner({
      repository,
      buildContext: async () => context(),
      preview: async () => ({ previewToken: "unused", previewId: null, expiresAt: NOW + 60_000, notionalEur: 8_000 }),
      submit: async () => {
        submitCalls += 1;
        return { orderIds: ["duplicate"], completed: true };
      },
      now: () => NOW,
    });

    const result = await runner.runOnce();
    expect(result.deduplicated).toBe(1);
    expect(submitCalls).toBe(0);
  });
});
