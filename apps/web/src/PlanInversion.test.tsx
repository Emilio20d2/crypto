import { describe, expect, test, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlanInversion } from "./pages/PlanInversion";

function ok<T>(data: T) {
  return Promise.resolve({ ok: true as const, data });
}

function renderWithQuery(initialPath = "/plan-inversion/configurar") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/plan-inversion/*" element={<PlanInversion />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
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
      catalog: () => ok([
        { id: "ADA", symbol: "ADA", name: "Cardano", type: "crypto", logoUrl: null, inDb: true, supportedProviders: ["coingecko"], hasCoinbase: false },
        { id: "TON", symbol: "TON", name: "Toncoin", type: "crypto", logoUrl: null, inDb: true, supportedProviders: ["coingecko"], hasCoinbase: false },
      ]),
      register: () => ok({ id: "REG", symbol: "REG", name: "Registered", type: "crypto", logoUrl: null, createdAt: now, updatedAt: now }),
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
      create: () => ok({ id: "cycle-new", planId: "plan-1", name: "Nueva etapa", startDate: now, endDate: null, monthlyAmountEur: 100, contributionCurrency: "EUR", status: "planned", priority: 0, objetivo: null, riesgo: null, allowExtraContributions: true, notes: null, createdAt: now, updatedAt: now }),
      update: (_id: string, data: any) => ok({ id: "cycle-1", planId: "plan-1", name: data.name ?? "Ciclo 2026-2030", startDate: data.startDate ?? now, endDate: data.endDate ?? null, monthlyAmountEur: data.monthlyAmountEur ?? 100, contributionCurrency: data.contributionCurrency ?? "EUR", status: data.status ?? "planned", priority: data.priority ?? 1, objetivo: data.objetivo ?? null, riesgo: data.riesgo ?? null, allowExtraContributions: data.allowExtraContributions ?? true, notes: data.notes ?? null, createdAt: now, updatedAt: now }),
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
    portfolio: {
      getPositions: () => ok({ ADA: { assetId: "ADA", balance: 500, averagePriceEur: 2, totalInvestedEur: 1000, hasPendingValuation: false } }),
      getAllocation: () => ok([{ assetId: "ADA", weight: 0.12, valueEur: 1200 }]),
      getSummary: () => ok({ totalValueEur: 10000, totalInvestedEur: 8000, unrealizedGainEur: 2000, unrealizedGainPercentage: 25, valuationStatus: "complete" as const, valuedAssets: 1, unavailableAssets: 0, lastSuccessfulPriceAt: now }),
    },
    investmentAssets: {
      list: () => ok([{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: null, status: "active", isActive: true, notes: null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now }]),
      getHealth: async () => ({ ok: true as const, data: { status: "activo" as const, relativeStrengthVsBtc: null, strongEntrySignal: false, tendencia: null, riesgoNivel: "bajo" as const, estadoEstrategico: "buena" as const, reasoning: "mock", signalsUsed: [], signalsUnavailable: [] } }),
      create: createInvestmentAssetMock,
      update: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: data.assetId ?? "ADA", allocationType: data.allocationType ?? "percentage", allocationValue: data.allocationValue ?? 40, allocationPercentage: data.allocationPercentage ?? 40, fixedAmountEur: data.fixedAmountEur ?? null, priority: data.priority ?? 1, targetAmount: data.targetAmount ?? 1000, targetValueEur: data.targetValueEur ?? 2500, targetPortfolioPercentage: data.targetPortfolioPercentage ?? 15, startDate: data.startDate ?? now, endDate: data.endDate ?? null, status: data.status ?? "active", isActive: data.isActive ?? true, notes: data.notes ?? null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now }),
      pause: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: data?.effectiveDate ?? now, status: "paused", isActive: false, notes: data?.notes ?? null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now }),
      close: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: 2500, targetPortfolioPercentage: 15, startDate: now, endDate: data?.effectiveDate ?? now, status: "closed", isActive: false, notes: data?.notes ?? null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now }),
      markGoalReached: (_id: string, data: any) => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: data?.effectiveDate ?? now, status: "goal_reached", isActive: false, notes: null, goalReachedAt: data?.effectiveDate ?? now, goalReachedValue: data?.observedValue ?? 1000, goalReachedType: data?.goalType ?? "quantity", createdAt: now, updatedAt: now }),
      reactivate: () => ok({ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: null, status: "active", isActive: true, notes: null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now }),
      delete: () => ok(null),
    },
    strategyRevisions: {
      list: () => ok([{ id: "rev-1", cycleId: "cycle-1", effectiveDate: now, title: "Pausar ADA", notes: "Desde esta revisión no se modifica el pasado.", changesJson: JSON.stringify({ type: "pause_asset", assetId: "ADA" }), createdAt: now }]),
      create: () => ok({ id: "rev-new" }),
    },
    contributionSchedule: {
      list:              async () => ({ ok: true as const, data: [] }),
      create:            async () => ({ ok: true as const, data: { id: "mock-contribution" } }),
      update:            async () => ({ ok: true as const, data: [] as never }),
      execute:           async () => ({ ok: true as const, data: [] as never }),
      delete:            async () => ({ ok: true as const, data: null }),
      getMonthlySummary: async () => ({ ok: true as const, data: { summaries: [], aggregates: { cycleId: "cycle-1", totalPlannedEur: 0, totalActualEur: 0, totalScheduledPortionEur: 0, totalExtraordinaryEur: 0, totalDeficitEur: 0, compliancePercentage: null, monthsCumplida: 0, monthsParcial: 0, monthsOmitida: 0, monthsSuperada: 0, lastContributionDate: null, nextScheduledDate: null } } }),
    },
    assetSubstitutions: {
      list:    async () => ({ ok: true as const, data: [] }),
      create:  async () => ({ ok: true as const, data: { id: "mock-substitution" } }),
      update:  async () => ({ ok: true as const, data: [] as never }),
      apply:   async () => ({ ok: true as const, data: { fromInvestmentAssetId: "mock-ia", toInvestmentAssetId: null } }),
      cancel:  async () => ({ ok: true as const, data: [] as never }),
      execute: async () => ({ ok: true as const, data: { fromInvestmentAssetId: "mock-ia", toInvestmentAssetId: null } }),
      delete:  async () => ({ ok: true as const, data: null }),
    },
    strategicAlerts: {
      generate: async () => ({ ok: true as const, data: [] }),
    },
    strategicDecisions: {
      getCycleReport: async () => ({ ok: true as const, data: { cycleId: "cycle-1", marketPhase: { phase: "incertidumbre" as const, confidence: "baja" as const, indicatorsUsed: [], indicatorsUnavailable: [], reasoning: "mock" }, partialSaleProposals: [], rebuyProposals: [], riskSummary: [], adaptationSuggestions: [], generatedAt: 0 } }),
    },
    perspectives: {
      getGoals:    async () => ({ ok: true as const, data: [] }),
      createGoal:  async () => ({ ok: true as const, data: { id: "mock-goal" } }),
      updateGoal:  async () => ({ ok: true as const, data: { id: "mock-goal", name: "mock", type: "personalizado" as const, targetAmountEur: 1000, targetDate: null, priority: 0, notes: null, createdAt: 0, updatedAt: 0 } }),
      deleteGoal:  async () => ({ ok: true as const, data: null }),
      getConsolidatedSnapshot: async () => ({ ok: true as const, data: { snapshotId: "snap-mock", generatedAt: 0, projectionStartDate: 0, planId: "plan-1", planName: "Plan mock", cycles: [], positions: {}, historicalCapitalEur: 0, historicalSalesEur: 0, historicalRebuysEur: 0, futureContributions: [], saleRules: [], rebuyTiers: [], substitutions: [], treasury: { cashEur: 0, eurcEur: 0, eurcAvailableEur: 0, fiscalReserveEur: 0, totalLiquidityEur: 0 }, prices: {}, dataQuality: { overallScore: 1, missingPrices: [], missingCosts: [], staleData: [], notes: [] }, fiscalVersion: "es-2024", strategyVersion: "v1" } }),
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
      create:   async () => ({ ok: true as const, data: { id: "mock-rule", cycleId: "cycle-1", assetId: "BTC", name: "mock", conditionType: "price_target" as const, sellPercentage: 25, priority: 0, status: "activa" as const, conditionValue: null, conditionValue2: null, effectiveDate: null, notes: null, lastTriggeredAt: null, planId: null, investmentAssetId: null, createdAt: 0, updatedAt: 0 } }),
      update:   async () => ({ ok: true as const, data: { id: "mock-rule", cycleId: "cycle-1", assetId: "BTC", name: "mock", conditionType: "price_target" as const, sellPercentage: 25, priority: 0, status: "activa" as const, conditionValue: null, conditionValue2: null, effectiveDate: null, notes: null, lastTriggeredAt: null, planId: null, investmentAssetId: null, createdAt: 0, updatedAt: 0 } }),
      delete:   async () => ({ ok: true as const, data: null }),
      evaluate: async () => ({ ok: true as const, data: [] }),
    },
    planMonitoring: {
      getSummary: async () => ({ ok: true as const, data: { cycleId: "cycle-1", planId: "plan-1", activeAssets: 0, goalsReached: 0, goalsNearby: 0, triggeredSaleRules: 0, triggeredRebuyRules: 0, pendingSubstitutions: 0, compliancePercentage: 100, deficitEur: 0, eurcAvailable: 0, fiscalReserve: 0, alerts: [], assetStatuses: [], generatedAt: 0 } }),
    },
  };
});

// ── Lista de etapas ───────────────────────────────────────────────────────────

describe("PlanConfigurar — lista de etapas", () => {
  test("muestra las etapas del plan activo en tarjetas compactas", async () => {
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => {
      expect(screen.getByText("Ciclo 2026-2030")).toBeInTheDocument();
    });

    expect(screen.getByText("Planificado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ver detalle/i })).toBeInTheDocument();
    // Asset count from mock (1 active asset)
    expect(screen.getByText("1 activas")).toBeInTheDocument();
  });

  test("muestra aviso cuando no hay plan activo", async () => {
    (window as any).cryptoControl.investmentPlan.getActive = () => ok(null);
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => {
      expect(screen.getByText(/no hay un plan activo/i)).toBeInTheDocument();
    });

    expect(screen.queryByText("Ciclo 2026-2030")).not.toBeInTheDocument();
  });

  test("muestra mensaje vacío cuando no hay etapas", async () => {
    (window as any).cryptoControl.investmentCycles.list = () => ok([]);
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => {
      expect(screen.getByText(/todavía no hay etapas/i)).toBeInTheDocument();
    });
  });

  test("muestra el formulario de nueva etapa al pulsar el botón", async () => {
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => expect(screen.getByText("Ciclo 2026-2030")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /nueva etapa/i }));

    expect(screen.getByText("Nueva etapa de inversión")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /crear etapa/i })).toBeInTheDocument();
  });

  test("valida campos obligatorios al crear etapa", async () => {
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => expect(screen.getByText("Ciclo 2026-2030")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /nueva etapa/i }));

    // Submit without filling fields
    fireEvent.click(screen.getByRole("button", { name: /crear etapa/i }));

    await waitFor(() => {
      expect(screen.getByText(/nombre de la etapa es obligatorio/i)).toBeInTheDocument();
    });
  });
});

// ── Detalle de etapa ──────────────────────────────────────────────────────────

describe("PlanEtapaDetalle — acceso por URL", () => {
  test("carga la etapa y muestra el formulario de edición", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => {
      expect(screen.getByText("Información de la etapa")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Ciclo 2026-2030")).toBeInTheDocument();
  });

  test("conserva el detalle al recargar directamente por URL", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => {
      expect(screen.getByText("Información de la etapa")).toBeInTheDocument();
    });

    // Form should be populated with cycle data
    const nameField = screen.getByDisplayValue("Ciclo 2026-2030");
    expect(nameField).toBeInTheDocument();
  });

  test("muestra error para etapa inexistente", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/nonexistent");

    await waitFor(() => {
      expect(screen.getByText(/no se ha encontrado la etapa/i)).toBeInTheDocument();
    });
  });

  test("navega al detalle desde la lista al pulsar 'Ver detalle'", async () => {
    renderWithQuery("/plan-inversion/configurar");

    await waitFor(() => expect(screen.getByText("Ciclo 2026-2030")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }));

    await waitFor(() => {
      expect(screen.getByText("Información de la etapa")).toBeInTheDocument();
    });
  });

  test("valida fecha de fin anterior al inicio", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => {
      expect(screen.getByText("Información de la etapa")).toBeInTheDocument();
    });

    // Find date inputs
    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length >= 2) {
      fireEvent.change(dateInputs[0], { target: { value: "2026-06-01" } });
      fireEvent.change(dateInputs[1], { target: { value: "2025-01-01" } }); // end before start
    }

    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => {
      expect(screen.getByText(/fecha de fin no puede ser anterior/i)).toBeInTheDocument();
    });
  });

  test("muestra sección de monedas de la etapa (segundo checkpoint)", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => {
      expect(screen.getByText("Monedas de esta etapa")).toBeInTheDocument();
    });
  });
});

// Helper: abre el formulario de añadir y espera a que aparezca
async function openAddAssetForm() {
  // Espera a que el botón header sea visible (carga inicial resuelta)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /añadir moneda/i })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: /añadir moneda/i }));
  // Espera a que el formulario aparezca
  await waitFor(() =>
    expect(screen.getByText("Añadir moneda a esta etapa")).toBeInTheDocument(),
  );
  // Devuelve el contenedor del formulario para queries con within
  return document.querySelector(".asset-add-form") as HTMLElement;
}

async function selectAssetInPicker(formEl: HTMLElement, assetId: string) {
  const trigger = formEl.querySelector(".asset-picker-trigger") as HTMLElement;
  fireEvent.click(trigger);
  const searchInput = await within(formEl).findByPlaceholderText(/buscar por nombre o ticker/i);
  fireEvent.change(searchInput, { target: { value: assetId } });
  await waitFor(() => {
    const items = within(formEl).getAllByRole("listitem");
    const match = items.find(li => li.textContent?.includes(assetId));
    expect(match).toBeDefined();
  });
  const items = within(formEl).getAllByRole("listitem");
  const match = items.find(li => li.textContent?.includes(assetId))!;
  fireEvent.click(match);
}

// ── PlanEtapaActivos — gestión de monedas ─────────────────────────────────────

describe("PlanEtapaActivos — gestión de monedas", () => {
  test("muestra las monedas de la etapa (filtradas por cycleId)", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // Espera a que cycleAssets y globalAssets carguen (card de asset + nombre)
    await waitFor(() => expect(screen.getAllByText(/ADA/)[0]).toBeInTheDocument());
    // El nombre del activo requiere que globalAssets se haya cargado
    await waitFor(() => expect(screen.getByText(/Cardano/i)).toBeInTheDocument());
  });

  test("muestra el formulario de añadir moneda al pulsar el botón", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    const formEl = await openAddAssetForm();
    expect(within(formEl).getByText("Compra continua")).toBeInTheDocument();
    expect(within(formEl).getByText("Compra hasta objetivo")).toBeInTheDocument();
  });

  test("impide moneda duplicada activa con fechas solapadas", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // Espera al card de ADA (cycleAssets y globalAssets cargados)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();
    // ADA es el primer activo del selector
    // Rellenar porcentaje válido para superar la validación de asignación
    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "40" } });
    // La fecha de inicio coincide con cycle.startDate (now) → solapamiento con asset-1 (ADA activo)
    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));
    await waitFor(() =>
      expect(screen.getByText(/rango de fechas solapado/i)).toBeInTheDocument(),
    );
    expect(createInvestmentAssetMock).not.toHaveBeenCalled();
  });

  test("crea una moneda con compra continua y porcentaje", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    // Seleccionar TON (no está en el ciclo)
    await selectAssetInPicker(formEl, "TON");

    // Porcentaje
    const pctInput = within(formEl).getByPlaceholderText(/ej\. 40/i);
    fireEvent.change(pctInput, { target: { value: "30" } });

    // Fecha de inicio anterior al ciclo → no hay solapamiento con ADA
    fireEvent.change(formEl.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-01-01" } });

    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: "cycle-1",
          assetId: "TON",
          allocationType: "percentage",
          allocationPercentage: 30,
          targetAmount: null,
          targetValueEur: null,
          targetPortfolioPercentage: null,
        }),
      ),
    );
  });

  test("crea una moneda con compra hasta objetivo por cantidad", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    await selectAssetInPicker(formEl, "TON");

    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "20" } });

    // Cambiar a "Compra hasta objetivo"
    const comboboxes = within(formEl).getAllByRole("combobox");
    const accumulationSelect = comboboxes.find(
      el => (el as HTMLSelectElement).value === "continua",
    )!;
    fireEvent.change(accumulationSelect, { target: { value: "hasta_objetivo" } });

    // Seleccionar tipo "cantidad"
    const comboboxes2 = within(formEl).getAllByRole("combobox");
    const targetTypeSelect = comboboxes2.find(
      el => (el as HTMLSelectElement).value === "cantidad",
    )!;
    fireEvent.change(targetTypeSelect, { target: { value: "cantidad" } });

    // El campo objetivo es un input decimal vacío (el de porcentaje ya tiene valor)
    const emptyDecimalInputs = Array.from(formEl.querySelectorAll('input[inputmode="decimal"]')).filter(
      el => (el as HTMLInputElement).value === "",
    );
    if (emptyDecimalInputs[0]) fireEvent.change(emptyDecimalInputs[0], { target: { value: "250" } });

    fireEvent.change(formEl.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-01-01" } });

    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "TON",
          targetAmount: 250,
          targetValueEur: null,
          targetPortfolioPercentage: null,
        }),
      ),
    );
  });

  test("crea una moneda con objetivo por valor en euros", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    await selectAssetInPicker(formEl, "TON");
    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "20" } });

    const accumulationSelect = within(formEl).getAllByRole("combobox").find(
      el => (el as HTMLSelectElement).value === "continua",
    )!;
    fireEvent.change(accumulationSelect, { target: { value: "hasta_objetivo" } });

    const targetTypeSelect = within(formEl).getAllByRole("combobox").find(
      el => (el as HTMLSelectElement).value === "cantidad",
    )!;
    fireEvent.change(targetTypeSelect, { target: { value: "valor" } });

    const emptyDecimalInputs = Array.from(formEl.querySelectorAll('input[inputmode="decimal"]')).filter(
      el => (el as HTMLInputElement).value === "",
    );
    if (emptyDecimalInputs[0]) fireEvent.change(emptyDecimalInputs[0], { target: { value: "5000" } });

    fireEvent.change(formEl.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-01-01" } });
    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          targetValueEur: 5000,
          targetAmount: null,
          targetPortfolioPercentage: null,
        }),
      ),
    );
  });

  test("crea una moneda con objetivo por porcentaje de cartera", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    await selectAssetInPicker(formEl, "TON");
    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "20" } });

    const accumulationSelect = within(formEl).getAllByRole("combobox").find(
      el => (el as HTMLSelectElement).value === "continua",
    )!;
    fireEvent.change(accumulationSelect, { target: { value: "hasta_objetivo" } });

    const targetTypeSelect = within(formEl).getAllByRole("combobox").find(
      el => (el as HTMLSelectElement).value === "cantidad",
    )!;
    fireEvent.change(targetTypeSelect, { target: { value: "porcentaje_cartera" } });

    const emptyDecimalInputs = Array.from(formEl.querySelectorAll('input[inputmode="decimal"]')).filter(
      el => (el as HTMLInputElement).value === "",
    );
    if (emptyDecimalInputs[0]) fireEvent.change(emptyDecimalInputs[0], { target: { value: "60" } });

    fireEvent.change(formEl.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-01-01" } });
    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPortfolioPercentage: 60,
          targetAmount: null,
          targetValueEur: null,
        }),
      ),
    );
  });

  test("permite crear moneda con fecha final (fecha no nula)", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    await selectAssetInPicker(formEl, "TON");
    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "20" } });

    const dateInputs = formEl.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-01-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-12-31" } });

    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: new Date("2027-12-31T00:00:00").getTime() }),
      ),
    );
  });

  test("permite crear moneda con fecha final abierta (endDate null)", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    const formEl = await openAddAssetForm();

    await selectAssetInPicker(formEl, "TON");
    fireEvent.change(within(formEl).getByPlaceholderText(/ej\. 40/i), { target: { value: "20" } });

    fireEvent.change(formEl.querySelectorAll('input[type="date"]')[0], { target: { value: "2026-01-01" } });
    // endDate queda vacío → null

    fireEvent.click(within(formEl).getByRole("button", { name: /añadir moneda/i }));

    await waitFor(() =>
      expect(createInvestmentAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: null }),
      ),
    );
  });

  test("muestra botón Editar por cada moneda de la etapa", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // El botón Editar solo aparece cuando cycleAssets ha cargado
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
  });

  test("expande el formulario de edición al pulsar Editar", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Editar$/i }));
    // "Pausar compras" solo aparece en el formulario de edición de activos
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /pausar compras/i })).toBeInTheDocument(),
    );
    // Hay 2 botones "Guardar cambios": ciclo + activo
    expect(screen.getAllByRole("button", { name: /guardar cambios/i })).toHaveLength(2);
  });

  test("muestra estado Activa para la moneda del mock", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Activa")).toBeInTheDocument());
  });
});

// ── PlanRepartoMensual — distribución del presupuesto ─────────────────────────

describe("PlanRepartoMensual — reparto mensual", () => {
  test("muestra el reparto con porcentajes de las monedas activas", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Reparto mensual")).toBeInTheDocument());
    // ADA tiene 40% → esperar a que la query investment-assets resuelva y renderice
    await waitFor(() => expect(screen.getAllByText(/40/)[0]).toBeInTheDocument());
  });

  test("muestra advertencia cuando el porcentaje no suma 100%", async () => {
    // Mock solo tiene ADA al 40% → falta el 60%
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Reparto mensual")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/pendiente de asignar/i)).toBeInTheDocument());
  });

  test("muestra advertencia cuando el porcentaje supera el 100%", async () => {
    const now = Date.now();
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({
        ok: true as const,
        data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA",
          allocationType: "percentage", allocationValue: 110, allocationPercentage: 110,
          fixedAmountEur: null, priority: 1, targetAmount: null, targetValueEur: null,
          targetPortfolioPercentage: null, startDate: now, endDate: null,
          status: "active", isActive: true, notes: null, createdAt: now, updatedAt: now }],
      });
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Reparto mensual")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/supera el 100%/i)).toBeInTheDocument());
  });

  test("muestra importe libre cuando los importes fijos no cubren el total", async () => {
    const now = Date.now();
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({
        ok: true as const,
        data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA",
          allocationType: "amount", allocationValue: 60, allocationPercentage: null,
          fixedAmountEur: 60, priority: 1, targetAmount: null, targetValueEur: null,
          targetPortfolioPercentage: null, startDate: now, endDate: null,
          status: "active", isActive: true, notes: null, createdAt: now, updatedAt: now }],
      });
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Reparto mensual")).toBeInTheDocument());
    // 100€ - 60€ fijo = 40€ libres
    await waitFor(() => expect(screen.getByText(/quedan/i)).toBeInTheDocument());
  });

  test("muestra advertencia cuando los importes fijos superan el mensual", async () => {
    const now = Date.now();
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({
        ok: true as const,
        data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA",
          allocationType: "amount", allocationValue: 150, allocationPercentage: null,
          fixedAmountEur: 150, priority: 1, targetAmount: null, targetValueEur: null,
          targetPortfolioPercentage: null, startDate: now, endDate: null,
          status: "active", isActive: true, notes: null, createdAt: now, updatedAt: now }],
      });
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Reparto mensual")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/supera la aportación mensual/i)).toBeInTheDocument());
  });
});

// ── PlanCambiosEstrategia — revisiones ───────────────────────────────────────

describe("PlanCambiosEstrategia — revisiones de estrategia", () => {
  test("muestra las revisiones existentes del ciclo", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByText("Cambios del plan")).toBeInTheDocument());
    // La query strategy-revisions es async; esperar a que "Pausar ADA" aparezca
    await waitFor(() => expect(screen.getByText("Pausar ADA")).toBeInTheDocument());
  });

  test("muestra el formulario para registrar un cambio", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => expect(screen.getByText("Cambios del plan")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /registrar cambio/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/cambio de estrategia/i)).toBeInTheDocument();
  });

  test("valida que el título sea obligatorio", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => expect(screen.getByText("Cambios del plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /registrar cambio/i }));

    await waitFor(() => {
      expect(screen.getByText(/título o motivo es obligatorio/i)).toBeInTheDocument();
    });
  });

  test("registra un cambio con fecha efectiva", async () => {
    const createRevisionMock = vi.fn(() => Promise.resolve({ ok: true as const, data: { id: "rev-2" } }));
    (window as any).cryptoControl.strategyRevisions.create = createRevisionMock;

    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");

    await waitFor(() => expect(screen.getByText("Cambios del plan")).toBeInTheDocument());

    const titleInput = screen.getByPlaceholderText(/cambio de estrategia/i);
    fireEvent.change(titleInput, { target: { value: "Ampliar ADA al 50%" } });

    fireEvent.click(screen.getByRole("button", { name: /registrar cambio/i }));

    await waitFor(() => {
      expect(createRevisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: "cycle-1",
          title: "Ampliar ADA al 50%",
        }),
      );
    });
  });
});

// ── G-A3 — Detección de objetivos y progreso ─────────────────────────────────

describe("PlanEtapaActivos — progreso de objetivos (G-A3)", () => {
  test("muestra sección de progreso para activos con objetivo de cantidad", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // ADA tiene targetAmount: 1000 y balance: 500 → 50%
    await waitFor(() => expect(screen.getAllByText(/ADA/)[0]).toBeInTheDocument());
    // El texto puede ser "500 / 1000 monedas (50%)" o "500 / 1.000 monedas (50%)" según locale
    await waitFor(() => expect(screen.getByText(/500.*monedas.*50%/i)).toBeInTheDocument());
  });

  test("botón 'Marcar como alcanzado' aparece en el formulario cuando hay datos de posición", async () => {
    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Editar$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /marcar como alcanzado/i })).toBeInTheDocument(),
    );
  });

  test("'Marcar como alcanzado' llama a markGoalReached con datos del portfolio", async () => {
    const markMock = vi.fn(() => Promise.resolve({
      ok: true as const,
      data: { id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage" as const, allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: Date.now(), endDate: Date.now(), status: "goal_reached" as const, isActive: false, notes: null, goalReachedAt: Date.now(), goalReachedValue: 500, goalReachedType: "quantity" as const, createdAt: Date.now(), updatedAt: Date.now() },
    }));
    (window as any).cryptoControl.investmentAssets.markGoalReached = markMock;

    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Editar$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Editar$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /marcar como alcanzado/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /marcar como alcanzado/i }));

    await waitFor(() =>
      expect(markMock).toHaveBeenCalledWith(
        "asset-1",
        expect.objectContaining({ goalType: "quantity", observedValue: 500 }),
      ),
    );
  });

  test("activo con status goal_reached muestra sección 'Objetivo alcanzado' y botón Reactivar", async () => {
    const now = Date.now();
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({ ok: true, data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: now, status: "goal_reached", isActive: false, notes: null, goalReachedAt: now, goalReachedValue: 1000, goalReachedType: "quantity", createdAt: now, updatedAt: now }] });

    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // Hay varios elementos con "Objetivo alcanzado" (badge + sección)
    await waitFor(() => expect(screen.getAllByText(/Objetivo alcanzado/i).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: /reactivar/i })).toBeInTheDocument());
  });

  test("botón Reactivar llama a reactivate con el id del activo", async () => {
    const now = Date.now();
    const reactivateMock = vi.fn(() => Promise.resolve({ ok: true as const, data: { id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage" as const, allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: null, status: "active" as const, isActive: true, notes: null, goalReachedAt: null, goalReachedValue: null, goalReachedType: null, createdAt: now, updatedAt: now } }));
    (window as any).cryptoControl.investmentAssets.reactivate = reactivateMock;
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({ ok: true, data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: now, status: "goal_reached", isActive: false, notes: null, goalReachedAt: now, goalReachedValue: 1000, goalReachedType: "quantity", createdAt: now, updatedAt: now }] });

    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    await waitFor(() => expect(screen.getByRole("button", { name: /reactivar/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reactivar/i }));

    await waitFor(() => expect(reactivateMock).toHaveBeenCalledWith("asset-1"));
  });

  test("activo goal_reached no muestra botón Editar", async () => {
    const now = Date.now();
    (window as any).cryptoControl.investmentAssets.list = () =>
      Promise.resolve({ ok: true, data: [{ id: "asset-1", cycleId: "cycle-1", assetId: "ADA", allocationType: "percentage", allocationValue: 40, allocationPercentage: 40, fixedAmountEur: null, priority: 1, targetAmount: 1000, targetValueEur: null, targetPortfolioPercentage: null, startDate: now, endDate: now, status: "goal_reached", isActive: false, notes: null, goalReachedAt: now, goalReachedValue: 1000, goalReachedType: "quantity", createdAt: now, updatedAt: now }] });

    renderWithQuery("/plan-inversion/configurar/etapas/cycle-1");
    // Esperar que el botón Reactivar aparezca (confirma que el estado goal_reached se renderizó)
    await waitFor(() => expect(screen.getByRole("button", { name: /reactivar/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Editar$/i })).not.toBeInTheDocument();
  });
});

describe("Plan — secciones internas visibles", () => {
  test("muestra Compra Inteligente como página interna real del Plan", async () => {
    renderWithQuery("/plan-inversion/compra-inteligente");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /compra inteligente/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/aportaciones eur/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /analizar compra/i })).toBeInTheDocument();
  });

  test("muestra Ventas/Recompras como página interna real del Plan", async () => {
    renderWithQuery("/plan-inversion/ventas-recompras");

    await waitFor(() => {
      expect(screen.getByText(/reglas de recogida de beneficios/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/compras en caídas/i)).toBeInTheDocument();
  });

  test("Aportaciones queda solo sincronizada con Coinbase y sin registro manual", async () => {
    renderWithQuery("/plan-inversion/aportaciones");

    await waitFor(() => {
      expect(screen.getByText(/aportaciones reales sincronizadas desde operaciones\/coinbase/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/registrar ajuste manual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confirmar aportación/i)).not.toBeInTheDocument();
  });
});
