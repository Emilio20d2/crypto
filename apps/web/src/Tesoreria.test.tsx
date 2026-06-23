import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Tesoreria } from "./pages/Tesoreria";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function ok<T>(data: T) {
  return Promise.resolve({ ok: true as const, data });
}

beforeEach(() => {
  const now = Date.now();
  window.cryptoControl = {
    assets: { list: () => ok([]) },
    market: {
      getCurrentPrice: () => ok({ price: null, state: "unavailable" as const, provider: "mock", fetchedAt: now }),
      getHistoricalPrices: () => ok({ points: [], provider: "mock", requestedPeriod: "24h", actualInterval: "1h", fetchedAt: now, isCached: false }),
      getOverview: () => ok({ price: null, change24h: null, high24h: null, low24h: null, volume24h: null, volumeChange24h: null, marketCap: null, dominance: null, fetchedAt: null, provider: "mock" }),
      getFearGreed: () => ok({ value: 50, label: "Neutral", timestamp: now, fetchedAt: now, isCached: false }),
      getGlobalMetrics: () => ok({ btcDominance: null, ethDominance: null, totalMarketCapUsd: null, totalVolumeUsd: null, marketCapChangePercentage24h: null, fetchedAt: now, isCached: false }),
      getCryptoControlIndex: async () => ({ ok: true as const, data: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock", calculatedAt: Date.now() } }),
    },
    portfolio: {
      getSummary: () => ok({ totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "empty" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null }),
      getPositions: () => ok({}),
      getAllocation: () => ok([]),
      getRealizedGains: () => ok([]),
      getFifoLots: () => ok([]),
      getHistoricalSeries: () => ok({ points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } }),
      backfillCostBasis: async () => ({ ok: true as const, data: { legsChecked: 0, legsBackfilled: 0, legsStillPending: 0, byAsset: {} } }),
    },
    diagnostics: {
      getReport: async () => ({ ok: true as const, data: { accounts: 0, balances: 0, transactions: 0, conversions: 0, fees: 0, assets: 0, positions: 0, historicalPrices: 0, missingPrices: 0, missingCosts: 0, perAsset: [] } }),
    },
    transactions: {
      list: () => ok([]),
      create: () => ok({}),
      update: () => ok(null),
      delete: () => ok(null),
    },
    settings: {
      get: () => ok(null),
      update: () => ok(null),
    },
    coinbase: {
      importCredentialsFile: () => ok({ connected: false, canceled: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: false, canTrade: false, canTransfer: false } }),
      connectFromJson: () => ok({ connected: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: true, canTrade: false, canTransfer: false } }),
      connect: () => ok({ connected: true }),
      disconnect: () => ok(null),
      getStatus: () => ok({ connected: false, lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null }),
      sync: () => ok({ itemsProcessed: 0, newTransactions: 0, skippedDuplicates: 0 }),
      getSyncHistory: () => ok([]),
      listPortfolios: () => ok([]),
      getPortfolioBreakdown: () => ok({}),
      getPortfolioSnapshots: () => ok([]),
      previewOrder: () => ok({ preview_id: "preview-1" }),
      submitOrder: () => ok({ success: true }),
      listPendingOrders: () => ok([]),
      listScheduledOperations: () => ok([]),
      createScheduledOperation: () => ok({ id: "scheduled-1" }),
      deleteScheduledOperation: () => ok(null),
    },
    sentiment: {
      getGlobal: () => ok({ scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: now, validUntil: null, state: "unavailable" as const }),
      getAsset: () => ok({ scope: "asset" as const, assetId: "BTC", direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: now, validUntil: null, state: "unavailable" as const }),
      getHistory: () => ok([]),
      refresh: () => ok({ scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: now, validUntil: null, state: "unavailable" as const }),
    },
    targets: {
      list: () => ok([]),
      upsert: () => ok({ id: "mock-target" }),
      delete: () => ok(null),
    },
    alerts: {
      list: () => ok([]),
      create: () => ok({ id: "mock-alert" }),
      delete: () => ok(null),
      toggle: () => ok(null),
    },
    investmentPlan: {
      list: () => ok([]),
      getActive: () => ok(null),
      create: () => ok({ id: "mock-plan" }),
      update: () => ok({ id: "mock-plan", name: "Plan", status: "active" as const, baseCurrency: "EUR", notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 }),
      delete: () => ok(null),
    },
    investmentCycles: {
      getMetrics: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", monthsElapsed: 0, monthsRemaining: null, percentComplete: null, expectedContributionMonthly: 0, expectedContributionAnnual: 0, expectedContributionToDate: 0, expectedContributionTotal: null, actualContribution: 0, contributionDifference: 0, extraContribution: 0, contributionCompliancePercentage: null, monthlyContributions: [], currentValueEur: 0, heldCostBasisEur: 0, profitEur: 0, roiPercentage: null, hasPendingValuation: false } }),
      listPartialSales: async () => ({ ok: true as const, data: [] }),
      createPartialSale: async () => ({ ok: true as const, data: { id: "mock-sale", cycleId: "mock-cycle", transactionId: "mock-tx", assetId: "BTC", percentageOfHolding: 10, proceedsEur: 100, date: 0, notes: null, createdAt: 0 } }),
      deletePartialSale: async () => ({ ok: true as const, data: null }),
      list: () => ok([]),
      getCurrent: async () => ({ ok: true as const, data: null }),
      create: () => ok({ id: "mock-cycle" }),
      update: () => ok({ id: "mock-cycle", planId: "mock-plan", name: "Ciclo", startDate: 0, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned" as const, priority: 0, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 }),
      delete: () => ok(null),
    },
    investmentAssets: {
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, tendencia: null, riesgoNivel: "bajo" as const, estadoEstrategico: "buena" as const, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
      list: () => ok([]),
      create: () => ok({ id: "mock-investment-asset" }),
      update: () => ok({ id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 }),
      pause: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "paused" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      close: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "closed" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      markGoalReached: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: 0, status: "goal_reached" as const, isActive: false, notes: null, goalReachedAt: 0, goalReachedValue: null, goalReachedType: null, allowExtraContributions: false, createdAt: 0, updatedAt: 0 } }),
      reactivate: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      delete: () => ok(null),
    },
    strategyRevisions: {
      list: () => ok([]),
      create: () => ok({ id: "mock-revision" }),
    },
    contributionSchedule: {
      list:    async () => ({ ok: true as const, data: [] }),
      create:  async () => ({ ok: true as const, data: { id: "mock-contribution" } }),
      update:  async () => ({ ok: true as const, data: [] as never }),
      execute: async () => ({ ok: true as const, data: [] as never }),
      delete:  async () => ({ ok: true as const, data: null }),
      getMonthlySummary: async () => ({ ok: true as const, data: { summaries: [], aggregates: { cycleId: "mock-cycle", totalPlannedEur: 0, totalActualEur: 0, totalScheduledPortionEur: 0, totalExtraordinaryEur: 0, totalDeficitEur: 0, compliancePercentage: null, monthsCumplida: 0, monthsParcial: 0, monthsOmitida: 0, monthsSuperada: 0, lastContributionDate: null, nextScheduledDate: null } } }),
    },
    assetSubstitutions: {
      list:    async () => ({ ok: true as const, data: [] }),
      create:  async () => ({ ok: true as const, data: { id: "mock-substitution" } }),
      update:  async (): Promise<any> => ({ ok: true as const, data: {} }),
      apply:   async () => ({ ok: true as const, data: { fromInvestmentAssetId: null, toInvestmentAssetId: null } }),
      cancel:  async (): Promise<any> => ({ ok: true as const, data: {} }),
      execute: async () => ({ ok: true as const, data: { fromInvestmentAssetId: null, toInvestmentAssetId: null } }),
      delete:  async () => ({ ok: true as const, data: null }),
    },
    strategicAlerts: {
      generate: async () => ({ ok: true as const, data: [] }),
    },
    strategicDecisions: {
      getCycleReport: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", marketPhase: { phase: "incertidumbre" as const, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock" }, partialSaleProposals: [], rebuyProposals: [], riskSummary: [], adaptationSuggestions: [], generatedAt: 0 } }),
    },
    perspectives: {
      getGoals:    async () => ({ ok: true as const, data: [] }),
      createGoal:  async () => ({ ok: true as const, data: { id: "mock-goal" } }),
      updateGoal:  async () => ({ ok: true as const, data: { id: "mock-goal", name: "mock", type: "personalizado" as const, targetAmountEur: 1000, targetDate: null, priority: 0, notes: null, createdAt: 0, updatedAt: 0 } }),
      deleteGoal:  async () => ({ ok: true as const, data: null }),
      getConsolidatedSnapshot: async (): Promise<any> => ({ ok: true as const, data: {} }),
      getProjection: async (): Promise<any> => ({ ok: true as const, data: {} }),
    },
    smartBuy: {
      getRecommendation: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", analyzedAmountEur: 200, totalPortfolioValueEur: 5000, recommendations: [], hasOpportunities: false, restrictionsApplied: [], dataQuality: "sin_datos" as const, generatedAt: 0 } }),
    },
    rebuyTiers: {
      list:     async () => ({ ok: true as const, data: [] }),
      upsert:   async () => ({ ok: true as const, data: { id: "mock-tier" } }),
      delete:   async () => ({ ok: true as const, data: null }),
      evaluate: async () => ({ ok: true as const, data: { triggered: [], availableLiquidityEur: 0, totalSuggestedEur: 0 } }),
    },
    partialSaleRules: {
      list:     async () => ({ ok: true as const, data: [] }),
      create:   async (): Promise<any> => ({ ok: true as const, data: {} }),
      update:   async (): Promise<any> => ({ ok: true as const, data: {} }),
      delete:   async () => ({ ok: true as const, data: null }),
      evaluate: async () => ({ ok: true as const, data: [] }),
    },
    planMonitoring: {
      getSummary: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", planId: null, activeAssets: 0, goalsReached: 0, goalsNearby: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, compliancePercentage: null, deficitEur: 0, eurcAvailable: 0, fiscalReserve: 0, alerts: [], assetStatuses: [], generatedAt: 0 } }),
    },
    treasury: {
      allocateCashToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
      listCycleLiquidity: async () => ({ ok: true as const, data: [] }),
      listFiscalReserveMovements: async () => ({ ok: true as const, data: [] }),
      getSummary: () => ok({
        cashBalance: 100,
        eurcBalance: 80,
        fiscalReserveBalance: 20,
        totalLiquidity: 200,
        freeRebuyLiquidity: 80,
        allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0,
        recommendedFiscalReserve: 30,
        pendingEstimatedTaxes: 10,
        updatedAt: now,
      }),
      listMovements: () => ok([]),
      createMovement: () => ok({ id: "mock-treasury-movement" }),
      updateMovement: () => ok({ id: "mock-treasury-movement", date: now, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 1, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, createdAt: now, updatedAt: now }),
      deleteMovement: () => ok(null),
      setFiscalReserve: () => ok({ cashBalance: 100, eurcBalance: 80, fiscalReserveBalance: 20, totalLiquidity: 200, freeRebuyLiquidity: 80, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 30, pendingEstimatedTaxes: 10, updatedAt: now }),
      allocateEurcToRebuy: () => ok({ id: "mock-allocation" }),
    },
    persp2: {
      getSimulation: async () => ({ ok: true as const, data: null }),
    },
  };
});

describe("Tesorería", () => {
  test("renderiza resumen y estado sin movimientos", async () => {
    renderWithQuery(<Tesoreria />);

    await waitFor(() => {
      expect(screen.getByText("Tesorería")).toBeInTheDocument();
    });
    expect(screen.getByText(/Efectivo disponible/i)).toBeInTheDocument();
    expect(screen.getByText(/EURC disponible/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Reserva fiscal/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Libre para recompras/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin movimientos de tesorería registrados/i)).toBeInTheDocument();
  });
});
