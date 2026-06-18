import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Perspectivas } from "./pages/Perspectivas";

function renderWithQuery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Perspectivas />
    </QueryClientProvider>
  );
}

function ok<T>(data: T) {
  return Promise.resolve({ ok: true as const, data });
}

const MOCK_PROJECTION = {
  snapshot: {
    snapshotId: "snap-mock",
    generatedAt: 0,
    planId: "plan-1",
    planName: "Plan principal",
    historicalCapitalEur: 4000,
    historicalSalesEur: 0,
    positionCount: 2,
    treasury: { cashEur: 100, eurcEur: 80, eurcAvailableEur: 60, fiscalReserveEur: 20, totalLiquidityEur: 180 },
    dataQuality: { overallScore: 1, missingPrices: [], missingCosts: [], staleData: [], notes: [] },
    positions: {
      BTC: { assetId: "BTC", balance: 0.05, avgCostEur: 50000, currentValueEur: 4000, currentPriceEur: 80000 },
    },
    fiscalVersion: "es-2024",
    strategyVersion: "v1",
  },
  scenarios: [
    {
      scenario: "conservador" as const,
      label: "Conservador",
      probability: 0.25,
      confidence: 0.7,
      summary: { initialGrossWealthEur: 4000, finalGrossWealthEur: 7000, finalNetWealthEur: 6500, totalCapitalEur: 5000, totalRealizedGainEur: 0, totalUnrealizedGainEur: 2000, totalTaxGeneratedEur: 500, finalEurcAvailableEur: 60, finalCashEur: 100, finalFiscalReserveEur: 20 },
      chartPoints: [
        { date: Date.now(), grossWealthEur: 4000, netWealthEur: 4000, portfolioValueEur: 3820, cashEur: 100, eurcAvailableEur: 60 },
        { date: Date.now() + 365 * 86400000, grossWealthEur: 7000, netWealthEur: 6500, portfolioValueEur: 6820, cashEur: 100, eurcAvailableEur: 60 },
      ],
      assetResults: [],
    },
    {
      scenario: "base" as const,
      label: "Base",
      probability: 0.45,
      confidence: 0.8,
      summary: { initialGrossWealthEur: 4000, finalGrossWealthEur: 9000, finalNetWealthEur: 8200, totalCapitalEur: 5000, totalRealizedGainEur: 0, totalUnrealizedGainEur: 4000, totalTaxGeneratedEur: 800, finalEurcAvailableEur: 60, finalCashEur: 100, finalFiscalReserveEur: 20 },
      chartPoints: [
        { date: Date.now(), grossWealthEur: 4000, netWealthEur: 4000, portfolioValueEur: 3820, cashEur: 100, eurcAvailableEur: 60 },
        { date: Date.now() + 365 * 86400000, grossWealthEur: 9000, netWealthEur: 8200, portfolioValueEur: 8820, cashEur: 100, eurcAvailableEur: 60 },
      ],
      assetResults: [],
    },
    {
      scenario: "optimista" as const,
      label: "Optimista",
      probability: 0.15,
      confidence: 0.6,
      summary: { initialGrossWealthEur: 4000, finalGrossWealthEur: 15000, finalNetWealthEur: 13000, totalCapitalEur: 5000, totalRealizedGainEur: 0, totalUnrealizedGainEur: 10000, totalTaxGeneratedEur: 2000, finalEurcAvailableEur: 60, finalCashEur: 100, finalFiscalReserveEur: 20 },
      chartPoints: [],
      assetResults: [],
    },
    {
      scenario: "dinamico" as const,
      label: "Dinámico",
      probability: null,
      confidence: null,
      summary: { initialGrossWealthEur: 4000, finalGrossWealthEur: 8500, finalNetWealthEur: 7800, totalCapitalEur: 5000, totalRealizedGainEur: 0, totalUnrealizedGainEur: 3500, totalTaxGeneratedEur: 700, finalEurcAvailableEur: 60, finalCashEur: 100, finalFiscalReserveEur: 20 },
      chartPoints: [],
      assetResults: [],
    },
  ],
  comparison: [
    { scenario: "conservador" as const, label: "Conservador", finalGrossWealthEur: 7000, finalNetWealthEur: 6500, probability: 0.25, confidence: 0.7 },
    { scenario: "base" as const, label: "Base", finalGrossWealthEur: 9000, finalNetWealthEur: 8200, probability: 0.45, confidence: 0.8 },
    { scenario: "optimista" as const, label: "Optimista", finalGrossWealthEur: 15000, finalNetWealthEur: 13000, probability: 0.15, confidence: 0.6 },
    { scenario: "dinamico" as const, label: "Dinámico", finalGrossWealthEur: 8500, finalNetWealthEur: 7800, probability: null, confidence: null },
  ],
  horizonYears: 10,
  generatedAt: Date.now(),
};

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
      getCryptoControlIndex: async () => ({ ok: true as const, data: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock", calculatedAt: now } }),
    },
    portfolio: {
      getSummary: () => ok({ totalValueEur: 5000, totalInvestedEur: 4000, unrealizedGainEur: 1000, unrealizedGainPercentage: 25, valuationStatus: "ok" as const, valuedAssets: 2, unavailableAssets: 0, lastSuccessfulPriceAt: now }),
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
      list: () => ok([{ id: "cycle-1", planId: "plan-1", name: "Ciclo 2026-2030", startDate: now, endDate: now + 4 * 365 * 86400000, monthlyAmountEur: 200, contributionCurrency: "EUR", status: "active" as const, priority: 1, objetivo: null, riesgo: null, allowExtraContributions: true, notes: null, createdAt: now, updatedAt: now }]),
      getCurrent: async () => ({ ok: true as const, data: null }),
      getMetrics: async () => ({ ok: true as const, data: { cycleId: "cycle-1", monthsElapsed: 0, monthsRemaining: null, percentComplete: null, expectedContributionMonthly: 200, expectedContributionAnnual: 2400, expectedContributionToDate: 0, expectedContributionTotal: null, actualContribution: 0, contributionDifference: 0, extraContribution: 0, contributionCompliancePercentage: null, monthlyContributions: [], currentValueEur: 0, heldCostBasisEur: 0, profitEur: 0, roiPercentage: null, hasPendingValuation: false } }),
      listPartialSales: async () => ({ ok: true as const, data: [] }),
      createPartialSale: async () => ({ ok: true as const, data: { id: "mock-sale" } }),
      deletePartialSale: async () => ({ ok: true as const, data: null }),
      create: () => ok({ id: "cycle-new" }),
      update: (_id: string, data: any) => ok({ id: "cycle-1", planId: "plan-1", name: data.name ?? "Ciclo", startDate: now, endDate: null, monthlyAmountEur: 200, contributionCurrency: "EUR", status: "active" as const, priority: 1, objetivo: null, riesgo: null, allowExtraContributions: true, notes: null, createdAt: now, updatedAt: now }),
      delete: () => ok(null),
    },
    investmentAssets: {
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, tendencia: null, riesgoNivel: "bajo" as const, estadoEstrategico: "buena" as const, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
      list: () => ok([]),
      create: () => ok({ id: "mock-investment-asset" }),
      update: () => ok({ id: "mock-investment-asset", cycleId: "cycle-1", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: null, status: "active" as const, isActive: true, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 }),
      pause: async () => ({ ok: true as const, data: { id: "mock-ia", cycleId: "cycle-1", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: null, status: "paused" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      close: async () => ({ ok: true as const, data: { id: "mock-ia", cycleId: "cycle-1", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: null, status: "closed" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
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
    },
    assetSubstitutions: {
      list:    async () => ({ ok: true as const, data: [] }),
      create:  async () => ({ ok: true as const, data: { id: "mock-substitution" } }),
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
      getConsolidatedSnapshot: async () => ({ ok: true as const, data: {} as any }),
      getProjection: async () => ({ ok: true as const, data: MOCK_PROJECTION }),
    },
    smartBuy: {
      getRecommendation: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", analyzedAmountEur: 200, totalPortfolioValueEur: 5000, recommendations: [], hasOpportunities: false, restrictionsApplied: [], dataQuality: "sin_datos" as const, generatedAt: 0 } }),
    },
    rebuyTiers: {
      list:   async () => ({ ok: true as const, data: [] }),
      upsert: async () => ({ ok: true as const, data: { id: "mock-tier" } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    treasury: {
      allocateCashToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
      listCycleLiquidity: async () => ({ ok: true as const, data: [] }),
      listFiscalReserveMovements: async () => ({ ok: true as const, data: [] }),
      getSummary: () => ok({ cashBalance: 100, eurcBalance: 80, fiscalReserveBalance: 20, totalLiquidity: 200, freeRebuyLiquidity: 80, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 30, pendingEstimatedTaxes: 10, updatedAt: now }),
      listMovements: () => ok([]),
      createMovement: () => ok({ id: "mock-treasury-movement" }),
      updateMovement: () => ok({ id: "mock-treasury-movement", date: now, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 1, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, createdAt: now, updatedAt: now }),
      deleteMovement: () => ok(null),
      setFiscalReserve: () => ok({ cashBalance: 100, eurcBalance: 80, fiscalReserveBalance: 20, totalLiquidity: 200, freeRebuyLiquidity: 80, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 30, pendingEstimatedTaxes: 10, updatedAt: now }),
      allocateEurcToRebuy: () => ok({ id: "mock-allocation" }),
    },
  } as any;
});

describe("Perspectivas", () => {
  test("renderiza la página con título y secciones principales", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getByText("Perspectivas")).toBeInTheDocument();
    });
    expect(screen.getByText(/Estado del plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Proyección.*4 escenarios/i)).toBeInTheDocument();
    expect(screen.getByText(/Objetivos de inversión/i)).toBeInTheDocument();
    expect(screen.getByText(/Calidad de datos/i)).toBeInTheDocument();
  });

  test("muestra los cuatro escenarios en la comparativa", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getAllByText("Conservador").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Base").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Optimista").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dinámico").length).toBeGreaterThan(0);
  });

  test("muestra el plan principal del snapshot", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getByText(/Plan principal/i)).toBeInTheDocument();
    });
  });

  test("muestra mensaje de sin objetivos cuando no hay goals", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getByText(/Sin objetivos definidos/i)).toBeInTheDocument();
    });
  });
});
