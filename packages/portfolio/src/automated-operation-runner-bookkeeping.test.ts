import { describe, expect, it } from "vitest";
import {
  AutomatedOperationRunner,
  type AutomationRunRecord,
} from "./automated-operation-runner";
import type {
  AutomatedOperationPolicy,
  AutomatedOperationProposal,
  AutomatedOperationState,
  AutomationMarketContext,
} from "./automated-operations";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

const policy: AutomatedOperationPolicy = {
  id: "bookkeeping-policy",
  kind: "BULL_PARTIAL_SALE",
  assetId: "BTC",
  cycleId: "cycle-1",
  planId: "plan-1",
  goalId: "goal-1",
  enabled: true,
  simulationOnly: false,
  createdAt: NOW - 10_000,
  startsAt: NOW - 10_000,
  expiresAt: NOW + 100_000,
  cooldownHours: 24,
  maxExecutions: 3,
  executionCount: 0,
  lastExecutedAt: null,
  minConfidence: 70,
  minIndependentSources: 3,
  requireCompleteData: true,
  maxMarketDataAgeMinutes: 10,
  maxOperationEur: 5_000,
  bull: {
    allowedRegimes: ["EUPHORIA"],
    minimumUnrealizedGainPct: 50,
    minimumSentimentScore: 50,
    sellPercentage: 10,
    minimumResidualPositionPct: 50,
  },
  authorization: {
    enabled: true,
    autoExecute: true,
    authorizedAt: NOW - 10_000,
    expiresAt: NOW + 100_000,
    authorizationVersion: "v1",
    maxSingleOperationEur: 5_000,
    maxDailyOperations: 3,
    maxDailyNotionalEur: 10_000,
  },
};

const context: AutomationMarketContext = {
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

describe("AutomatedOperationRunner bookkeeping isolation", () => {
  it("keeps a completed Coinbase order completed when the policy counter update fails", async () => {
    let record: AutomationRunRecord | null = null;
    const repository = {
      listEnabledPolicies: () => [policy],
      claimProposal: (id: string, proposal: AutomatedOperationProposal) => {
        record = {
          id,
          policyId: proposal.policyId,
          idempotencyKey: proposal.idempotencyKey,
          state: proposal.state,
          proposal,
          previewToken: null,
          previewId: null,
          orderIds: [],
        };
        return record;
      },
      updateRun: (input: { id: string; state: AutomatedOperationState; previewToken?: string | null; previewId?: string | null; orderIds?: string[] }) => {
        if (!record) throw new Error("run missing");
        record = {
          ...record,
          state: input.state,
          previewToken: input.previewToken !== undefined ? input.previewToken : record.previewToken,
          previewId: input.previewId !== undefined ? input.previewId : record.previewId,
          orderIds: input.orderIds ?? record.orderIds,
        };
        return record;
      },
      markPolicyExecuted: () => {
        throw new Error("simulated bookkeeping failure");
      },
    };
    const runner = new AutomatedOperationRunner({
      repository,
      buildContext: async () => context,
      preview: async () => ({ previewToken: "preview-token", previewId: "preview-id", expiresAt: NOW + 60_000, notionalEur: 5_000 }),
      submit: async () => ({ orderIds: ["coinbase-order-1"], completed: true }),
      now: () => NOW,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const result = await runner.runOnce();

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.bookkeepingWarnings).toBe(1);
    expect(result.records[0].state).toBe("COMPLETED");
    expect(result.records[0].orderIds).toEqual(["coinbase-order-1"]);
  });
});
