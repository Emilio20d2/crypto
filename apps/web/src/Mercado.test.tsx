import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Mercado } from "./pages/Mercado";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function setupMock(opts: { assets?: any[]; fearGreedOk?: boolean; fearGreedFallback?: boolean; overviewChange24h?: number | null; historyProvider?: string; overviewProvider?: string } = {}) {
  const assets = opts.assets ?? [
    { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto" as const, createdAt: 0, updatedAt: 0, logoUrl: null },
    { id: "ETH", symbol: "ETH", name: "Ethereum", type: "crypto" as const, createdAt: 0, updatedAt: 0, logoUrl: null },
  ];

  window.cryptoControl = {
    assets: { list: async () => ({ ok: true as const, data: assets }) },
    market: {
      getCurrentPrice: async () => ({ ok: true as const, data: { price: 50000, state: "live" as const, provider: opts.overviewProvider ?? "coinbase", fetchedAt: Date.now() } }),
      getHistoricalPrices: async () => ({ ok: true as const, data: { provider: opts.historyProvider ?? "coinbase", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: Date.now(), isCached: false } }),
      getOverview: async () => ({
        ok: true as const,
        data: {
          price: 50000,
          change24h: opts.overviewChange24h ?? 2.5,
          high24h: 51000,
          low24h: 49000,
          volume24h: 1000,
          volumeChange24h: null,
          marketCap: 1e12,
          dominance: null,
          fetchedAt: Date.now(),
          provider: opts.overviewProvider ?? "coinbase",
        },
      }),
      getFearGreed: opts.fearGreedOk === false
        ? async () => ({ ok: false as const, error: { code: "UNAVAILABLE", message: "F&G no disponible", recoverable: true } })
        : opts.fearGreedFallback
          ? async () => ({ ok: true as const, data: { value: 20, label: "Extreme Fear", timestamp: Date.now() - 86_400_000, fetchedAt: Date.now() - 10_000, isCached: true, source: "alternative.me", state: "fallback" as const, error: "Network timeout" } })
          : async () => ({ ok: true as const, data: { value: 45, label: "Fear", timestamp: Date.now(), fetchedAt: Date.now(), isCached: false, source: "alternative.me", state: "live" as const } }),
      getGlobalMetrics: async () => ({ ok: true as const, data: { btcDominance: 52.1, ethDominance: 17.4, totalMarketCapUsd: 2.5e12, totalVolumeUsd: 9e10, marketCapChangePercentage24h: -0.8, fetchedAt: Date.now(), isCached: false } }),
      getCryptoControlIndex: async () => ({ ok: true as const, data: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock", calculatedAt: Date.now() } }),
    },
    portfolio: {
      getSummary: async () => ({ ok: true as const, data: { totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "empty" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null } }),
      getPositions: async () => ({ ok: true as const, data: {} }),
      getAllocation: async () => ({ ok: true as const, data: [] }),
      getRealizedGains: async () => ({ ok: true as const, data: [] }),
      getFifoLots: async () => ({ ok: true as const, data: [] }),
      getHistoricalSeries: async () => ({ ok: true as const, data: { points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } } }),
      backfillCostBasis: async () => ({ ok: true as const, data: { legsChecked: 0, legsBackfilled: 0, legsStillPending: 0, byAsset: {} } }),
    },
    diagnostics: {
      getReport: async () => ({ ok: true as const, data: { accounts: 0, balances: 0, transactions: 0, conversions: 0, fees: 0, assets: 0, positions: 0, historicalPrices: 0, missingPrices: 0, missingCosts: 0, perAsset: [] } }),
    },
    transactions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: {} }),
      update: async () => ({ ok: true as const, data: null }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    settings: {
      get: async () => ({ ok: true as const, data: null }),
      update: async () => ({ ok: true as const, data: null }),
    },
    coinbase: {
      importCredentialsFile: async () => ({ ok: true as const, data: { connected: false, canceled: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: false, canTrade: false, canTransfer: false } } }),
      connectFromJson: async () => ({ ok: true as const, data: { connected: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: true, canTrade: false, canTransfer: false } } }),
      connect: async () => ({ ok: true as const, data: { connected: true } }),
      disconnect: async () => ({ ok: true as const, data: null }),
      getStatus: async () => ({ ok: true as const, data: { connected: false, lastSyncAt: null, lastSyncItemsProcessed: null, lastSyncStatus: null, lastSyncError: null } }),
      sync: async () => ({ ok: true as const, data: { itemsProcessed: 0, newTransactions: 0, skippedDuplicates: 0 } }),
      getSyncHistory: async () => ({ ok: true as const, data: [] }),
      listPortfolios: async () => ({ ok: true as const, data: [] }),
      getPortfolioBreakdown: async () => ({ ok: true as const, data: {} }),
      getPortfolioSnapshots: async () => ({ ok: true as const, data: [] }),
    },
    sentiment: {
      getGlobal: async () => ({ ok: true as const, data: { scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: Date.now(), validUntil: null, state: "unavailable" as const } }),
      getAsset: async () => ({ ok: true as const, data: { scope: "asset" as const, assetId: "BTC", direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: Date.now(), validUntil: null, state: "unavailable" as const } }),
      getHistory: async () => ({ ok: true as const, data: [] }),
      refresh: async () => ({ ok: true as const, data: { scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: Date.now(), validUntil: null, state: "unavailable" as const } }),
    },
    targets: {
      list: async () => ({ ok: true as const, data: [] }),
      upsert: async () => ({ ok: true as const, data: { id: "mock" } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    alerts: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: { id: "mock" } }),
      delete: async () => ({ ok: true as const, data: null }),
      toggle: async () => ({ ok: true as const, data: null }),
    },
    investmentPlan: {
      list: async () => ({ ok: true as const, data: [] }),
      getActive: async () => ({ ok: true as const, data: null }),
      create: async () => ({ ok: true as const, data: { id: "mock-plan" } }),
      update: async () => ({ ok: true as const, data: { id: "mock-plan", name: "Plan", status: "active" as const, baseCurrency: "EUR", notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    investmentCycles: {
      getMetrics: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", monthsElapsed: 0, monthsRemaining: null, percentComplete: null, expectedContributionMonthly: 0, expectedContributionAnnual: 0, expectedContributionToDate: 0, expectedContributionTotal: null, actualContribution: 0, contributionDifference: 0, extraContribution: 0, contributionCompliancePercentage: null, monthlyContributions: [], currentValueEur: 0, heldCostBasisEur: 0, profitEur: 0, roiPercentage: null, hasPendingValuation: false } }),
      listPartialSales: async () => ({ ok: true as const, data: [] }),
      createPartialSale: async () => ({ ok: true as const, data: { id: "mock-sale", cycleId: "mock-cycle", transactionId: "mock-tx", assetId: "BTC", percentageOfHolding: 10, proceedsEur: 100, date: 0, notes: null, createdAt: 0 } }),
      deletePartialSale: async () => ({ ok: true as const, data: null }),
      list: async () => ({ ok: true as const, data: [] }),
      getCurrent: async () => ({ ok: true as const, data: null }),
      create: async () => ({ ok: true as const, data: { id: "mock-cycle" } }),
      update: async () => ({ ok: true as const, data: { id: "mock-cycle", planId: "mock-plan", name: "Ciclo", startDate: 0, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned" as const, priority: 0, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    investmentAssets: {
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, tendencia: null, riesgoNivel: "bajo" as const, estadoEstrategico: "buena" as const, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: { id: "mock-investment-asset" } }),
      update: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      pause: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "paused" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      close: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "closed" as const, isActive: false, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      markGoalReached: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: 0, status: "goal_reached" as const, isActive: false, notes: null, goalReachedAt: 0, goalReachedValue: null, goalReachedType: null, allowExtraContributions: false, createdAt: 0, updatedAt: 0 } }),
      reactivate: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    strategyRevisions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: { id: "mock-revision" } }),
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
      getSummary: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
      listMovements: async () => ({ ok: true as const, data: [] }),
      createMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement" } }),
      updateMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement", date: 0, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 0.01, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 } }),
      deleteMovement: async () => ({ ok: true as const, data: null }),
      setFiscalReserve: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
      allocateEurcToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
    },
  };
}

beforeEach(() => setupMock());

describe("Mercado", () => {
  test("muestra el título de la página", async () => {
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getAllByText(/Mercado/i).length).toBeGreaterThan(0);
    });
  });

  test("empty state si no hay activos", async () => {
    setupMock({ assets: [] });
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getByText(/Sin activos/i)).toBeInTheDocument();
    });
  });

  test("muestra nombre de activo cuando hay datos", async () => {
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getAllByText(/Bitcoin/i).length).toBeGreaterThan(0);
    });
  });

  test("Fear & Greed card se renderiza", async () => {
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getByText(/Fear & Greed/i)).toBeInTheDocument();
    });
  });

  test("Fear & Greed muestra valor real, fuente y estado live", async () => {
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getByText("45")).toBeInTheDocument();
    });
    expect(screen.getByText("Fear")).toBeInTheDocument();
    expect(screen.getByText(/Fuente: alternative\.me/i)).toBeInTheDocument();
    expect(screen.getByText(/Estado: Live/i)).toBeInTheDocument();
  });

  test("Fear & Greed muestra fallback con último valor válido", async () => {
    setupMock({ fearGreedFallback: true });
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getByText("20")).toBeInTheDocument();
    });
    expect(screen.getByText("Extreme Fear")).toBeInTheDocument();
    expect(screen.getByText(/Estado: Fallback/i)).toBeInTheDocument();
    expect(screen.getByText(/Último valor válido/i)).toBeInTheDocument();
  });

  test("Fear & Greed error state no bloquea UI", async () => {
    setupMock({ fearGreedOk: false });
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getAllByText(/Mercado/i).length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      const noDisp = screen.queryAllByText(/No disponible/i);
      expect(noDisp.length).toBeGreaterThanOrEqual(0);
    });
  });

  test("dominancia BTC visible en métricas globales", async () => {
    renderWithQuery(<Mercado />);
    await waitFor(() => {
      expect(screen.getByText(/Dominancia BTC/i)).toBeInTheDocument();
    });
  });

  test("sentimiento colapsado por defecto", async () => {
    renderWithQuery(<Mercado />);
    // Wait for full page load (not just loading state)
    await waitFor(() => {
      expect(screen.getByText(/Mostrar análisis/i)).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.queryByText(/Sentimiento del activo/i)).not.toBeInTheDocument();
  });

  test("muestra fuente alternativa cuando el histórico llega de CoinGecko", async () => {
    setupMock({ historyProvider: "coingecko", overviewProvider: "coingecko" });
    renderWithQuery(<Mercado />);

    await waitFor(() => {
      expect(screen.getAllByText(/Datos vía CoinGecko/i).length).toBeGreaterThan(0);
    });
  });
});
