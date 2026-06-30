// ─── Perspectivas — tipos nuevos desde cero ──────────────────────────────────
// No restaura ni hereda la implementación eliminada.

export type SimScenario = "conservador" | "moderado" | "base" | "favorable" | "optimista";

export const SIM_SCENARIOS: SimScenario[] = [
  "conservador", "moderado", "base", "favorable", "optimista",
];

export const SCENARIO_LABELS: Record<SimScenario, string> = {
  conservador: "Conservador",
  moderado:    "Moderado",
  base:        "Base",
  favorable:   "Favorable",
  optimista:   "Optimista",
};

// ─── Tier de activo ──────────────────────────────────────────────────────────

export type AssetTier =
  | "store_of_value"   // BTC
  | "large_cap"        // ETH, BNB
  | "mid_cap"          // SOL, ADA, AVAX, DOT, LINK, TON…
  | "small_cap"        // SUI, SEI, OP, ARB…
  | "speculative";     // cualquier activo desconocido

export interface ForecastDataset {
  sources: import("./forecast-sources").ForecastSource[];
  candidateId: string | null;
  activatedAt?: number | null;
  usdToEurRate: number | null;
  fxSource: string | null;
  fxRateAt: number | null;
}

// ─── Lotes FIFO en la simulación ─────────────────────────────────────────────

export interface SimLot {
  id: string;
  assetId: string;
  acquiredAt: number;  // ms
  quantity: number;
  remaining: number;
  costPerUnitEur: number;
  source: "historical" | "sim_plan" | "sim_rebuy" | "sim_extraordinary";
  fundingOrigin: "EXTERNAL_CONTRIBUTION" | "INTERNAL_REBUY" | "INTERNAL_REALLOCATION" | "INITIAL_POSITION";
  sourceEurcBucketId: string | null;
  profitHarvestCycleId: string | null;
  purchaseDate: number;
  purchasePriceEur: number;
  purchaseValueEur: number;
  acquisitionCostsEur: number;
  units: number;
  openUnits: number;
  costBasisEur: number;
}

// ─── Estado de un activo en un punto de la simulación ────────────────────────

export interface AssetSimState {
  assetId: string;
  balance: number;
  lots: SimLot[];
  avgCostEur: number | null;
  peakPriceEur: number | null;    // máximo precio visto
  lastSalePriceEur: number | null;
  lastSaleDate: number | null;
  totalBought: number;
  totalSold: number;
  totalRebuys: number;
  goalReached: boolean;
  failed: boolean;
  deteriorated: boolean;
  usedRebuyTierIds: Set<string>;      // escalones de recompra ya consumidos
  usedSaleProposalIds: Set<string>;   // propuestas de venta ya disparadas (se limpia en nuevo ATH)
}

// ─── Estado mensual completo de la simulación ────────────────────────────────

export interface MonthlyState {
  monthDate: number;    // primer día del mes, ms
  assetStates: Record<string, AssetSimState>;
  eurcFree: number;
  eurcFiscalReserve: number;
  eurCash: number;
  events: SimEvent[];
  // contadores del mes
  monthContributionsEur: number;
  monthSalesEur: number;
  monthRebuysEur: number;
  monthCommissionsEur: number;
  monthTaxEur: number;
  monthRealizedGainEur: number;
  monthEurcReinvestedEur: number;
  monthNetEurcInflowEur: number;
  monthExternalPurchasesEur: number;
  monthReinvestedCapitalEur: number;
  monthDeployedCapitalEur: number;
  monthInternalRebuyPrincipalEur: number;
  monthInternalRebuyRealizedGainEur: number;
  // acumulados del escenario hasta este mes
  cumulativeContributionsEur: number;
  cumulativeSalesEur: number;
  cumulativeRebuysEur: number;
  cumulativeExternalPurchasesEur: number;
  cumulativeReinvestedCapitalEur: number;
  cumulativeDeployedCapitalEur: number;
  cumulativeInternalRebuyPrincipalEur: number;
  cumulativeInternalRebuyRealizedGainEur: number;
  cumulativeTaxEur: number;
  cumulativeRealizedGainEur: number;
  cumulativeCommissionsEur: number;
}

// ─── Snapshot anual ──────────────────────────────────────────────────────────

export interface AnnualSnapshot {
  year: number;
  scope: "plan" | "extrapol";

  // Patrimonios
  openingWealthEur: number;
  closingWealthEur: number;    // neto (sin reserva fiscal pendiente)
  closingGrossEur: number;     // bruto

  // Flujos del año
  contributionsEur: number;
  marketGainEur: number;
  salesEur: number;
  rebuysEur: number;
  commissionsEur: number;
  taxEur: number;
  realizedGainEur: number;
  eurcReinvestedEur: number;
  netEurcInflowEur: number;
  externalPurchasesEur: number;
  reinvestedCapitalEur: number;
  deployedCapitalEur: number;
  internalRebuyPrincipalEur: number;
  cumulativeInternalRebuyPrincipalEur: number;
  internalRebuyOpenCostBasisEur: number;
  internalRebuyCurrentMarketValueEur: number;
  internalRebuyUnrealizedGainEur: number;
  internalRebuyRealizedGainEur: number;
  internalRebuyTotalReturnEur: number;
  internalRebuyTotalReturnPct: number | null;
  internalRebuyUnitsOpen: number;
  internalRebuyUnitsSold: number;

  // Stock a fin de año
  fiscalReserveEur: number;
  eurcFreeEur: number;
  eurCashEur: number;
  currentInvestedCapitalEur: number;
  openCostBasisEur: number;
  externalContributionsCumulativeEur: number;
  reinvestedCapitalCumulativeEur: number;
  deployedCapitalCumulativeEur: number;
  netProfitEur: number;

  // Rendimiento del año
  annualReturnPct: number | null;

  // Posiciones a fin de año por activo
  positions: Record<string, AnnualAssetPosition>;

  // Cronología de eventos del año
  events: SimEvent[];

  // Motivos de ausencia de operaciones (para transparencia del motor)
  salesSkipReasons: string[];
  rebuysSkipReasons: string[];

  // Cobertura de previsiones externas para este año
  // "covered" = al menos un activo con datos directos o interpolados
  // "uncovered" = ningún activo tiene cobertura externa para este año
  forecastCoverage: "covered" | "uncovered";
}

export interface AnnualAssetPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  priceEur: number | null;
  valueEur: number | null;
  unrealizedGainEur: number | null;
  totalBought: number;
  totalSold: number;
  totalRebuys: number;
  goalReached: boolean;
  failed: boolean;
}

// ─── Eventos de simulación ────────────────────────────────────────────────────

export type SimEventType =
  | "contribution"
  | "purchase"
  | "sale"
  | "rebuy"
  | "tax_reserve"
  | "reinvestment"
  | "goal_reached"
  | "asset_deteriorated"
  | "asset_failed"
  | "substitution"
  | "strategy_revision"
  | "cycle_change";

export interface SimEvent {
  date: number;
  type: SimEventType;
  origin:
    | "REAL"
    | "USER_RULE"
    | "INTELLIGENT_STRATEGY"
    | "HYBRID"
    | "PLAN_PURCHASE"
    | "INTERNAL_REALLOCATION"
    | "SYSTEM";
  assetId?: string;
  amountEur?: number;
  quantity?: number;
  priceEur?: number;
  gainEur?: number;
  taxEur?: number;
  eurcUsedEur?: number;
  commissionEur?: number;
  spreadEur?: number;
  slippageEur?: number;
  costBasisEur?: number;
  eurcOrigin?: "sale" | "initial" | "operating_liquidity" | "redistribution";
  relatedSaleCycleId?: string;
  description: string;
}

// ─── Trazabilidad de previsiones por activo ──────────────────────────────────

export type PriceModelType = "external_direct" | "external_interpolated" | "external_modeled" | "insufficient";

export interface AssetPriceInfo {
  assetId: string;
  tier: AssetTier;
  currentPriceEur: number | null;
  horizonPriceEur: number | null;
  priceMultiple: number | null;
  modelType: PriceModelType;
  externalSourceCount: number;
  directCoverageYears: number[];
  interpolatedCoverageYears: number[];
  modeledCoverageYears: number[];
  insufficientYears: number[];
  lastCoveredYear: number | null;
  circulatingSupplyM: number | null;
  impliedMarketCapBnEur: number | null;
  impliedMarketCapWarning: boolean;
}

// ─── Resultado por escenario ─────────────────────────────────────────────────

export interface ScenarioResult {
  scenario: SimScenario;
  label: string;
  annualSnapshots: AnnualSnapshot[];
  annualStrategyReviews: AnnualStrategyReview[];
  summary: ScenarioSummary;
  assetPriceInfo: Record<string, AssetPriceInfo>;
  marketDiagnostics?: {
    negativeMonths: number;
    regimeCounts: Record<string, number>;
  };
}

export type MonthlyDecisionType =
  | "CONTINUE_PLAN_BUYING"
  | "REDUCE_NEW_BUYS"
  | "PAUSE_TACTICAL_BUYS"
  | "HOLD"
  | "PREPARE_PARTIAL_SALE"
  | "EXECUTE_PARTIAL_SALE"
  | "KEEP_EURC_LIQUIDITY"
  | "PREPARE_REBUY"
  | "EXECUTE_PARTIAL_REBUY"
  | "WAIT_FOR_STABILIZATION"
  | "CANCEL_REBUY_THESIS"
  | "REALLOCATE_IF_ALLOWED";

export interface MonthlyStrategyDecision {
  month: string;
  decisions: MonthlyDecisionType[];
  executedEvents: SimEvent[];
  discardedReasons: string[];
  eurcOperatingLiquidityEur: number;
  fiscalReserveEur: number;
  evaluatedAssetIds: string[];
  usesFutureInformation: false;
}

export interface AnnualStrategyReview {
  year: number;
  monthCount: number;
  monthlyDecisions: MonthlyStrategyDecision[];
  openingWealthEur: number;
  externalContributionsEur: number;
  planPurchasesEur: number;
  tacticalPurchasesEur: number;
  partialSalesEur: number;
  realizedGainEur: number;
  taxGeneratedEur: number;
  eurcGeneratedEur: number;
  rebuysEur: number;
  reinvestedCapitalEur: number;
  internalRebuyPrincipalEur: number;
  cumulativeInternalRebuyPrincipalEur: number;
  internalRebuyOpenCostBasisEur: number;
  internalRebuyCurrentMarketValueEur: number;
  internalRebuyUnrealizedGainEur: number;
  internalRebuyRealizedGainEur: number;
  internalRebuyTotalReturnEur: number;
  internalRebuyTotalReturnPct: number | null;
  internalRebuyUnitsOpen: number;
  internalRebuyUnitsSold: number;
  finalEurcEur: number;
  finalFiscalReserveEur: number;
  openingUnitsByAsset: Record<string, number>;
  closingUnitsByAsset: Record<string, number>;
  marketGainEur: number;
  closingGrossEur: number;
  closingNetEur: number;
  cumulativeProfitEur: number;
  twrYear: number | null;
  twrCumulative: number | null;
  xirrToYear: number | null;
  maxDrawdownPct: number | null;
  predominantRegime: string | null;
  executedDecisionCount: number;
  discardedDecisionCount: number;
  saleEvaluations: number;
  rebuyEvaluations: number;
  monthsInEurc: number;
  averageEurcEur: number;
  topReasonsNotToAct: string[];
  reconciliation: {
    wealthDiffEur: number;
    eurcDiffEur: number;
    toleranceEur: number;
    passed: boolean;
  };
}

export interface ScenarioSummary {
  scenario: SimScenario;
  strategyEnabled: boolean;
  strategyMode: SimulationStrategyMode;
  strategySource: "none" | "user_rules" | "intelligent_engine" | "hybrid";
  simulationOnly: boolean;
  requiresUserConfirmation: boolean;
  initialWealthEur: number;
  finalNetWealthEur: number;
  initialCapitalEur: number;
  totalContributionsEur: number;
  externalContributionsEur: number;
  totalHistoricalCapitalEur: number;
  totalExternalPurchasesEur: number;
  reinvestedCapitalEur: number;
  cumulativeDeployedCapitalEur: number;
  internalRebuyPrincipalEur: number;
  cumulativeInternalRebuyPrincipalEur: number;
  internalRebuyOpenCostBasisEur: number;
  internalRebuyCurrentMarketValueEur: number;
  internalRebuyUnrealizedGainEur: number;
  internalRebuyRealizedGainEur: number;
  internalRebuyTotalReturnEur: number;
  internalRebuyTotalReturnPct: number | null;
  internalRebuyUnitsOpen: number;
  internalRebuyUnitsSold: number;
  currentInvestedCapitalEur: number;
  eurcOperatingLiquidityEur: number;
  eurcFiscalReserveEur: number;
  eurcSecurityReserveEur: number;
  openCostBasisEur: number;
  grossWealthEur: number;
  netProfitEur: number;
  totalMarketGainEur: number;
  realizedSalesEur: number;
  realizedRebuysEur: number;
  realizedTaxEur: number;
  simulatedUserRuleSalesEur: number;
  simulatedUserRuleRebuysEur: number;
  simulatedUserRuleTaxEur: number;
  simulatedStrategicSalesEur: number;
  simulatedStrategicRebuysEur: number;
  simulatedStrategicTaxEur: number;
  proposedSalesEur: number;
  proposedRebuysEur: number;
  projectedEurcReserve: number;
  projectedFiscalReserve: number;
  decision: "hold" | "user_rules" | "intelligent_strategy" | "hybrid";
  totalSalesEur: number;
  totalRebuysEur: number;
  totalCommissionsEur: number;
  totalTaxEur: number;
  totalRealizedGainEur: number;
  totalUnrealizedGainEur: number;
  totalEurcReinvestedEur: number;
  totalNetEurcInflowEur: number;
  initialEurcFreeEur: number;
  initialEurcFiscalReserveEur: number;
  finalEurcFreeEur: number;
  finalFiscalReserveEur: number;
  xirr: number | null;
  twr: number | null;
  twrCumulative: number | null;
  twrAnnualized: number | null;
  maxDrawdownPct: number | null;
  assetSummaries: AssetSimSummary[];
}

export interface AssetSimSummary {
  assetId: string;
  finalBalance: number;
  finalValueEur: number | null;
  totalBought: number;
  totalSold: number;
  totalRebuys: number;
  goalReached: boolean;
  failed: boolean;
  finalAvgCostEur: number | null;
  finalPriceEur: number | null;
}

// ─── Resultado completo de la simulación ────────────────────────────────────

export interface ScenarioDiagnostic {
  scenario: string;
  negativeYears: number;
  positiveYears: number;
  lateralYears: number;
  negativeMonths: number;
  regimeCounts: Record<string, number>;
  maxDrawdownPct: number;
  isStrictlyMonotonic: boolean;
  totalSalesEur: number;
  totalRebuysEur: number;
  totalReinvestedEur: number;
}

export interface SimDiagnostics {
  engineIsNew: true;
  source: "perspectives-external-forecasts" | "market-regime-engine+active-forecast-anchors";
  candidateId: string | null;
  engineVersion: string;
  engineBuildHash: string;
  engineGeneratedAt: number;
  marketRegimeEngine: boolean;
  negativeMonthCount: number;
  negativeYearCount: number;
  maxDrawdownPct: number | null;
  hasBearPeriods: boolean;
  realisticCycleValidation: "passed" | "failed";
  scenarioValidationStatus: "valid_order" | "invalid_order";
  scenarioOrder: Array<{ scenario: SimScenario; finalNetWealthEur: number }>;
  perScenario: ScenarioDiagnostic[];
}

export interface PerspectivesSimulation {
  computedAt: number;
  startYear: number;
  endYear: number;
  horizonDate: number;
  scenarios: ScenarioResult[];
  strategyComparisons: StrategyModeComparison[];
  validations: ValidationResult[];
  diagnostics: SimDiagnostics;
}

export interface StrategyModeComparison {
  mode: SimulationStrategyMode;
  label: string;
  scenarios: Array<{
    scenario: SimScenario;
    finalNetWealthEur: number;
    benefitEur: number;
    twr: number | null;
    xirr: number | null;
    salesEur: number;
    rebuysEur: number;
    taxEur: number;
    finalEurcFreeEur: number;
    finalFiscalReserveEur: number;
    decision: ScenarioSummary["decision"];
  }>;
}

export interface ValidationResult {
  rule: string;
  passed: boolean;
  detail: string;
}

// ─── Entrada al motor de simulación ─────────────────────────────────────────

export interface SimInput {
  now: number;
  horizonDate: number;

  // Estado actual (leído de módulos existentes, no recalculado)
  currentPositions: CurrentPosition[];
  currentLots: HistoricalLot[];
  historicalSales?: HistoricalSale[];
  eurcFree: number;
  eurcFiscalReserve: number;
  eurCash: number;
  historicalCapitalEur: number;

  // Estrategia futura (leída del Plan)
  cycles: SimCycle[];

  // Opciones
  options: SimOptions;

}

export interface CurrentPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  currentPriceEur: number | null;
}

export interface HistoricalLot {
  id: string;
  assetId: string;
  date: number;
  remainingAmount: number;
  unitAcquisitionPriceEur: number;
}

export interface HistoricalSale {
  assetId: string;
  date: number;
  quantity: number;
  unitPriceEur: number;
  realizedGainEur?: number | null;
}

export interface SimCycle {
  id: string;
  planId: string;
  name: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
  assets: SimCycleAsset[];
  saleRules: SimSaleRule[];
  rebuyTiers: SimRebuyTier[];
  substitutions: SimSubstitution[];
  revisions: SimRevision[];
}

export interface SimCycleAsset {
  id: string;
  assetId: string;
  allocationType: "percentage" | "amount";
  allocationValue: number;
  allocationPercentage: number | null;
  fixedAmountEur: number | null;
  targetAmount: number | null;
  targetValueEur: number | null;
  startDate: number;
  endDate: number | null;
  status: "active" | "paused" | "closed" | "goal_reached";
}

export interface SimSaleRule {
  id: string;
  assetId: string | null;
  triggerType: "gain_multiple" | "gain_percentage" | "price_target" | "portfolio_weight";
  triggerValue: number;
  sellPercentage: number;  // 0..99 (never 100%)
  status: "active" | "pending" | "triggered" | "cancelled";
  triggeredAt: number | null;
}

export interface SimRebuyTier {
  id: string;
  assetId: string | null;
  drawdownPercentage: number;   // e.g. 20 = 20% drop
  usagePercentage: number;      // % of available EURC
  referenceType: "last_sale" | "cycle_peak" | null;
  referenceValue?: number | null;
  status: "active" | "triggered" | "cancelled";
}

export interface SimSubstitution {
  id: string;
  fromAssetId: string;
  toAssetId: string;
  effectiveDate: number;
  status: "pending" | "executed" | "cancelled";
}

export interface SimRevision {
  id: string;
  effectiveDate: number;
  changesJson: string;
}

export interface SimOptions {
  policy: "plan_base" | "full_strategy";
  strategyMode?: SimulationStrategyMode;
  commissionRate: number;  // e.g. 0.004 = 0.4%
  taxBands: TaxBand[];
}

export type SimulationStrategyMode = "PASSIVE" | "USER_RULES" | "INTELLIGENT_STRATEGY" | "HYBRID";

export interface TaxBand {
  upToEur: number | null;  // null = unlimited
  rate: number;
}

// Tramos IRPF ganancias del ahorro 2024 — fuente canónica: SPANISH_FISCAL_CONFIG_2024
// en packages/portfolio/src/fiscal-config.ts
export const DEFAULT_SPANISH_TAX_BANDS: TaxBand[] = [
  { upToEur: 6_000,   rate: 0.19 },
  { upToEur: 50_000,  rate: 0.21 },
  { upToEur: 200_000, rate: 0.23 },
  { upToEur: 300_000, rate: 0.27 },
  { upToEur: null,    rate: 0.28 },
];

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  policy: "full_strategy",
  commissionRate: 0, // sin comisiones futuras inventadas; el usuario no ha configurado ninguna
  taxBands: DEFAULT_SPANISH_TAX_BANDS,
};
