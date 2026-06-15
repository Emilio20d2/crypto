import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Operaciones } from "./pages/Operaciones";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

const mockAPI = () => {
  window.cryptoControl = {
    assets: {
      list: async () => ({
        ok: true as const,
        data: [
          { id: "BTC", symbol: "BTC", name: "Bitcoin", type: "crypto" as const, createdAt: 0, updatedAt: 0 },
          { id: "ETH", symbol: "ETH", name: "Ethereum", type: "crypto" as const, createdAt: 0, updatedAt: 0 }
        ]
      })
    },
    market: {
      getCurrentPrice: async () => ({ ok: true as const, data: { price: 50000, state: "live" as const, provider: "mock", fetchedAt: Date.now() } }),
      getHistoricalPrices: async () => ({ ok: true as const, data: { provider: "mock", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: Date.now(), isCached: false } }),
      getOverview: async () => ({
        ok: true as const,
        data: {
          price: 50000,
          change24h: 1.2,
          high24h: 50500,
          low24h: 49200,
          volume24h: 1000,
          volumeChange24h: null,
          marketCap: 1000000000,
          dominance: null,
          fetchedAt: Date.now(),
          provider: "mock"
        }
      }),
      getFearGreed: async () => ({ ok: true as const, data: { value: 50, label: "Neutral", timestamp: Date.now(), fetchedAt: Date.now(), isCached: false } }),
      getGlobalMetrics: async () => ({ ok: true as const, data: { btcDominance: 52.3, totalMarketCapUsd: 2.5e12, fetchedAt: Date.now(), isCached: false } }),
    },
    portfolio: {
      getSummary: async () => ({ ok: true as const, data: { totalValueEur: 0, totalInvestedEur: 0, unrealizedGainEur: 0, unrealizedGainPercentage: 0, valuationStatus: "complete" as const, valuedAssets: 0, unavailableAssets: 0, lastSuccessfulPriceAt: null } }),
      getPositions: async () => ({ ok: true as const, data: {} }),
      getAllocation: async () => ({ ok: true as const, data: [] }),
      getRealizedGains: async () => ({ ok: true as const, data: [] }),
      getFifoLots: async () => ({ ok: true as const, data: [] }),
      getHistoricalSeries: async () => ({ ok: true as const, data: { points: [], meta: { txCount: 0, pricePoints: 0, assetsTracked: [] } } }),
    },
    transactions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: { id: "test-id" } }),
      update: async () => ({ ok: true as const, data: null }),
      delete: async () => ({ ok: true as const, data: null })
    },
    settings: {
      get: async () => ({ ok: true as const, data: null }),
      update: async () => ({ ok: true as const, data: null })
    },
    coinbase: {
      importCredentialsFile: async () => ({ ok: true as const, data: { connected: false, canceled: true, keyDisplayName: "", algorithm: "ES256" as const, permissions: { canView: false, canTrade: false, canTransfer: false } } }),
      connectFromJson: async () => ({ ok: true as const, data: { connected: true, keyDisplayName: "••••abcd", algorithm: "ES256" as const, permissions: { canView: true, canTrade: false, canTransfer: false } } }),
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
};

beforeEach(mockAPI);

describe("Operaciones UI", () => {
  test("rechazar cantidades negativas mediante validación Zod", async () => {
    renderWithQuery(<Operaciones />);

    // Fill in only the amount field with a negative value and submit
    await act(async () => {
      const dateInput = screen.getByLabelText(/Fecha/i);
      fireEvent.change(dateInput, { target: { value: "2026-06-13T10:00" } });

      const amountInput = screen.getByLabelText(/^Cantidad/i);
      // Simulate entering a negative number
      fireEvent.change(amountInput, { target: { value: "-5", valueAsNumber: -5 } });

      const submitBtn = screen.getByText(/Guardar Operación/i);
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/La cantidad debe ser mayor a 0/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test("usa window.cryptoControl, no window.api", () => {
    expect(window.cryptoControl).toBeDefined();
    expect(window.cryptoControl.transactions).toBeDefined();
    expect(window.cryptoControl.settings).toBeDefined();
    expect((window as unknown as { api?: unknown }).api).toBeUndefined();
  });

  test("muestra historial vacío cuando no hay operaciones", async () => {
    renderWithQuery(<Operaciones />);
    await waitFor(() => {
      expect(screen.getByText(/Sin operaciones registradas/i)).toBeInTheDocument();
    });
  });
});
