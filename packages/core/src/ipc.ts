import type {
  CreateInvestmentAssetInput,
  CreateInvestmentCycleInput,
  CreateInvestmentPlanInput,
  CreateStrategyRevisionInput,
  CreateTreasuryMovementInput,
  CreateTransactionInput,
  CreatePartialSaleInput,
  CreateContributionScheduleInput,
  UpdateContributionScheduleInput,
  ContributionSchedule,
  CreateAssetSubstitutionInput,
  UpdateAssetSubstitutionInput,
  AssetSubstitution,
  ContributionMonthlySummary,
  CycleContributionAggregates,
  PartialSale,
  InvestmentAsset,
  InvestmentAssetStateChangeInput,
  MarkGoalReachedInput,
  InvestmentCycle,
  InvestmentPlan,
  StrategyRevision,
  SetFiscalReserveInput,
  TreasuryMovement,
  TreasurySummary,
  AllocateEurcToRebuyInput,
  AllocateCashToRebuyInput,
  CycleLiquidityAllocation,
  CycleLiquidityStatus,
  FiscalReserveMovement,
  CycleMetrics,
  AssetHealthResult,
  StrategicAlert,
  CycleStrategyReport,
  PerspectivesGoal,
  CreatePerspectivesGoalInput,
  SmartBuyRecommendation,
  CycleRebuyTier,
  UpdateInvestmentAssetInput,
  UpdateInvestmentCycleInput,
  UpdateInvestmentPlanInput,
  UpdateTreasuryMovementInput,
  PartialSaleRule,
  CreatePartialSaleRuleInput,
  UpdatePartialSaleRuleInput,
  PartialSaleEvaluation,
  PlanMonitoringSummary,
  SmartBuyMode,
} from "./validation";
import { CryptoControlAPI, Result, Asset, MarketSentiment, MarketSentimentTimeframe } from "./types";

import { TransactionInput, PlanConsolidatedSnapshot } from "@crypto-control/portfolio";

export interface CoinbaseCredentials {
  apiKeyName: string;
  privateKeyPem: string;
}

export interface CdpKeyPermissions {
  canView: boolean;
  canTrade: boolean;
  canTransfer: boolean;
}

export interface CdpImportResult {
  connected: boolean;
  canceled?: boolean;
  keyDisplayName: string;
  algorithm: "ES256";
  permissions: CdpKeyPermissions;
}

export interface CoinbaseStatus {
  connected: boolean;
  lastSyncAt: number | null;
  lastSyncItemsProcessed: number | null;
  lastSyncStatus: "success" | "error" | null;
  lastSyncError: string | null;
  keyDisplayName?: string | null;
  algorithm?: string | null;
  credentialType?: string | null;
  keychainStatus?: "stored" | "missing" | "legacy" | "unknown";
  lastValidationAt?: number | null;
  permissions?: CdpKeyPermissions | null;
}

export interface CoinbaseSyncResult {
  itemsProcessed: number;
  newTransactions: number;
  skippedDuplicates: number;
  durationMs?: number;
  accountsConsulted?: number;
  pagesDownloaded?: number;
  transactionsDownloaded?: number;
  fillsDownloaded?: number;
  updatedTransactions?: number;
  pendingValuations?: number;
  errors?: string[];
}

export interface CoinbaseSyncHistoryItem {
  id: string;
  timestamp: number;
  status: string;
  itemsProcessed: number;
  newTransactions?: number | null;
  skippedDuplicates?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface DiagnosticsAsset {
  symbol: string;
  amount: number;
  hasPrice: boolean;
  hasHistoricalPrice: boolean;
  hasCostBasis: boolean;
  rendered: boolean;
}

export interface DiagnosticsReport {
  accounts: number;
  balances: number;
  transactions: number;
  conversions: number;
  fees: number;
  assets: number;
  positions: number;
  historicalPrices: number;
  missingPrices: number;
  missingCosts: number;
  perAsset: DiagnosticsAsset[];
}

export interface ProjectionScenarioResult {
  scenario: "conservador" | "moderado" | "base" | "favorable" | "muy_favorable" | "optimista" | "dinamico";
  label: string;
  probability: number | null;
  confidence: number | null;
  summary: {
    initialGrossWealthEur: number;
    finalGrossWealthEur: number;
    finalNetWealthEur: number;
    historicalCapitalEur: number;
    totalFutureCapitalEur: number;
    totalCapitalEur: number;
    estimatedMarketGainEur: number;
    treasuryInterestEur: number;
    estimatedFeesEur: number;
    weightedAnnualReturn: number | null;
    totalRealizedGainEur: number;
    totalUnrealizedGainEur: number;
    totalTaxGeneratedEur: number;
    totalTaxPendingEur: number;
    finalEurcAvailableEur: number;
    finalCashEur: number;
    finalFiscalReserveEur: number;
  };
  hypotheses: Array<{
    assetId: string;
    annualGrowthRate: number;
    volatility: number;
    correctionDepth: number;
    source: string | null;
    hypothesis: string | null;
    dataQuality: "alta" | "media" | "baja" | null;
    confidence: number | null;
  }>;
  chartPoints: Array<{
    date: number;
    grossWealthEur: number;
    netWealthEur: number;
    portfolioValueEur: number;
    cashEur: number;
    eurcAvailableEur: number;
  }>;
  assetResults: Array<{
    assetId: string;
    initialBalance: number;
    initialValueEur: number | null;
    initialAvgCostEur: number | null;
    balanceBoughtContributions: number;
    balanceBoughtExtraordinary: number;
    balanceSold: number;
    balanceRebought: number;
    finalBalance: number;
    costContributionsEur: number;
    costRebuyEur: number;
    salesProceedsEur: number;
    finalValueEur: number | null;
    finalPriceEur: number | null;
    finalAvgCostEur: number | null;
    unrealizedGainEur: number | null;
    realizedGainEur: number;
    targetAmount: number | null;
    targetValueEur: number | null;
    goalReachedProjectedAt: number | null;
    hypothesis: {
      annualGrowthRate: number;
      source: string | null;
      hypothesis: string | null;
      dataQuality: "alta" | "media" | "baja" | null;
      confidence: number | null;
    } | null;
  }>;
  cycleResults: Array<{
    cycleId: string;
    cycleName: string;
    startDate: number;
    endDate: number | null;
    plannedContributionEur: number;
    simulatedContributionEur: number;
    extraordinaryContributionEur: number;
    salesEur: number;
    rebuysEur: number;
    taxGeneratedEur: number;
    eurcGeneratedEur: number;
    eurcUsedEur: number;
    buysByAsset: Record<string, number>;
    goalReachedAssets: string[];
  }>;
  goalResults: Array<{
    id: string;
    name: string;
    type: string;
    targetAmountEur: number;
    targetDate: number | null;
    priority: number;
    currentAssignedEur: number;
    projectedAssignedEur: number;
    progress: number;
    reachedAt: number | null;
    reachedYear: number | null;
    isReached: boolean;
  }>;
}

export interface ProjectionResult {
  snapshot: {
    snapshotId: string;
    generatedAt: number;
    planId: string;
    planName: string;
    plans: Array<{
      id: string;
      name: string;
      status: string;
      baseCurrency: string;
    }>;
    cycles: Array<{
      id: string;
      planId: string;
      name: string;
      startDate: number;
      endDate: number | null;
      monthlyAmountEur: number;
      status: string;
      assetCount: number;
    }>;
    historicalCapitalEur: number;
    historicalSalesEur: number;
    currentPortfolioValueEur: number;
    positionCount: number;
    treasury: {
      cashEur: number;
      eurcEur: number;
      eurcAvailableEur: number;
      fiscalReserveEur: number;
      totalLiquidityEur: number;
    };
    dataQuality: {
      overallScore: number;
      missingPrices: string[];
      missingCosts: string[];
      staleData: string[];
      notes: string[];
    };
    positions: Record<string, {
      assetId: string;
      balance: number;
      avgCostEur: number | null;
      currentValueEur: number | null;
      currentPriceEur: number | null;
    }>;
    fiscalVersion: string;
    strategyVersion: string;
  };
  scenarios: ProjectionScenarioResult[];
  comparison: Array<{
    scenario: "conservador" | "moderado" | "base" | "favorable" | "muy_favorable" | "optimista" | "dinamico";
    label: string;
    finalGrossWealthEur: number;
    finalNetWealthEur: number;
    probability: number | null;
    confidence: number | null;
  }>;
  horizonYears: number;
  generatedAt: number;
}

export interface FullCryptoControlAPI extends CryptoControlAPI {
  diagnostics: {
    getReport: () => Promise<Result<DiagnosticsReport>>;
  };
  transactions: {
    list: () => Promise<Result<TransactionInput[]>>;
    create: (data: CreateTransactionInput) => Promise<Result<{ id?: string }>>;
    update: (id: string, data: CreateTransactionInput) => Promise<Result<null>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  settings: {
    get: (key: string) => Promise<Result<string | null>>;
    update: (key: string, value: string) => Promise<Result<null>>;
  };
  coinbase: {
    importCredentialsFile: () => Promise<Result<CdpImportResult>>;
    connectFromJson: (jsonContent: string) => Promise<Result<CdpImportResult>>;
    connect: (credentials: CoinbaseCredentials) => Promise<Result<{ connected: boolean }>>;
    disconnect: () => Promise<Result<null>>;
    getStatus: () => Promise<Result<CoinbaseStatus>>;
    sync: () => Promise<Result<CoinbaseSyncResult>>;
    getSyncHistory: () => Promise<Result<CoinbaseSyncHistoryItem[]>>;
    listPortfolios: () => Promise<Result<any>>;
    getPortfolioBreakdown: (portfolioUuid: string, currency: string) => Promise<Result<any>>;
    getPortfolioSnapshots: (portfolioUuid: string) => Promise<Result<any>>;
    previewOrder: (input: {
      operationType?: "buy" | "sell" | "convert" | "rebuy";
      mode?: "simulation" | "real";
      productId?: string;
      assetId?: string;
      fromAssetId?: string;
      toAssetId?: string;
      side?: "BUY" | "SELL";
      quoteAmountEur?: number;
      baseAmount?: number;
      quoteAmount?: number;
    }) => Promise<Result<any>>;
    submitOrder: (input: {
      operationType?: "buy" | "sell" | "convert" | "rebuy";
      mode?: "simulation" | "real";
      productId?: string;
      assetId?: string;
      fromAssetId?: string;
      toAssetId?: string;
      side?: "BUY" | "SELL";
      quoteAmountEur?: number;
      baseAmount?: number;
      quoteAmount?: number;
      previewId?: string | null;
      previewToken?: string | null;
      confirmationText: string;
    }) => Promise<Result<any>>;
    listPendingOrders: () => Promise<Result<any[]>>;
    listScheduledOperations: () => Promise<Result<any[]>>;
    createScheduledOperation: (input: any) => Promise<Result<any>>;
    deleteScheduledOperation: (id: string) => Promise<Result<null>>;
  };
  sentiment: {
    getGlobal: (input: { timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
    getAsset: (input: { assetId: string; timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
    getHistory: (input: { scope: "global" | "asset"; assetId?: string | null; timeframe: MarketSentimentTimeframe; limit?: number }) => Promise<Result<MarketSentiment[]>>;
    refresh: (input: { scope: "global" | "asset"; assetId?: string | null; timeframe: MarketSentimentTimeframe }) => Promise<Result<MarketSentiment>>;
  };
  targets: {
    list: () => Promise<Result<Array<{ id: string; assetId: string; targetPriceEur: number }>>>;
    upsert: (data: { id?: string; assetId: string; targetPriceEur: number }) => Promise<Result<{ id: string }>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  alerts: {
    list: () => Promise<Result<Array<{ id: string; assetId: string; priceThreshold: number; direction: "above" | "below"; isActive: boolean }>>>;
    create: (data: { assetId: string; priceThreshold: number; direction: "above" | "below" }) => Promise<Result<{ id: string }>>;
    delete: (id: string) => Promise<Result<null>>;
    toggle: (id: string) => Promise<Result<null>>;
  };
  investmentPlan: {
    list: () => Promise<Result<InvestmentPlan[]>>;
    getActive: () => Promise<Result<InvestmentPlan | null>>;
    create: (data: CreateInvestmentPlanInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentPlanInput) => Promise<Result<InvestmentPlan>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  investmentCycles: {
    list: (input?: { planId?: string }) => Promise<Result<InvestmentCycle[]>>;
    getCurrent: (input?: { planId?: string; at?: number }) => Promise<Result<InvestmentCycle | null>>;
    create: (data: CreateInvestmentCycleInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentCycleInput) => Promise<Result<InvestmentCycle>>;
    delete: (id: string) => Promise<Result<null>>;
    getMetrics: (input: { cycleId: string }) => Promise<Result<CycleMetrics>>;
    listPartialSales: (input?: { cycleId?: string }) => Promise<Result<PartialSale[]>>;
    createPartialSale: (data: CreatePartialSaleInput) => Promise<Result<{ id: string }>>;
    deletePartialSale: (id: string) => Promise<Result<null>>;
  };
  investmentAssets: {
    list: (input?: { cycleId?: string }) => Promise<Result<InvestmentAsset[]>>;
    create: (data: CreateInvestmentAssetInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateInvestmentAssetInput) => Promise<Result<InvestmentAsset>>;
    pause: (id: string, data?: InvestmentAssetStateChangeInput) => Promise<Result<InvestmentAsset>>;
    close: (id: string, data?: InvestmentAssetStateChangeInput) => Promise<Result<InvestmentAsset>>;
    markGoalReached: (id: string, data: MarkGoalReachedInput) => Promise<Result<InvestmentAsset>>;
    reactivate: (id: string) => Promise<Result<InvestmentAsset>>;
    delete: (id: string) => Promise<Result<null>>;
    getHealth: (input: { assetId: string }) => Promise<Result<AssetHealthResult>>;
  };
  strategyRevisions: {
    list: (input?: { cycleId?: string }) => Promise<Result<StrategyRevision[]>>;
    create: (data: CreateStrategyRevisionInput) => Promise<Result<{ id: string }>>;
  };
  contributionSchedule: {
    list: (input?: { cycleId?: string; status?: string }) => Promise<Result<ContributionSchedule[]>>;
    create: (data: CreateContributionScheduleInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateContributionScheduleInput) => Promise<Result<ContributionSchedule>>;
    execute: (id: string) => Promise<Result<ContributionSchedule>>;
    delete: (id: string) => Promise<Result<null>>;
    getMonthlySummary: (input: { cycleId: string }) => Promise<Result<{ summaries: ContributionMonthlySummary[]; aggregates: CycleContributionAggregates }>>;
  };
  assetSubstitutions: {
    list: (input?: { cycleId?: string; fromAssetId?: string; status?: string }) => Promise<Result<AssetSubstitution[]>>;
    create: (data: CreateAssetSubstitutionInput) => Promise<Result<{ id: string }>>;
    update: (id: string, data: UpdateAssetSubstitutionInput) => Promise<Result<AssetSubstitution>>;
    apply: (id: string) => Promise<Result<{ fromInvestmentAssetId: string | null; toInvestmentAssetId: string | null }>>;
    cancel: (id: string) => Promise<Result<AssetSubstitution>>;
    execute: (id: string) => Promise<Result<{ fromInvestmentAssetId: string | null; toInvestmentAssetId: string | null }>>;
    delete: (id: string) => Promise<Result<null>>;
  };
  strategicAlerts: {
    generate: (input: { cycleId: string }) => Promise<Result<StrategicAlert[]>>;
  };
  strategicDecisions: {
    getCycleReport: (input: { cycleId: string }) => Promise<Result<CycleStrategyReport>>;
  };
  perspectives: {
    getGoals: () => Promise<Result<PerspectivesGoal[]>>;
    createGoal: (data: CreatePerspectivesGoalInput) => Promise<Result<{ id: string }>>;
    updateGoal: (id: string, data: Partial<CreatePerspectivesGoalInput>) => Promise<Result<PerspectivesGoal>>;
    deleteGoal: (id: string) => Promise<Result<null>>;
    getConsolidatedSnapshot: () => Promise<Result<PlanConsolidatedSnapshot>>;
    getProjection: (input?: { horizonYears?: number; complianceRate?: number }) => Promise<Result<ProjectionResult>>;
  };
  smartBuy: {
    getRecommendation: (input: { cycleId: string; amount: number; mode?: SmartBuyMode; originType?: "cash" | "eurc"; weights?: { planPct?: number; balancePct?: number; opportunityPct?: number; potentialPct?: number }; horizon?: "1-3y" | "3-5y" | "5y+" }) => Promise<Result<SmartBuyRecommendation>>;
  };
  rebuyTiers: {
    list: (input: { cycleId: string }) => Promise<Result<CycleRebuyTier[]>>;
    upsert: (data: { id?: string; cycleId: string; assetId?: string | null; name?: string | null; drawdownPercentage: number; usagePercentage: number; priority?: number; status?: string; effectiveDate?: number | null; notes?: string | null; referenceType?: string | null; referenceValue?: number | null; referenceDate?: number | null }) => Promise<Result<{ id: string }>>;
    delete: (id: string) => Promise<Result<null>>;
    evaluate: (input: { cycleId: string; assetId?: string }) => Promise<Result<{ triggered: CycleRebuyTier[]; availableLiquidityEur: number; totalSuggestedEur: number }>>;
  };
  partialSaleRules: {
    list: (input: { cycleId: string; assetId?: string; status?: string }) => Promise<Result<PartialSaleRule[]>>;
    create: (data: CreatePartialSaleRuleInput) => Promise<Result<PartialSaleRule>>;
    update: (id: string, data: UpdatePartialSaleRuleInput) => Promise<Result<PartialSaleRule>>;
    delete: (id: string) => Promise<Result<null>>;
    evaluate: (input: { cycleId: string; assetId?: string }) => Promise<Result<PartialSaleEvaluation[]>>;
  };
  planMonitoring: {
    getSummary: (input: { cycleId: string }) => Promise<Result<PlanMonitoringSummary>>;
  };
  treasury: {
    getSummary: () => Promise<Result<TreasurySummary>>;
    listMovements: () => Promise<Result<TreasuryMovement[]>>;
    createMovement: (data: CreateTreasuryMovementInput) => Promise<Result<{ id: string }>>;
    updateMovement: (id: string, data: UpdateTreasuryMovementInput) => Promise<Result<TreasuryMovement>>;
    deleteMovement: (id: string) => Promise<Result<null>>;
    setFiscalReserve: (data: SetFiscalReserveInput) => Promise<Result<TreasurySummary>>;
    allocateEurcToRebuy: (data: AllocateEurcToRebuyInput) => Promise<Result<{ id: string }>>;
    allocateCashToRebuy: (data: AllocateCashToRebuyInput) => Promise<Result<{ id: string }>>;
    listCycleLiquidity: (input?: { cycleId?: string; status?: CycleLiquidityStatus }) => Promise<Result<CycleLiquidityAllocation[]>>;
    listFiscalReserveMovements: (input?: { realizedGainIds?: string[] }) => Promise<Result<FiscalReserveMovement[]>>;
  };
}

export interface ElectronWindow {
  cryptoControl: FullCryptoControlAPI;
}
