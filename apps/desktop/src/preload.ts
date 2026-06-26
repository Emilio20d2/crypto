import { contextBridge, ipcRenderer } from "electron";
import type {
  CoinbaseCredentials,
  CreateInvestmentAssetInput,
  CreateInvestmentCycleInput,
  CreateInvestmentPlanInput,
  CreateStrategyRevisionInput,
  CreateTreasuryMovementInput,
  CreateTransactionInput,
  CreatePartialSaleInput,
  CreateContributionScheduleInput,
  UpdateContributionScheduleInput,
  CreateAssetSubstitutionInput,
  UpdateAssetSubstitutionInput,
  InvestmentAssetStateChangeInput,
  MarkGoalReachedInput,
  SetFiscalReserveInput,
  AllocateEurcToRebuyInput,
  AllocateCashToRebuyInput,
  UpdateInvestmentAssetInput,
  UpdateInvestmentCycleInput,
  UpdateInvestmentPlanInput,
  UpdateTreasuryMovementInput,
  CreatePartialSaleRuleInput,
  UpdatePartialSaleRuleInput,
} from "@crypto-control/core";

const cryptoControl = {
  assets: {
    list:     () =>                 ipcRenderer.invoke("assets:list"),
    catalog:  () =>                 ipcRenderer.invoke("assets:catalog"),
    register: (input: unknown) =>   ipcRenderer.invoke("assets:register", input),
  },
  portfolio: {
    getSummary:        () => ipcRenderer.invoke("portfolio:get-summary"),
    getPositions:      () => ipcRenderer.invoke("portfolio:get-positions"),
    getAllocation:      () => ipcRenderer.invoke("portfolio:get-allocation"),
    getRealizedGains:     () => ipcRenderer.invoke("portfolio:get-realized-gains"),
    getFifoLots:          () => ipcRenderer.invoke("portfolio:get-fifo-lots"),
    getHistoricalSeries:  (input?: { period?: string }) => ipcRenderer.invoke("portfolio:get-historical-series", input),
    backfillCostBasis:    () => ipcRenderer.invoke("portfolio:backfillCostBasis"),
    getLiveSnapshot:      (portfolioUuid: string) => ipcRenderer.invoke("portfolio:get-live-snapshot", portfolioUuid),
    onLiveSnapshot:       (callback: (snapshot: unknown) => void) => {
      const handler = (_event: unknown, snapshot: unknown) => callback(snapshot);
      ipcRenderer.on("portfolio:live-snapshot", handler);
      return () => ipcRenderer.removeListener("portfolio:live-snapshot", handler);
    },
  },
  diagnostics: {
    getReport: () => ipcRenderer.invoke("diagnostics:getReport"),
  },
  transactions: {
    list:   ()                                     => ipcRenderer.invoke("transactions:list"),
    create: (data: CreateTransactionInput)         => ipcRenderer.invoke("transactions:create", data),
    update: (id: string, data: CreateTransactionInput) => ipcRenderer.invoke("transactions:update", id, data),
    delete: (id: string)                           => ipcRenderer.invoke("transactions:delete", id),
  },
  market: {
    getCurrentPrice:    (input: { assetId: string; quoteCurrency: string })                    => ipcRenderer.invoke("market:get-current-price", input),
    getHistoricalPrices:(input: { assetId: string; quoteCurrency: string; period: string })    => ipcRenderer.invoke("market:get-historical-prices", input),
    getOverview:        (input: { assetId: string; quoteCurrency: string })                    => ipcRenderer.invoke("market:get-overview", input),
    getFearGreed:       ()                                                                      => ipcRenderer.invoke("market:get-fear-greed"),
    getGlobalMetrics:   ()                                                                      => ipcRenderer.invoke("market:get-global-metrics"),
    getCryptoControlIndex: ()                                                                   => ipcRenderer.invoke("market:getCryptoControlIndex"),
  },
  settings: {
    get:    (key: string)               => ipcRenderer.invoke("settings:get", key),
    update: (key: string, value: string)=> ipcRenderer.invoke("settings:update", key, value),
  },
  coinbase: {
    importCredentialsFile: ()                           => ipcRenderer.invoke("coinbase:import-credentials-file"),
    connectFromJson:       (jsonContent: string)        => ipcRenderer.invoke("coinbase:connect-from-json", jsonContent),
    connect:               (credentials: CoinbaseCredentials) => ipcRenderer.invoke("coinbase:connect", credentials),
    disconnect:            ()                           => ipcRenderer.invoke("coinbase:disconnect"),
    getStatus:             ()                           => ipcRenderer.invoke("coinbase:get-status"),
    sync:                  ()                           => ipcRenderer.invoke("coinbase:sync"),
    getSyncHistory:        ()                           => ipcRenderer.invoke("coinbase:get-sync-history"),
    listPortfolios:        ()                           => ipcRenderer.invoke("coinbase:list-portfolios"),
    getPortfolioBreakdown: (portfolioUuid: string, currency: string) => ipcRenderer.invoke("coinbase:get-portfolio-breakdown", portfolioUuid, currency),
    getPortfolioSnapshots: (portfolioUuid: string)      => ipcRenderer.invoke("coinbase:get-portfolio-snapshots", portfolioUuid),
    previewOrder:          (input: unknown)             => ipcRenderer.invoke("coinbase:preview-order", input),
    submitOrder:           (input: unknown)             => ipcRenderer.invoke("coinbase:submit-order", input),
    listPendingOrders:     ()                           => ipcRenderer.invoke("coinbase:list-pending-orders"),
    listScheduledOperations: ()                         => ipcRenderer.invoke("coinbase:list-scheduled-operations"),
    createScheduledOperation: (input: unknown)          => ipcRenderer.invoke("coinbase:create-scheduled-operation", input),
    deleteScheduledOperation: (id: string)              => ipcRenderer.invoke("coinbase:delete-scheduled-operation", id),
  },
  sentiment: {
    getGlobal: (input: unknown) => ipcRenderer.invoke("sentiment:get-global", input),
    getAsset:  (input: unknown) => ipcRenderer.invoke("sentiment:get-asset", input),
    getHistory:(input: unknown) => ipcRenderer.invoke("sentiment:get-history", input),
    refresh:   (input: unknown) => ipcRenderer.invoke("sentiment:refresh", input),
  },
  targets: {
    list:   ()                                                                    => ipcRenderer.invoke("targets:list"),
    upsert: (data: { id?: string; assetId: string; targetPriceEur: number })     => ipcRenderer.invoke("targets:upsert", data),
    delete: (id: string)                                                          => ipcRenderer.invoke("targets:delete", id),
  },
  alerts: {
    list:   ()                                                                                              => ipcRenderer.invoke("alerts:list"),
    create: (data: { assetId: string; priceThreshold: number; direction: "above" | "below" })              => ipcRenderer.invoke("alerts:create", data),
    delete: (id: string)                                                                                   => ipcRenderer.invoke("alerts:delete", id),
    toggle: (id: string)                                                                                   => ipcRenderer.invoke("alerts:toggle", id),
  },
  investmentPlan: {
    list:      ()                                             => ipcRenderer.invoke("investmentPlan:list"),
    getActive: ()                                             => ipcRenderer.invoke("investmentPlan:getActive"),
    create:    (data: CreateInvestmentPlanInput)              => ipcRenderer.invoke("investmentPlan:create", data),
    update:    (id: string, data: UpdateInvestmentPlanInput)   => ipcRenderer.invoke("investmentPlan:update", id, data),
    delete:    (id: string)                                   => ipcRenderer.invoke("investmentPlan:delete", id),
  },
  investmentCycles: {
    list:   (input?: { planId?: string })                     => ipcRenderer.invoke("investmentCycles:list", input),
    getCurrent: (input?: { planId?: string; at?: number })     => ipcRenderer.invoke("investmentCycles:getCurrent", input),
    create: (data: CreateInvestmentCycleInput)                => ipcRenderer.invoke("investmentCycles:create", data),
    update: (id: string, data: UpdateInvestmentCycleInput)     => ipcRenderer.invoke("investmentCycles:update", id, data),
    delete: (id: string)                                      => ipcRenderer.invoke("investmentCycles:delete", id),
    getMetrics: (input: { cycleId: string })                  => ipcRenderer.invoke("investmentCycles:getMetrics", input),
    listPartialSales:   (input?: { cycleId?: string })        => ipcRenderer.invoke("investmentCycles:listPartialSales", input),
    createPartialSale:  (data: CreatePartialSaleInput)        => ipcRenderer.invoke("investmentCycles:createPartialSale", data),
    deletePartialSale:  (id: string)                          => ipcRenderer.invoke("investmentCycles:deletePartialSale", id),
  },
  investmentAssets: {
    list:   (input?: { cycleId?: string })                    => ipcRenderer.invoke("investmentAssets:list", input),
    create: (data: CreateInvestmentAssetInput)                => ipcRenderer.invoke("investmentAssets:create", data),
    update: (id: string, data: UpdateInvestmentAssetInput)     => ipcRenderer.invoke("investmentAssets:update", id, data),
    pause:  (id: string, data?: InvestmentAssetStateChangeInput) => ipcRenderer.invoke("investmentAssets:pause", id, data),
    close:  (id: string, data?: InvestmentAssetStateChangeInput) => ipcRenderer.invoke("investmentAssets:close", id, data),
    markGoalReached: (id: string, data: MarkGoalReachedInput) => ipcRenderer.invoke("investmentAssets:markGoalReached", id, data),
    reactivate: (id: string)                                  => ipcRenderer.invoke("investmentAssets:reactivate", id),
    delete: (id: string)                                      => ipcRenderer.invoke("investmentAssets:delete", id),
    getHealth: (input: { assetId: string })                  => ipcRenderer.invoke("investmentAssets:getHealth", input),
  },
  strategyRevisions: {
    list:   (input?: { cycleId?: string })                    => ipcRenderer.invoke("strategyRevisions:list", input),
    create: (data: CreateStrategyRevisionInput)               => ipcRenderer.invoke("strategyRevisions:create", data),
  },
  contributionSchedule: {
    list:               (input?: { cycleId?: string; status?: string })     => ipcRenderer.invoke("contributionSchedule:list", input),
    create:             (data: CreateContributionScheduleInput)              => ipcRenderer.invoke("contributionSchedule:create", data),
    update:             (id: string, data: UpdateContributionScheduleInput) => ipcRenderer.invoke("contributionSchedule:update", id, data),
    execute:            (id: string)                                         => ipcRenderer.invoke("contributionSchedule:execute", id),
    delete:             (id: string)                                         => ipcRenderer.invoke("contributionSchedule:delete", id),
    getMonthlySummary:  (input: { cycleId: string })                         => ipcRenderer.invoke("contributionSchedule:getMonthlySummary", input),
  },
  assetSubstitutions: {
    list:    (input?: { cycleId?: string; fromAssetId?: string; status?: string }) => ipcRenderer.invoke("assetSubstitutions:list", input),
    create:  (data: CreateAssetSubstitutionInput)                                   => ipcRenderer.invoke("assetSubstitutions:create", data),
    update:  (id: string, data: UpdateAssetSubstitutionInput)                       => ipcRenderer.invoke("assetSubstitutions:update", id, data),
    apply:   (id: string)                                                            => ipcRenderer.invoke("assetSubstitutions:apply", id),
    cancel:  (id: string)                                                            => ipcRenderer.invoke("assetSubstitutions:cancel", id),
    execute: (id: string)                                                            => ipcRenderer.invoke("assetSubstitutions:execute", id),
    delete:  (id: string)                                                            => ipcRenderer.invoke("assetSubstitutions:delete", id),
  },
  strategicAlerts: {
    generate: (input: { cycleId: string })                         => ipcRenderer.invoke("strategicAlerts:generate", input),
  },
  strategicDecisions: {
    getCycleReport: (input: { cycleId: string })                   => ipcRenderer.invoke("strategicDecisions:getCycleReport", input),
  },
  perspectives: {
    getGoals:    ()                                                => ipcRenderer.invoke("perspectives:getGoals"),
    createGoal:  (data: unknown)                                   => ipcRenderer.invoke("perspectives:createGoal", data),
    updateGoal:  (id: string, data: unknown)                       => ipcRenderer.invoke("perspectives:updateGoal", id, data),
    deleteGoal:  (id: string)                                      => ipcRenderer.invoke("perspectives:deleteGoal", id),
    getConsolidatedSnapshot: ()                                    => ipcRenderer.invoke("perspectives:getConsolidatedSnapshot"),
    getProjection:           (input?: unknown)                     => ipcRenderer.invoke("perspectives:getProjection", input),
    getAnalystForecasts:     ()                                    => ipcRenderer.invoke("perspectives:getAnalystForecasts"),
    getForecastStatus:       ()                                    => ipcRenderer.invoke("perspectives:getForecastStatus"),
    addObservation:          (obs: unknown)                        => ipcRenderer.invoke("perspectives:addObservation", obs),
    runIngestion:            (opts?: unknown)                      => ipcRenderer.invoke("perspectives:runIngestion", opts),
  },
  persp2: {
    getSimulation: (input?: { horizonYears?: number; policy?: "plan_base" | "full_strategy" }) =>
      ipcRenderer.invoke("persp2:getSimulation", input),
  },
  smartBuy: {
    getRecommendation: (input: unknown) => ipcRenderer.invoke("smartBuy:getRecommendation", input),
  },
  rebuyTiers: {
    list:     (input: unknown)   => ipcRenderer.invoke("rebuyTiers:list", input),
    upsert:   (data: unknown)    => ipcRenderer.invoke("rebuyTiers:upsert", data),
    delete:   (id: string)       => ipcRenderer.invoke("rebuyTiers:delete", id),
    evaluate: (input: unknown)   => ipcRenderer.invoke("rebuyTiers:evaluate", input),
  },
  partialSaleRules: {
    list:     (input: unknown)                                  => ipcRenderer.invoke("partialSaleRules:list", input),
    create:   (data: CreatePartialSaleRuleInput)                => ipcRenderer.invoke("partialSaleRules:create", data),
    update:   (id: string, data: UpdatePartialSaleRuleInput)    => ipcRenderer.invoke("partialSaleRules:update", id, data),
    delete:   (id: string)                                      => ipcRenderer.invoke("partialSaleRules:delete", id),
    evaluate: (input: unknown)                                  => ipcRenderer.invoke("partialSaleRules:evaluate", input),
  },
  planMonitoring: {
    getSummary: (input: unknown) => ipcRenderer.invoke("planMonitoring:getSummary", input),
  },
  signals: {
    evaluate:    ()                    => ipcRenderer.invoke("signals:evaluate"),
    list:        (input?: { status?: string; assetId?: string }) => ipcRenderer.invoke("signals:list", input),
    acknowledge: (id: string)          => ipcRenderer.invoke("signals:acknowledge", id),
    dismiss:     (id: string)          => ipcRenderer.invoke("signals:dismiss", id),
  },
  trade: {
    getAlerts: () => ipcRenderer.invoke("trade:get-alerts"),
    onNewAlerts: (cb: (alerts: unknown) => void) => {
      const handler = (_: unknown, alerts: unknown) => cb(alerts);
      ipcRenderer.on("trade:new-alerts", handler);
      return () => ipcRenderer.removeListener("trade:new-alerts", handler);
    },
  },
  treasury: {
    getSummary:           ()                                      => ipcRenderer.invoke("treasury:getSummary"),
    listMovements:        ()                                      => ipcRenderer.invoke("treasury:listMovements"),
    createMovement:       (data: CreateTreasuryMovementInput)     => ipcRenderer.invoke("treasury:createMovement", data),
    updateMovement:       (id: string, data: UpdateTreasuryMovementInput) => ipcRenderer.invoke("treasury:updateMovement", id, data),
    deleteMovement:       (id: string)                            => ipcRenderer.invoke("treasury:deleteMovement", id),
    setFiscalReserve:     (data: SetFiscalReserveInput)           => ipcRenderer.invoke("treasury:setFiscalReserve", data),
    allocateEurcToRebuy:  (data: AllocateEurcToRebuyInput)        => ipcRenderer.invoke("treasury:allocateEurcToRebuy", data),
    allocateCashToRebuy:  (data: AllocateCashToRebuyInput)        => ipcRenderer.invoke("treasury:allocateCashToRebuy", data),
    listCycleLiquidity:   (input?: { cycleId?: string; status?: "reserved" | "used" | "released" }) => ipcRenderer.invoke("treasury:listCycleLiquidity", input),
    listFiscalReserveMovements: (input?: { realizedGainIds?: string[] }) => ipcRenderer.invoke("treasury:listFiscalReserveMovements", input),
  },
};

contextBridge.exposeInMainWorld("cryptoControl", cryptoControl);
console.log("[preload] cryptoControl API expuesta correctamente");

// Drive uv_run in the main process so the HTTP bridge (port 3001) can accept TCP connections.
setInterval(() => { ipcRenderer.invoke("__ping__").catch(() => {}); }, 200);
