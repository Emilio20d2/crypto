import { afterEach, describe, expect, it } from "vitest";
import type { AutomatedOperationPolicy, AutomatedOperationProposal } from "@crypto-control/portfolio";
import { closeDatabase, initializeDatabase } from "./db";
import { DatabaseAutomatedOperationRepository } from "./automated-operation-repository";

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);

function makePolicy(): AutomatedOperationPolicy {
  return {
    id: "policy-test",
    kind: "BULL_PARTIAL_SALE",
    assetId: "BTC",
    cycleId: "cycle-1",
    planId: "plan-1",
    goalId: "goal-1",
    enabled: true,
    simulationOnly: false,
    createdAt: NOW - 1_000,
    startsAt: NOW - 1_000,
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
      authorizedAt: NOW - 1_000,
      expiresAt: NOW + 100_000,
      authorizationVersion: "v1",
      maxSingleOperationEur: 5_000,
      maxDailyOperations: 3,
      maxDailyNotionalEur: 10_000,
    },
  };
}

function makeProposal(): AutomatedOperationProposal {
  return {
    policyId: "policy-test",
    idempotencyKey: "policy-test:2026-07-01:1",
    kind: "BULL_PARTIAL_SALE",
    state: "READY_TO_PREVIEW",
    assetId: "BTC",
    cycleId: "cycle-1",
    planId: "plan-1",
    goalId: "goal-1",
    evaluatedAt: NOW,
    operationType: "sell",
    amountEur: 5_000,
    baseUnits: 0.05,
    percentage: 5,
    fundingSource: "CRYPTO",
    fiscalReserveExcludedEur: 0,
    currentPriceEur: 100_000,
    referencePriceEur: 80_000,
    drawdownPct: null,
    unrealizedGainPct: 100,
    reasons: ["test"],
    blockers: [],
    requiresFreshPreview: true,
    requiresUserAuthorization: false,
    simulationOnly: false,
  };
}

afterEach(() => {
  closeDatabase();
});

describe("DatabaseAutomatedOperationRepository", () => {
  it("persists a policy and enforces the execution state machine", () => {
    initializeDatabase(":memory:");
    const repository = new DatabaseAutomatedOperationRepository();
    repository.upsertPolicy("Venta BTC", makePolicy());

    const claimed = repository.claimProposal("run-1", makeProposal());
    repository.updateRun({ id: claimed.id, state: "PREVIEWING" });
    repository.updateRun({ id: claimed.id, state: "READY_TO_SUBMIT", previewToken: "token", previewId: "preview" });
    const completed = repository.updateRun({ id: claimed.id, state: "COMPLETED", orderIds: ["order-1"], completed: true });

    expect(completed.state).toBe("COMPLETED");
    expect(completed.orderIds).toEqual(["order-1"]);
    expect(() => repository.updateRun({ id: claimed.id, state: "PREVIEWING" })).toThrow(/Invalid automated operation transition/);
  });

  it("returns the existing run for a repeated idempotency key", () => {
    initializeDatabase(":memory:");
    const repository = new DatabaseAutomatedOperationRepository();
    repository.upsertPolicy("Venta BTC", makePolicy());

    const first = repository.claimProposal("run-1", makeProposal());
    const second = repository.claimProposal("run-2", { ...makeProposal(), amountEur: 4_500 });

    expect(second.id).toBe(first.id);
    expect(second.notionalEur).toBe(4_500);
  });
});
