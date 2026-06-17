import { describe, expect, test, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlanInversion } from "./pages/PlanInversion";

function ok<T>(data: T) {
  return Promise.resolve({ ok: true as const, data });
}

function renderWithQuery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanInversion />
    </QueryClientProvider>
  );
}

let createInvestmentAssetMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const now = Date.now();
  createInvestmentAssetMock = vi.fn(() => ok({ id: "asset-new" }));
  (window as any).cryptoControl = {
    assets: {
      list: () => ok([
        { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto", logoUrl: null, createdAt: now, updatedAt: now },
        { id: "TON", symbol: "TON", name: "Toncoin", type: "crypto", logoUrl: null, createdAt: now, updatedAt: now },
      ]),
    },
    investmentPlan: {
      list: () => ok([{ id: "plan-1", name: "Plan principal", description: "DCA por ciclos", status: "active", baseCurrency: "EUR", notes: null, createdAt: now, updatedAt: now }]),
      getActive: () => ok({ id: "plan-1", name: "Plan principal", description: "DCA por ciclos", status: "active", baseCurrency: "EUR", notes: null, createdAt: now, updatedAt: now }),
      create: () => ok({ id: "plan-new" }),
      update: (_id: string, data: any) => ok({ id: "plan-1", name: data.name ?? "Plan principal", description: data.description ?? null, status: data.status ?? "active", baseCurrency: data.baseCurrency ?? "EUR", notes: data.notes ?? null, createdAt: now, updatedAt: now }),
      delete: () => ok(null),
    },
    investmentCycles: {
      list: () => ok([{ id: "cycle-1", planId: "plan-1", name: "Ciclo 2026-2030", startDate: now, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned", priority: 1, objetivo: null, riesgo: null, allowExtraContributions: true, notes: null, createdAt: now, updatedAt: now }]),
      getCurrent: async () => ({ ok: true as const, data: null }),
      getMetrics: async () => ({ ok: true as const, data: { cycleId: "cycle-1", monthsElapsed: 6, monthsRemaining: null, percentComplete: null, expectedContributionMonthly: 100, expectedContributionAnnual: 1200, expectedContributionToDate: 600, expectedContributionTotal: null, actualContribution: 600, contributionDifference: 0, extraContribution: 0, contributionCompliancePercentage: 100, monthlyContributions: [], currentValueEur: 650, heldCostBasisEur: 600, profitEur: 50, roiPercentage: 8.33, hasPendingValuation: false } }),
      listPartialSales: async () => ({ ok: true as const, data: [] }),
      createPartialSale: async () => ({ ok: true as const, data: { id: "mock-sale" } }),
      deletePartialSale: async () => ({ ok: true as const, data: null }),
      create: () => ok({ id: "cycle-new" }),
      update: (_id: string, data: any) => ok({ id: "cycle-1", planId: "plan-1", name: data.name ?? "Ciclo", startDate: data.startDate ?? now, endDate: data.endDate ?? null, monthlyAmountEur: data.monthlyAmountEur ?? 100, contributionCurrency: data.contributionCurrency ?? "EUR", status: data.status ?? "planned", priority: data.priority ?? 1, objetivo: data.objetivo ?? null, riesgo: data.riesgo ?? null, allowExtraContributions: data.allowExtraContributions ?? true, notes: data.notes ?? null, createdAt: now, updatedAt: now }),
      delete: () => ok(null),
    },
    transactions: {
      list: async () => ({ ok: true as const, data: [] }),
      create: async () => ({ ok: true as const, data: {} }),
      update: async () => ({ ok: true as const, data: null }),
      delete: async () => ({ ok: true as const, data: null }),
    },
    treasury: {
      listCycleLiquidity: async () => ({ ok: true as const, data: [] }),
      getSummary: async () => ({ ok: true as const, data: { cashBalance: 0, eurcBalance: 0, fiscalReserveBalance: 0, totalLiquidity: 0, freeRebuyLiquidity: 0, allocatedToRebuy: 0, freeCashForRebuy: 0, allocatedCashToRebuy: 0, recommendedFiscalReserve: 0, pendingEstimatedTaxes: 0, updatedAt: now } }),
      listMovements: async () => ({ ok: true as const, data: [] }),
      createMovement: async () => ({ ok: true as const, data: { id: "mock" } }),
      updateMovement: async () => ({ ok: true as const, data: null as never }),
      deleteMovement: async () => ({ ok: true as const, data: null }),
      setFiscalReserve: async () => ({ ok: true as const, data: null as never }),
      allocateEurcToRebuy: async () => ({ ok: true as const, data: { id: "mock" } }),
      allocateCashToRebuy: async () => ({ ok: true as const, data: { id: "mock" } }),
      listFiscalReserveMovements: async () => ({ ok: true as const, data: [] }),
    },
    investmentAssets: {
      list: () => ok([{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: null, status: "active", isActive: true, notes: null, createdAt: now, updatedAt: now }]),
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, tendencia: null, riesgoNivel: "bajo" as const, estadoEstrategico: "buena" as const, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
      create: createInvestmentAssetMock,
      update: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: data.assetId ?? "ADA", allocationType: data.allocationType ?? "percentage", allocationValue: data.allocationValue ?? 40, allocationPercentage: data.allocationPercentage ?? 40, fixedAmountEur: data.fixedAmountEur ?? null, priority: data.priority ?? 1, targetAmount: data.targetAmount ?? 1000, targetValueEur: data.targetValueEur ?? 2500, targetPortfolioPercentage: data.targetPortfolioPercentage ?? 15, startDate: data.startDate ?? now, endDate: data.endDate ?? null, status: data.status ?? "active", isActive: data.isActive ?? true, notes: data.notes ?? null, createdAt: now, updatedAt: now }),
      pause: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: data?.effectiveDate ?? now, status: "paused", isActive: false, notes: data?.notes ?? null, createdAt: now, updatedAt: now }),
      close: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: data?.effectiveDate ?? now, status: "closed", isActive: false, notes: data?.notes ?? null, createdAt: now, updatedAt: now }),
      delete: () => ok(null),
    },
    strategyRevisions: {
      list: () => ok([{ id: "rev-1", cycleId: "cycle-1", effectiveDate: now, title: "Pausar ADA", notes: "Desde esta revisión no se modifica el pasado.", changesJson: JSON.stringify({ type: "pause_asset", assetId: "ADA" }), createdAt: now }]),
      create: () => ok({ id: "rev-new" }),
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
      execute: async () => ({ ok: true as const, data: { fromInvestmentAssetId: "mock-ia", toInvestmentAssetId: null } }),
      delete:  async () => ({ ok: true as const, data: null }),
    },
    strategicAlerts: {
      generate: async () => ({ ok: true as const, data: [] }),
    },
    strategicDecisions: {
      getCycleReport: async () => ({ ok: true as const, data: { cycleId: "cycle-1", marketPhase: { phase: null, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock" }, partialSaleProposals: [], rebuyProposals: [], riskSummary: [], adaptationSuggestions: [], generatedAt: 0 } }),
    },
  };
});

describe("PlanInversion", () => {
  test("renderiza campos completos de ciclos, objetivos y revisiones", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getByText("Plan estratégico")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Ciclo 2026-2030/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText("Objetivo cantidad").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Objetivo valor EUR").length).toBeGreaterThan(0);
    expect(screen.getByText(/Pausar moneda · ADA/i)).toBeInTheDocument();
    expect(screen.getByText("Aporte mensual")).toBeInTheDocument();
    expect(screen.getByText(/Borrador: revisa que los porcentajes sumen 100%/i)).toBeInTheDocument();
    expect(document.querySelector("table")).toBeNull();
  });

  test("bloquea moneda activa duplicada con fechas solapadas", async () => {
    renderWithQuery();

    await waitFor(() => {
      expect(screen.getByText(/Ciclo 2026-2030/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Añadir moneda/i }));

    expect(await screen.findByText(/rango de fechas solapado/i)).toBeInTheDocument();
    expect(createInvestmentAssetMock).not.toHaveBeenCalled();
  });
});
