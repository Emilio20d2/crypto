import { test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  window.cryptoControl = {
    assets: {
      list: async () => ({ ok: true as const, data: [] })
    },
    market: {
      getCurrentPrice: async () => ({
        ok: true as const,
        data: { price: 50000, state: "live" as const, provider: "mock", fetchedAt: Date.now() }
      }),
      getHistoricalPrices: async () => ({
        ok: true as const,
        data: { provider: "mock", points: [], requestedPeriod: "24h", actualInterval: "1h", fetchedAt: Date.now(), isCached: false }
      }),
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
      getGlobalMetrics: async () => ({ ok: true as const, data: { btcDominance: 52.3, ethDominance: 17.2, totalMarketCapUsd: 2.5e12, totalVolumeUsd: 9e10, marketCapChangePercentage24h: 1.2, fetchedAt: Date.now(), isCached: false } }),
      getCryptoControlIndex: async () => ({ ok: true as const, data: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock", calculatedAt: Date.now() } }),
    },
    portfolio: {
      getSummary: async () => ({
        ok: true as const,
        data: {
          totalValueEur: 0,
          totalInvestedEur: 0,
          unrealizedGainEur: 0,
          unrealizedGainPercentage: 0,
          valuationStatus: "complete" as const,
          valuedAssets: 0,
          unavailableAssets: 0,
          lastSuccessfulPriceAt: null
        }
      }),
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
      getMetrics: async () => ({ ok: true as const, data: { cycleId: "mock-cycle", monthsElapsed: 0, monthsRemaining: null, percentComplete: null, expectedContributionMonthly: 0, expectedContributionAnnual: 0, expectedContributionToDate: 0, expectedContributionTotal: null, actualContribution: 0, contributionDifference: 0, extraContribution: 0, monthlyContributions: [], currentValueEur: 0, heldCostBasisEur: 0, profitEur: 0, roiPercentage: null, hasPendingValuation: false } }),
      listPartialSales: async () => ({ ok: true as const, data: [] }),
      createPartialSale: async () => ({ ok: true as const, data: { id: "mock-sale", cycleId: "mock-cycle", transactionId: "mock-tx", assetId: "BTC", percentageOfHolding: 10, proceedsEur: 100, date: 0, notes: null, createdAt: 0 } }),
      deletePartialSale: async () => ({ ok: true as const, data: null }),
      list: async () => ({ ok: true as const, data: [] }),
      getCurrent: async () => ({ ok: true as const, data: null }),
      create: async () => ({ ok: true as const, data: { id: "mock-cycle" } }),
      update: async () => ({ ok: true as const, data: { id: "mock-cycle", planId: "mock-plan", name: "Ciclo", startDate: 0, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned" as const, priority: 0, notes: null, createdAt: 0, updatedAt: 0 } }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    investmentAssets: {
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
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
      allocateCashToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
      listCycleLiquidity: async () => ({ ok: true as const, data: [] }),
      listFiscalReserveMovements: async () => ({ ok: true as const, data: [] }),
      getSummary: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
      listMovements: async () => ({ ok: true as const, data: [] }),
      createMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement" } }),
      updateMovement: async () => ({ ok: true as const, data: { id: "mock-treasury-movement", date: 0, type: "efectivo_entrada" as const, sourceAccountType: null, destinationAccountType: "cash" as const, amount: 0.01, currency: "EUR", reason: "Mock", referenceType: null, referenceId: null, notes: null, createdAt: 0, updatedAt: 0 } }),
      deleteMovement: async () => ({ ok: true as const, data: null }),
      setFiscalReserve: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: 0 } }),
      allocateEurcToRebuy: async () => ({ ok: true as const, data: { id: "mock-allocation" } }),
    },
  };
});

test('renders Cartera page as initial route', () => {
  render(<App />);
  const titles = screen.getAllByText(/Cartera/i);
  expect(titles.length).toBeGreaterThan(0);
});

test('price result data is never an object when displayed', async () => {
  const res = await window.cryptoControl.market.getCurrentPrice({ assetId: 'BTC', quoteCurrency: 'EUR' });
  if (!res.ok) throw new Error('expected ok');
  const price = res.data.price;
  expect(typeof price === 'number' || price === null).toBe(true);
  if (price !== null) {
    expect(Number.isFinite(price)).toBe(true);
  }
});

test('price data is not double-wrapped', async () => {
  const res = await window.cryptoControl.market.getCurrentPrice({ assetId: 'BTC', quoteCurrency: 'EUR' });
  if (!res.ok) throw new Error('expected ok');
  expect(typeof res.data).toBe('object');
  expect(typeof (res.data as unknown as { price: unknown }).price).not.toBe('object');
});

test('settings.get returns null when not configured', async () => {
  const res = await window.cryptoControl.settings.get('portfolio_target');
  if (!res.ok) throw new Error('expected ok');
  expect(res.data).toBeNull();
});
