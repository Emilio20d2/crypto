import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Fiscalidad } from "./pages/Fiscalidad";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const TX_DATE = new Date("2024-06-15T12:00:00Z").getTime();

function setupEmptyMock() {
  window.cryptoControl = {
    ...window.cryptoControl,
    portfolio: {
      ...window.cryptoControl.portfolio,
      getRealizedGains: async () => ({ ok: true as const, data: [] }),
      getFifoLots: async () => ({ ok: true as const, data: [] }),
    },
    transactions: {
      ...window.cryptoControl.transactions,
      list: async () => ({ ok: true as const, data: [] }),
    },
  };
}

function setupGainMock() {
  window.cryptoControl = {
    ...window.cryptoControl,
    portfolio: {
      ...window.cryptoControl.portfolio,
      getRealizedGains: async () => ({
        ok: true as const,
        data: [
          {
            transactionId: "tx-sell-1",
            assetId: "bitcoin",
            amountSold: 0.1,
            sellValueEur: 5_000,
            costBasisEur: 2_000,
            realizedGainEur: 3_000,
            date: TX_DATE,
          },
        ],
      }),
      getFifoLots: async () => ({ ok: true as const, data: [] }),
    },
    transactions: {
      ...window.cryptoControl.transactions,
      list: async () => ({
        ok: true as const,
        data: [
          {
            id: "tx-sell-1",
            type: "sell" as const,
            date: TX_DATE,
            legs: [],
            fees: [],
          },
        ],
      }),
    },
  };
}

describe("Fiscalidad", () => {
  beforeEach(() => {
    // Ensure window.cryptoControl baseline exists (from App.test.tsx pattern)
    window.cryptoControl = {
      assets: { list: async () => ({ ok: true as const, data: [] }) },
      market: {
        getCurrentPrice: async () => ({ ok: true as const, data: { price: 0, state: "live" as const, provider: "mock", fetchedAt: 0 } }),
        getHistoricalPrices: async () => ({ ok: true as const, data: { provider: "mock", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: 0, isCached: false } }),
        getOverview: async () => ({ ok: true as const, data: { price: null, change24h: null, high24h: null, low24h: null, volume24h: null, volumeChange24h: null, marketCap: null, dominance: null, fetchedAt: null, provider: "mock" } }),
        getFearGreed: async () => ({ ok: true as const, data: { value: 50, label: "Neutral", timestamp: 0, fetchedAt: 0, isCached: false } }),
        getGlobalMetrics: async () => ({ ok: true as const, data: { btcDominance: null, totalMarketCapUsd: null, fetchedAt: 0, isCached: false } }),
      },
      portfolio: {
        getSummary: async () => ({ ok: true as const, data: { totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "empty" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null } }),
        getPositions: async () => ({ ok: true as const, data: {} }),
        getAllocation: async () => ({ ok: true as const, data: [] }),
        getRealizedGains: async () => ({ ok: true as const, data: [] }),
        getFifoLots: async () => ({ ok: true as const, data: [] }),
        getHistoricalSeries: async () => ({ ok: true as const, data: { points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } } }),
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
        getGlobal: async () => ({ ok: true as const, data: { scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: 0, validUntil: null, state: "unavailable" as const } }),
        getAsset: async () => ({ ok: true as const, data: { scope: "asset" as const, assetId: "BTC", direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: 0, validUntil: null, state: "unavailable" as const } }),
        getHistory: async () => ({ ok: true as const, data: [] }),
        refresh: async () => ({ ok: true as const, data: { scope: "global" as const, direction: "neutral" as const, score: 0, confidence: 0, timeframe: "24h" as const, factors: [], sourceSummary: [], calculatedAt: 0, validUntil: null, state: "unavailable" as const } }),
      },
      targets: {
        list: async () => ({ ok: true as const, data: [] }),
        upsert: async () => ({ ok: true as const, data: { id: "mock-target" } }),
        delete: async () => ({ ok: true as const, data: null }),
      },
      alerts: {
        list: async () => ({ ok: true as const, data: [] }),
        create: async () => ({ ok: true as const, data: { id: "mock-alert" } }),
        delete: async () => ({ ok: true as const, data: null }),
        toggle: async () => ({ ok: true as const, data: null }),
      },
      investmentPlan: {
        list: async () => ({ ok: true as const, data: [] }),
        getActive: async () => ({ ok: true as const, data: null }),
        create: async () => ({ ok: true as const, data: { id: "mock-plan" } }),
        update: async () => ({ ok: true as const, data: { id: "mock-plan", name: "Plan", status: "active" as const, baseCurrency: "EUR", notes: null, createdAt: 0, updatedAt: 0 } }),
        delete: async () => ({ ok: true as const, data: null }),
      },
      investmentCycles: {
        list: async () => ({ ok: true as const, data: [] }),
      getCurrent: async () => ({ ok: true as const, data: null }),
        create: async () => ({ ok: true as const, data: { id: "mock-cycle" } }),
        update: async () => ({ ok: true as const, data: { id: "mock-cycle", planId: "mock-plan", name: "Ciclo", startDate: 0, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned" as const, priority: 0, notes: null, createdAt: 0, updatedAt: 0 } }),
        delete: async () => ({ ok: true as const, data: null }),
      },
      investmentAssets: {
        list: async () => ({ ok: true as const, data: [] }),
        create: async () => ({ ok: true as const, data: { id: "mock-investment-asset" } }),
        update: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "active" as const, isActive: true, notes: null, createdAt: 0, updatedAt: 0 } }),
      pause: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "paused" as const, isActive: false, notes: null, createdAt: 0, updatedAt: 0 } }),
      close: async () => ({ ok: true as const, data: { id: "mock-investment-asset", cycleId: "mock-cycle", assetId: "BTC", allocationType: "percentage" as const, allocationValue: 50, allocationPercentage: 50, fixedAmountEur: null, priority: 0, targetAmount: null, targetValueEur: null, targetPortfolioPercentage: null, startDate: 0, endDate: null, status: "closed" as const, isActive: false, notes: null, createdAt: 0, updatedAt: 0 } }),
        delete: async () => ({ ok: true as const, data: null }),
      },
      strategyRevisions: {
        list: async () => ({ ok: true as const, data: [] }),
        create: async () => ({ ok: true as const, data: { id: "mock-revision" } }),
      },
      treasury: {
        getSummary: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
        listMovements: async () => ({ ok: true as const, data: [] }),
        createMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement" } }),
        updateMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement", date: 0, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 0.01, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, createdAt: 0, updatedAt: 0 } }),
        deleteMovement: async () => ({ ok: true as const, data: null }),
        setFiscalReserve: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
        allocateEurcToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
      },
    };
  });

  test("empty state: muestra mensaje cuando no hay ventas", async () => {
    setupEmptyMock();
    renderWithQuery(<Fiscalidad />);
    await waitFor(() => {
      expect(screen.getByText(/Sin ganancias realizadas calculables/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No hay operaciones registradas/i)).toBeInTheDocument();
  });

  test("muestra el título de la página", async () => {
    setupEmptyMock();
    renderWithQuery(<Fiscalidad />);
    await waitFor(() => {
      expect(screen.getByText(/Fiscalidad/i)).toBeInTheDocument();
    });
  });

  test("con datos: muestra ganancia neta del año y activo", async () => {
    setupGainMock();
    renderWithQuery(<Fiscalidad />);
    await waitFor(() => {
      // Multiple elements contain "2024" — title, date, note
      expect(screen.getAllByText(/2024/).length).toBeGreaterThan(0);
    });
    // Asset id appears in table + mobile card (both in DOM, mobile hidden via CSS)
    expect(screen.getAllByText(/BITCOIN/i).length).toBeGreaterThan(0);
  });
});
