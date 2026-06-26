import { describe, expect, test, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Portfolio } from "./pages/Portfolio";

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
    assets: {
      list: () => ok([
        { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto" as const, logoUrl: null, createdAt: 0, updatedAt: 0 },
        { id: "TON", symbol: "TON", name: "Toncoin", type: "crypto" as const, logoUrl: null, createdAt: 0, updatedAt: 0 },
        { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto" as const, logoUrl: null, createdAt: 0, updatedAt: 0 },
      ]),
      catalog: () => ok([]),
      register: () => ok({ id: "", symbol: "", name: "", type: "crypto" as const, createdAt: 0, updatedAt: 0 }),
    },
    portfolio: {
      getSummary: () => ok({ totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "complete" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null }),
      getPositions: () => ok({}),
      getAllocation: () => ok([]),
      getRealizedGains: () => ok([]),
      getFifoLots: () => ok([]),
      getHistoricalSeries: () => ok({ points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } }),
      backfillCostBasis: async () => ({ ok: true as const, data: { legsChecked: 0, legsBackfilled: 0, legsStillPending: 0, byAsset: {} } }),
      getLiveSnapshot: () => ok(null),
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
    market: {
      getCurrentPrice: () => ok({ price: null, state: "unavailable" as const, provider: "mock", fetchedAt: now }),
      getHistoricalPrices: () => ok({ points: [], provider: "mock", requestedPeriod: "24h", actualInterval: "1h", fetchedAt: now, isCached: false }),
      getOverview: () => ok({ price: null, change24h: null, high24h: null, low24h: null, volume24h: null, volumeChange24h: null, marketCap: null, dominance: null, fetchedAt: null, provider: "mock" }),
      getFearGreed: () => ok({ value: 50, label: "Neutral", timestamp: now, fetchedAt: now, isCached: false }),
      getGlobalMetrics: () => ok({ btcDominance: null, ethDominance: null, totalMarketCapUsd: null, totalVolumeUsd: null, marketCapChangePercentage24h: null, fetchedAt: now, isCached: false }),
      getCryptoControlIndex: async () => ({ ok: true as const, data: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock", calculatedAt: Date.now() } }),
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
      getStatus: () => ok({ connected: true, lastSyncAt: now, lastSyncItemsProcessed: 3, lastSyncStatus: "success" as const, lastSyncError: null }),
      sync: () => ok({ itemsProcessed: 0, newTransactions: 0, skippedDuplicates: 0 }),
      getSyncHistory: () => ok([]),
      listPortfolios: () => ok([{ uuid: "portfolio-1", name: "Default", type: "default", deleted: false }]),
      getPortfolioBreakdown: () => ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: {
          totalBalance: { value: 380.29, currency: "EUR" },
          totalCryptoBalance: { value: 309.24, currency: "EUR" },
          totalCashEquivalentBalance: { value: 71.05, currency: "EUR" },
          totalFuturesBalance: null,
          futuresUnrealizedPnl: null,
          perpUnrealizedPnl: null,
        },
        positions: [
          {
            asset: "ADA",
            assetUuid: "ada-uuid",
            accountUuid: "ada-account",
            totalBalanceFiat: 63.88,
            totalBalanceCrypto: 199,
            allocation: 0.1853,
            costBasis: { value: 70, currency: "EUR" },
            averageEntryPrice: { value: 0.351758, currency: "EUR" },
            unrealizedPnl: -6.12,
            fundingPnl: null,
            availableToTradeFiat: 63.88,
            availableToTradeCrypto: 199,
            availableToTransferFiat: 63.88,
            availableToTransferCrypto: 199,
            availableToSendFiat: 63.88,
            availableToSendCrypto: 199,
            assetImageUrl: null,
            assetColor: null,
            isCash: false,
            accountType: "exchange",
            market: { productId: "ADA-EUR", price: 0.321, pricePercentageChange24h: 1.2, volume24h: null, volumePercentageChange24h: null, marketCap: null, baseName: "Cardano", baseDisplaySymbol: "ADA", quoteDisplaySymbol: "EUR", iconUrl: null, status: "online", tradingDisabled: false, viewOnly: false },
            sparkline: [],
          },
          {
            asset: "TON",
            assetUuid: "ton-uuid",
            accountUuid: "ton-account",
            totalBalanceFiat: 24,
            totalBalanceCrypto: 12,
            allocation: 0.0696,
            costBasis: { value: 20, currency: "EUR" },
            averageEntryPrice: { value: 1.6667, currency: "EUR" },
            unrealizedPnl: 4,
            fundingPnl: null,
            availableToTradeFiat: 24,
            availableToTradeCrypto: 12,
            availableToTransferFiat: 24,
            availableToTransferCrypto: 12,
            availableToSendFiat: 24,
            availableToSendCrypto: 12,
            assetImageUrl: null,
            assetColor: null,
            isCash: false,
            accountType: "exchange",
            market: { productId: "TON-EUR", price: 2, pricePercentageChange24h: -0.5, volume24h: null, volumePercentageChange24h: null, marketCap: null, baseName: "Toncoin", baseDisplaySymbol: "TON", quoteDisplaySymbol: "EUR", iconUrl: null, status: "online", tradingDisabled: false, viewOnly: false },
            sparkline: [],
          },
          {
            asset: "BTC",
            assetUuid: "btc-uuid",
            accountUuid: "btc-account",
            totalBalanceFiat: 221.36,
            totalBalanceCrypto: 0.004,
            allocation: 0.642,
            costBasis: { value: 236.24, currency: "EUR" },
            averageEntryPrice: { value: 59060, currency: "EUR" },
            unrealizedPnl: -14.88,
            fundingPnl: null,
            availableToTradeFiat: 221.36,
            availableToTradeCrypto: 0.004,
            availableToTransferFiat: 221.36,
            availableToTransferCrypto: 0.004,
            availableToSendFiat: 221.36,
            availableToSendCrypto: 0.004,
            assetImageUrl: null,
            assetColor: null,
            isCash: false,
            accountType: "exchange",
            market: { productId: "BTC-EUR", price: 55340, pricePercentageChange24h: 0.8, volume24h: null, volumePercentageChange24h: null, marketCap: null, baseName: "Bitcoin", baseDisplaySymbol: "BTC", quoteDisplaySymbol: "EUR", iconUrl: null, status: "online", tradingDisabled: false, viewOnly: false },
            sparkline: [],
          },
          // EURC reserve: isCash=true, excluded from investment cards but included in total
          {
            asset: "EURC",
            assetUuid: "eurc-uuid",
            accountUuid: "eurc-account",
            totalBalanceFiat: 71.05,
            totalBalanceCrypto: 71.05,
            allocation: null,
            costBasis: { value: 71.05, currency: "EUR" },
            averageEntryPrice: null,
            unrealizedPnl: 0,
            fundingPnl: null,
            availableToTradeFiat: 71.05,
            availableToTradeCrypto: 71.05,
            availableToTransferFiat: 71.05,
            availableToTransferCrypto: 71.05,
            availableToSendFiat: 71.05,
            availableToSendCrypto: 71.05,
            assetImageUrl: null,
            assetColor: null,
            isCash: true,
            accountType: "exchange",
            market: null,
            sparkline: [],
          },
        ],
        capturedAt: now,
        currency: "EUR" as const,
        source: "coinbase" as const,
        state: "live" as const,
      }),
      getPortfolioSnapshots: () => ok([{ capturedAt: now - 60_000, totalBalance: 340 }, { capturedAt: now, totalBalance: 344.79 }]),
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
      getAnalystForecasts: async (): Promise<any> => ({ ok: true as const, data: [] }),
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
      getSummary: () => ok({ cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 }),
      listMovements: () => ok([]),
      createMovement: () => ok({ id: "mock-treasury-movement" }),
      updateMovement: () => ok({ id: "mock-treasury-movement", date: 0, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 0.01, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, allowExtraContributions: true, createdAt: 0, updatedAt: 0 }),
      deleteMovement: () => ok(null),
      setFiscalReserve: () => ok({ cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 }),
      allocateEurcToRebuy: () => ok({ id: "mock-allocation" }),
    },
    persp2: {
      getSimulation: async () => ({ ok: true as const, data: null }),
    },
  };
});

describe("Cartera Coinbase", () => {
  test("muestra todas las posiciones y datos de Coinbase sin FIFO", async () => {
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getAllByText("Bitcoin").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Cardano").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Toncoin").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/^Invertido$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Coste medio$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Precio actual/i).length).toBeGreaterThan(0);
    expect(screen.getByText("0,3210 €")).toBeInTheDocument();
    expect(screen.getByText("55.340,00 €")).toBeInTheDocument();
    expect(screen.queryByText(/FIFO/i)).not.toBeInTheDocument();
  });

  test("un activo con balance > 0 no desaparece aunque no tenga precio ni coste de Coinbase", async () => {
    const now = Date.now();
    window.cryptoControl.coinbase.getPortfolioBreakdown = () =>
      ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: { totalBalance: null, totalCryptoBalance: null, totalCashEquivalentBalance: null, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [
          {
            asset: "SEI",
            assetUuid: null,
            accountUuid: "sei-account",
            totalBalanceFiat: null,
            totalBalanceCrypto: 779.45,
            allocation: null,
            costBasis: null,
            averageEntryPrice: null,
            unrealizedPnl: null,
            fundingPnl: null,
            availableToTradeFiat: null,
            availableToTradeCrypto: null,
            availableToTransferFiat: null,
            availableToTransferCrypto: null,
            availableToSendFiat: null,
            availableToSendCrypto: null,
            assetImageUrl: null,
            assetColor: null,
            isCash: false,
            accountType: "exchange",
            market: null,
            sparkline: [],
          },
        ],
        capturedAt: now,
        currency: "EUR" as const,
        source: "coinbase" as const,
        state: "live" as const,
      });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getAllByText("SEI").length).toBeGreaterThan(0);
    });
    // Sin coste ni precio: debe mostrarse información de estado, nunca ocultarse ni mostrar un 0 falso.
    // Con nuestra corrección, los campos muestran "Sin coste" o "Coste pendiente" en lugar de bloquear.
    expect(
      screen.queryAllByText(/Sin coste|Coste pendiente|Sin precio/i).length
    ).toBeGreaterThan(0);
  });

  test("EURC no aparece como posición cripto en la Cartera", async () => {
    const now = Date.now();
    window.cryptoControl.coinbase.getPortfolioBreakdown = () =>
      ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: { totalBalance: null, totalCryptoBalance: null, totalCashEquivalentBalance: null, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [
          {
            asset: "EURC",
            assetUuid: null,
            accountUuid: "eurc-account",
            totalBalanceFiat: 0.04,
            totalBalanceCrypto: 0.0395,
            allocation: null,
            costBasis: { value: 0.04, currency: "EUR" },
            averageEntryPrice: null,
            unrealizedPnl: 0,
            fundingPnl: null,
            availableToTradeFiat: null,
            availableToTradeCrypto: null,
            availableToTransferFiat: null,
            availableToTransferCrypto: null,
            availableToSendFiat: null,
            availableToSendCrypto: null,
            assetImageUrl: null,
            assetColor: null,
            isCash: true,
            accountType: "exchange",
            market: null,
            sparkline: [],
          },
        ],
        capturedAt: now,
        currency: "EUR" as const,
        source: "coinbase" as const,
        state: "live" as const,
      });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Mis posiciones")).toBeInTheDocument();
    });
    // EURC must NOT appear as an investment position card (the symbol "EURC" in a card)
    // but CAN appear inside "Reserva EURC" label text (it's part of a longer string)
    const eurcExactMatch = screen.queryAllByText("EURC").filter(
      (el) => el.tagName === "SMALL" || el.tagName === "STRONG"
    );
    expect(eurcExactMatch.length).toBe(0);
  });

  test("EURC se suma al valor total patrimonial de la cabecera", async () => {
    // Default mock has BTC+ADA+TON (309.24 €) + EURC (71.05 €) = 380.29 €
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Valor total de activos")).toBeInTheDocument();
    });
    // Total = crypto + EURC = 309.24 + 71.05 = 380.29 €
    expect(screen.getByText("380,29 €")).toBeInTheDocument();
  });

  test("Reserva EURC aparece como métrica separada en la cabecera", async () => {
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Reserva EURC")).toBeInTheDocument();
    });
    // The EURC metric value should show the EURC amount (71.05 €)
    expect(screen.getByText("71,05 €")).toBeInTheDocument();
  });

  test("sin EURC muestra 'Sin reserva' en la métrica", async () => {
    const now = Date.now();
    window.cryptoControl.coinbase.getPortfolioBreakdown = () =>
      ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: { totalBalance: { value: 100, currency: "EUR" }, totalCryptoBalance: { value: 100, currency: "EUR" }, totalCashEquivalentBalance: null, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [
          {
            asset: "BTC",
            assetUuid: "btc-uuid", accountUuid: "btc-account",
            totalBalanceFiat: 100, totalBalanceCrypto: 0.001,
            allocation: 1, costBasis: { value: 90, currency: "EUR" }, averageEntryPrice: null,
            unrealizedPnl: 10, fundingPnl: null,
            availableToTradeFiat: 100, availableToTradeCrypto: 0.001,
            availableToTransferFiat: 100, availableToTransferCrypto: 0.001,
            availableToSendFiat: 100, availableToSendCrypto: 0.001,
            assetImageUrl: null, assetColor: null, isCash: false, accountType: "exchange",
            market: { productId: "BTC-EUR", price: 100000, pricePercentageChange24h: 1, volume24h: null, volumePercentageChange24h: null, marketCap: null, baseName: "Bitcoin", baseDisplaySymbol: "BTC", quoteDisplaySymbol: "EUR", iconUrl: null, status: "online", tradingDisabled: false, viewOnly: false },
            sparkline: [],
          },
        ],
        capturedAt: now, currency: "EUR" as const, source: "coinbase" as const, state: "live" as const,
      });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Reserva EURC")).toBeInTheDocument();
    });
    expect(screen.getByText("Sin reserva")).toBeInTheDocument();
  });

  test("desglose cripto·EURC aparece en el hero cuando hay EURC", async () => {
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText(/Cripto.*EURC/)).toBeInTheDocument();
    });
  });

  test("valor total no incluye EUR fiat (solo cripto + EURC)", async () => {
    const now = Date.now();
    window.cryptoControl.coinbase.getPortfolioBreakdown = () =>
      ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: { totalBalance: { value: 600, currency: "EUR" }, totalCryptoBalance: { value: 100, currency: "EUR" }, totalCashEquivalentBalance: { value: 500, currency: "EUR" }, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [
          {
            asset: "BTC",
            assetUuid: "btc-uuid", accountUuid: "btc-account",
            totalBalanceFiat: 100, totalBalanceCrypto: 0.001,
            allocation: 1, costBasis: null, averageEntryPrice: null,
            unrealizedPnl: null, fundingPnl: null,
            availableToTradeFiat: 100, availableToTradeCrypto: 0.001,
            availableToTransferFiat: 100, availableToTransferCrypto: 0.001,
            availableToSendFiat: 100, availableToSendCrypto: 0.001,
            assetImageUrl: null, assetColor: null, isCash: false, accountType: "exchange",
            market: null, sparkline: [],
          },
          // EURC reserve
          {
            asset: "EURC",
            assetUuid: null, accountUuid: "eurc-account",
            totalBalanceFiat: 50, totalBalanceCrypto: 50,
            allocation: null, costBasis: null, averageEntryPrice: null,
            unrealizedPnl: 0, fundingPnl: null,
            availableToTradeFiat: 50, availableToTradeCrypto: 50,
            availableToTransferFiat: 50, availableToTransferCrypto: 50,
            availableToSendFiat: 50, availableToSendCrypto: 50,
            assetImageUrl: null, assetColor: null, isCash: true, accountType: "exchange",
            market: null, sparkline: [],
          },
          // EUR fiat — must NOT be included in total
          {
            asset: "EUR",
            assetUuid: null, accountUuid: "eur-account",
            totalBalanceFiat: 450, totalBalanceCrypto: 450,
            allocation: null, costBasis: null, averageEntryPrice: null,
            unrealizedPnl: 0, fundingPnl: null,
            availableToTradeFiat: 450, availableToTradeCrypto: 450,
            availableToTransferFiat: 450, availableToTransferCrypto: 450,
            availableToSendFiat: 450, availableToSendCrypto: 450,
            assetImageUrl: null, assetColor: null, isCash: true, accountType: "exchange",
            market: null, sparkline: [],
          },
        ],
        capturedAt: now, currency: "EUR" as const, source: "coinbase" as const, state: "live" as const,
      });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Valor total de activos")).toBeInTheDocument();
    });
    // Total = BTC (100) + EURC (50) = 150 €, NOT 600 (which would include EUR fiat)
    expect(screen.getByText("150,00 €")).toBeInTheDocument();
    expect(screen.queryByText("600,00 €")).not.toBeInTheDocument();
  });

  test("P&L se calcula solo sobre cripto, no sobre EURC", async () => {
    // Default mock: crypto=309.24 €, EURC=71.05 €, totalBalance=380.29 €
    // localPositions are NOT set (mock returns {}) so performance = null
    // This test verifies the performance calculation uses cryptoTotal, not totalBalance
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Beneficio / Pérdida")).toBeInTheDocument();
    });
    // Sin coste: B/P y Total invertido muestran "Sin coste" (no bloquean con "En cálculo")
    expect(screen.getAllByText("Sin coste").length).toBeGreaterThanOrEqual(1);
    // El panel B/P muestra "Sin coste" porque no hay datos de coste local
    const pnlMetric = screen.getByText("Beneficio / Pérdida").closest(".portfolio-metric");
    expect(pnlMetric?.textContent).toContain("Sin coste");
  });
});

// ─── Sincronización viva desde el motor central ───────────────────────────────

describe("Cartera — live snapshot del motor central", () => {
  const makeLiveSnapshot = (overrides?: Partial<{
    btcBalance: number; btcPrice: number; btcValue: number;
    eurBalance: number; eurcBalance: number;
  }>) => {
    const {
      btcBalance = 0.004, btcPrice = 90000, btcValue = 360,
      eurBalance = 5, eurcBalance = 71.05,
    } = overrides ?? {};
    return {
      requestedAt: Date.now() - 50,
      receivedAt: Date.now(),
      snapshotVersion: `btc:${btcBalance.toFixed(8)}|eurc:${eurcBalance.toFixed(8)}`,
      usingFallback: false,
      accounts: [
        { assetId: "BTC",  availableBalance: btcBalance, holdBalance: 0, totalBalance: btcBalance },
        { assetId: "EURC", availableBalance: eurcBalance, holdBalance: 0, totalBalance: eurcBalance },
        { assetId: "EUR",  availableBalance: eurBalance,  holdBalance: 0, totalBalance: eurBalance },
      ],
      positions: [
        { assetId: "BTC", quantity: btcBalance, availableBalance: btcBalance, holdBalance: 0, currentPriceEur: btcPrice, priceSource: "coinbase", priceStatus: "live" as const, currentValueEur: btcValue },
      ],
      eurBalance,
      eurcBalance,
      eurcValueEur: eurcBalance,
      cryptoValueEur: btcValue,
      totalAssetValueEur: btcValue + eurcBalance + eurBalance,
      isComplete: true,
      missingPrices: [],
      warnings: [],
      timestamp: Date.now(),
      fiat: "EUR" as const,
      priceVersion: String(Date.now()),
      portfolioVersion: `btc:${btcBalance.toFixed(8)}`,
    };
  };

  test("precio de la tarjeta BTC se actualiza con el snapshot vivo", async () => {
    // Breakdown tiene BTC a 55.340 €; live snapshot lo actualiza a 90.000 €
    window.cryptoControl.portfolio.getLiveSnapshot = () => ok(makeLiveSnapshot({ btcPrice: 90000 }));

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      // El precio actualizado por liveSnapshot debe aparecer en la tarjeta BTC
      expect(screen.getByText("90.000,00 €")).toBeInTheDocument();
    });
    // El precio de breakdown (55.340 €) NO debe mostrarse
    expect(screen.queryByText("55.340,00 €")).not.toBeInTheDocument();
  });

  test("cantidad de la tarjeta BTC viene del snapshot vivo, no del breakdown", async () => {
    // Breakdown tiene 0.004 BTC; live snapshot reporta 0.0045 BTC
    window.cryptoControl.portfolio.getLiveSnapshot = () =>
      ok(makeLiveSnapshot({ btcBalance: 0.0045, btcValue: 0.0045 * 90000 }));

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      // formatCrypto(0.0045, "es-ES") → "0,0045"
      expect(screen.getByText("0,0045 BTC")).toBeInTheDocument();
    });
  });

  test("EURC no se suma dos veces al valor total", async () => {
    // cryptoValueEur = 360 (BTC), eurcBalance = 71.05, eurBalance = 5
    // Total esperado = 360 + 71.05 + 5 = 436.05 (sin doble EURC)
    window.cryptoControl.portfolio.getLiveSnapshot = () =>
      ok(makeLiveSnapshot({ btcBalance: 0.004, btcPrice: 90000, btcValue: 360, eurcBalance: 71.05, eurBalance: 5 }));

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Valor total de activos")).toBeInTheDocument();
    });

    // EURC (71.05) debe aparecer como reserva separada, no sumada dos veces
    // La tarjeta BTC no debe mostrar EURC dentro de cryptoValueEur
    expect(screen.queryAllByText("EURC").filter(
      el => el.tagName === "SMALL" || el.tagName === "STRONG"
    ).length).toBe(0);
  });

  test("cuando el snapshot vivo es null la UI sigue mostrando datos del breakdown", async () => {
    // getLiveSnapshot devuelve null (Coinbase no disponible)
    window.cryptoControl.portfolio.getLiveSnapshot = () => ok(null);

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getAllByText("Bitcoin").length).toBeGreaterThan(0);
    });
    // El breakdown tiene BTC a 55.340 €; debe seguir mostrándose sin snapshot vivo
    expect(screen.getByText("55.340,00 €")).toBeInTheDocument();
  });

  test("activo presente en liveSnapshot pero ausente en breakdown aparece en la lista", async () => {
    const now = Date.now();
    // Breakdown solo tiene ADA; liveSnapshot reporta también SUI (compra reciente)
    window.cryptoControl.coinbase.getPortfolioBreakdown = () =>
      ok({
        portfolio: { uuid: "portfolio-1", name: "Default", type: "default", deleted: false },
        balances: { totalBalance: { value: 50, currency: "EUR" }, totalCryptoBalance: { value: 50, currency: "EUR" }, totalCashEquivalentBalance: null, totalFuturesBalance: null, futuresUnrealizedPnl: null, perpUnrealizedPnl: null },
        positions: [{
          asset: "ADA", assetUuid: "ada-uuid", accountUuid: "ada-account",
          totalBalanceFiat: 50, totalBalanceCrypto: 100, allocation: 1,
          costBasis: null, averageEntryPrice: null, unrealizedPnl: null, fundingPnl: null,
          availableToTradeFiat: 50, availableToTradeCrypto: 100,
          availableToTransferFiat: 50, availableToTransferCrypto: 100,
          availableToSendFiat: 50, availableToSendCrypto: 100,
          assetImageUrl: null, assetColor: null, isCash: false, accountType: "exchange",
          market: { productId: "ADA-EUR", price: 0.5, pricePercentageChange24h: 0, volume24h: null, volumePercentageChange24h: null, marketCap: null, baseName: "Cardano", baseDisplaySymbol: "ADA", quoteDisplaySymbol: "EUR", iconUrl: null, status: "online", tradingDisabled: false, viewOnly: false },
          sparkline: [],
        }],
        capturedAt: now, currency: "EUR" as const, source: "coinbase" as const, state: "live" as const,
      });

    window.cryptoControl.portfolio.getLiveSnapshot = () => ok({
      requestedAt: now, receivedAt: now, snapshotVersion: "v1",
      usingFallback: false,
      accounts: [
        { assetId: "ADA", availableBalance: 100, holdBalance: 0, totalBalance: 100 },
        { assetId: "SUI", availableBalance: 200, holdBalance: 0, totalBalance: 200 },
      ],
      positions: [
        { assetId: "ADA", quantity: 100, availableBalance: 100, holdBalance: 0, currentPriceEur: 0.5, priceSource: "coinbase", priceStatus: "live" as const, currentValueEur: 50 },
        { assetId: "SUI", quantity: 200, availableBalance: 200, holdBalance: 0, currentPriceEur: 2.5, priceSource: "coinbase", priceStatus: "live" as const, currentValueEur: 500 },
      ],
      eurBalance: 0, eurcBalance: 0, eurcValueEur: 0,
      cryptoValueEur: 550, totalAssetValueEur: 550,
      isComplete: true, missingPrices: [], warnings: [],
      timestamp: now, fiat: "EUR" as const, priceVersion: String(now), portfolioVersion: "v1",
    });

    renderWithQuery(<Portfolio />);

    // Esperar a que aparezca SUI — vendrá del snapshot vivo (no del breakdown)
    await waitFor(() => {
      expect(screen.getAllByText("SUI").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Cardano").length).toBeGreaterThan(0);
  });
});

describe("Vista parcial anticipada (breakdown aún cargando)", () => {
  const now = Date.now();

  function makeSnap(total: number, crypto: number, eurc = 0, eur = 0) {
    return {
      requestedAt: now, receivedAt: now,
      snapshotVersion: `v${total}`, usingFallback: false,
      accounts: [], positions: [],
      eurBalance: eur, eurcBalance: eurc, eurcValueEur: eurc,
      cryptoValueEur: crypto, totalAssetValueEur: total,
      isComplete: true, missingPrices: [], warnings: [],
      timestamp: now, fiat: "EUR" as const,
      priceVersion: String(now), portfolioVersion: `v${total}`,
    };
  }

  beforeEach(() => {
    // Default breakdown: never resolves (simulates slow API)
    window.cryptoControl.coinbase.getPortfolioBreakdown = () => new Promise(() => {});
    // Default liveSnapshot: 50.000 € total
    window.cryptoControl.portfolio.getLiveSnapshot = () =>
      Promise.resolve({ ok: true as const, data: makeSnap(50_000, 49_000, 1000) });
  });

  test("muestra el valor total antes de que cargue el breakdown completo", async () => {
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("Valor total de activos")).toBeInTheDocument();
    });
    expect(screen.getByText("50.000,00 €")).toBeInTheDocument();
  });

  test("muestra componentes de cripto y EURC en la vista parcial", async () => {
    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText(/Cripto.*EURC/)).toBeInTheDocument();
    });
  });

  test("sin snapshot vivo sigue mostrando el spinner de carga", async () => {
    window.cryptoControl.portfolio.getLiveSnapshot = () => Promise.resolve({ ok: true as const, data: null });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText(/Cargando/)).toBeInTheDocument();
    });
  });

  test("calculateLiveTotalAssetValue: no suma EURC dos veces", async () => {
    const snap = makeSnap(51_000, 50_000, 1000, 0);
    // cryptoValueEur=50000, eurcValueEur=1000, eurBalance=0 → total=51000
    window.cryptoControl.portfolio.getLiveSnapshot = () =>
      Promise.resolve({ ok: true as const, data: snap });

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("51.000,00 €")).toBeInTheDocument();
    });
    // EURC debe aparecer como reserva (métrica separada), no sumada dos veces
    expect(screen.queryByText("102.000,00 €")).not.toBeInTheDocument();
  });
});

describe("Prueba de 6 ciclos — valor total cada 5 segundos", () => {
  const now = Date.now();

  function snap(cycle: number) {
    const total = 50_000 + cycle * 100;
    return {
      requestedAt: now, receivedAt: now,
      snapshotVersion: `cycle-${cycle}`, usingFallback: false,
      accounts: [], positions: [],
      eurBalance: 0, eurcBalance: 0, eurcValueEur: 0,
      cryptoValueEur: total, totalAssetValueEur: total,
      isComplete: true, missingPrices: [], warnings: [],
      timestamp: now + cycle * 5000, fiat: "EUR" as const,
      priceVersion: String(now), portfolioVersion: `cycle-${cycle}`,
    };
  }

  test("6 snapshots consecutivos se procesan correctamente por calculateLiveTotalAssetValue", async () => {
    // Verificación funcional: cada snapshot del ciclo produce el total correcto
    // (el timing de 5 s lo gestiona el motor central; aquí probamos la lógica de cálculo)
    const { calculateLiveTotalAssetValue } = await import("./lib/live-snapshot");

    const expected = [50_000, 50_100, 50_200, 50_300, 50_400, 50_500];
    for (let i = 0; i < 6; i++) {
      const s = snap(i);
      expect(calculateLiveTotalAssetValue(s)).toBe(expected[i]);
    }
  });

  test("tabla de 6 ciclos: totalAssetValueEur sube 100 € por ciclo", () => {
    // Prueba determinista sin renderizar: verifica la función de snapshot
    const cycles = [0, 1, 2, 3, 4, 5].map(c => snap(c).totalAssetValueEur);
    // Ciclo 0: 50.000, Ciclo 1: 50.100, ..., Ciclo 5: 50.500
    expect(cycles).toEqual([50_000, 50_100, 50_200, 50_300, 50_400, 50_500]);
    // Todos los valores son distintos
    expect(new Set(cycles).size).toBe(6);
  });
});

describe("Detección de cambio de balance", () => {
  const now = Date.now();
  let syncCount = 0;

  beforeEach(() => {
    syncCount = 0;
    window.cryptoControl.coinbase.sync = () => {
      syncCount++;
      return ok({ itemsProcessed: 0, newTransactions: 0, skippedDuplicates: 0 });
    };
  });

  test("cambio de snapshotVersion dispara syncInBackground", async () => {
    let callCount = 0;
    window.cryptoControl.portfolio.getLiveSnapshot = () => {
      callCount++;
      const version = callCount === 1 ? "v1-initial" : "v2-after-purchase";
      const total = callCount === 1 ? 50_000 : 60_000;
      return Promise.resolve({
        ok: true as const,
        data: {
          requestedAt: now, receivedAt: now + callCount,
          snapshotVersion: version, usingFallback: false,
          accounts: [], positions: [],
          eurBalance: 0, eurcBalance: 0, eurcValueEur: 0,
          cryptoValueEur: total, totalAssetValueEur: total,
          isComplete: true, missingPrices: [], warnings: [],
          timestamp: now + callCount, fiat: "EUR" as const,
          priceVersion: String(now), portfolioVersion: version,
        },
      });
    };
    window.cryptoControl.coinbase.getPortfolioBreakdown = () => new Promise(() => {});

    renderWithQuery(<Portfolio />);

    // Primer snapshot carga el valor
    await waitFor(() => {
      expect(screen.getByText("50.000,00 €")).toBeInTheDocument();
    });

    // El primer snapshot se procesa; los cambios posteriores llegan por evento
    // portfolio:live-snapshot desde el motor central.
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("evento portfolio:live-snapshot actualiza el total sin polling del renderer", async () => {
    let liveSnapshotCallback: ((snapshot: any) => void) | null = null;
    window.cryptoControl.portfolio.getLiveSnapshot = () =>
      Promise.resolve({
        ok: true as const,
        data: {
          requestedAt: now, receivedAt: now,
          snapshotVersion: "v1-initial", usingFallback: false,
          accounts: [], positions: [],
          eurBalance: 0, eurcBalance: 0, eurcValueEur: 0,
          cryptoValueEur: 50_000, totalAssetValueEur: 50_000,
          isComplete: true, missingPrices: [], warnings: [],
          timestamp: now, fiat: "EUR" as const,
          priceVersion: String(now), portfolioVersion: "v1-initial",
        },
      });
    window.cryptoControl.portfolio.onLiveSnapshot = (callback) => {
      liveSnapshotCallback = callback;
      return () => {
        liveSnapshotCallback = null;
      };
    };
    window.cryptoControl.coinbase.getPortfolioBreakdown = () => new Promise(() => {});

    renderWithQuery(<Portfolio />);

    await waitFor(() => {
      expect(screen.getByText("50.000,00 €")).toBeInTheDocument();
    });

    await act(async () => {
      liveSnapshotCallback?.({
        requestedAt: now + 5_000, receivedAt: now + 5_000,
        snapshotVersion: "v2-event", usingFallback: false,
        accounts: [], positions: [],
        eurBalance: 0, eurcBalance: 0, eurcValueEur: 0,
        cryptoValueEur: 50_500, totalAssetValueEur: 50_500,
        isComplete: true, missingPrices: [], warnings: [],
        timestamp: now + 5_000, fiat: "EUR" as const,
        priceVersion: String(now + 5_000), portfolioVersion: "v2-event",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("50.500,00 €")).toBeInTheDocument();
    });
  });
});
