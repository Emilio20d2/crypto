import { describe, expect, test, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    },
    portfolio: {
      getSummary: () => ok({ totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "complete" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null }),
      getPositions: () => ok({}),
      getAllocation: () => ok([]),
      getRealizedGains: () => ok([]),
      getFifoLots: () => ok([]),
      getHistoricalSeries: () => ok({ points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } }),
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
      getGlobalMetrics: () => ok({ btcDominance: null, totalMarketCapUsd: null, fetchedAt: now, isCached: false }),
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
          totalBalance: { value: 344.79, currency: "EUR" },
          totalCryptoBalance: { value: 344.75, currency: "EUR" },
          totalCashEquivalentBalance: { value: 0.04, currency: "EUR" },
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
        ],
        capturedAt: now,
        currency: "EUR" as const,
        source: "coinbase" as const,
        state: "live" as const,
      }),
      getPortfolioSnapshots: () => ok([{ capturedAt: now - 60_000, totalBalance: 340 }, { capturedAt: now, totalBalance: 344.79 }]),
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
      update: () => ok({ id: "mock-plan", name: "Plan", status: "active" as const, baseCurrency: "EUR", notes: null, createdAt: 0, updatedAt: 0 }),
      delete: () => ok(null),
    },
    investmentCycles: {
      list: () => ok([]),
      getCurrent: async () => ({ ok: true as const, data: null }),
      create: () => ok({ id: "mock-cycle" }),
      update: () => ok({ id: "mock-cycle", planId: "mock-plan", name: "Ciclo", startDate: 0, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned" as const, priority: 0, notes: null, createdAt: 0, updatedAt: 0 }),
      delete: () => ok(null),
    },
    investmentAssets: {
      list: () => ok([]),
      create: () => ok({ id: "mock-investment-asset" }),
      update: () => ok({ id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, createdAt: 0, updatedAt: 0 }),
      pause: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "paused" as const, isActive: false, notes: null, createdAt: 0, updatedAt: 0 } }),
      close: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "closed" as const, isActive: false, notes: null, createdAt: 0, updatedAt: 0 } }),
      delete: () => ok(null),
    },
    strategyRevisions: {
      list: () => ok([]),
      create: () => ok({ id: "mock-revision" }),
    },
    treasury: {
      getSummary: () => ok({ cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 }),
      listMovements: () => ok([]),
      createMovement: () => ok({ id: "mock-treasury-movement" }),
      updateMovement: () => ok({ id: "mock-treasury-movement", date: 0, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 0.01, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, createdAt: 0, updatedAt: 0 }),
      deleteMovement: () => ok(null),
      setFiscalReserve: () => ok({ cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 }),
      allocateEurcToRebuy: () => ok({ id: "mock-allocation" }),
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
    expect(screen.queryByText(/FIFO/i)).not.toBeInTheDocument();
  });
});
