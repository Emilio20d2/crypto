export type PerspectivesScenario =
  | "conservador"
  | "moderado"
  | "base"
  | "favorable"
  | "optimista";

export type PerspectivesStrategyMode =
  | "PASSIVE"
  | "USER_RULES"
  | "INTELLIGENT_STRATEGY"
  | "HYBRID";

export type FundingOrigin =
  | "INITIAL_POSITION"
  | "EXTERNAL_CONTRIBUTION"
  | "INTERNAL_REBUY"
  | "INTERNAL_REALLOCATION";

export type PriceCoverageState =
  | "HISTORICAL"
  | "MODEL_CALIBRATED"
  | "FORECAST_CONDITIONED"
  | "INVALID";

export type MarketRegime =
  | "ACCUMULATION"
  | "EARLY_BULL"
  | "BULL_EXPANSION"
  | "EUPHORIA"
  | "DISTRIBUTION"
  | "CORRECTION"
  | "BEAR_MARKET"
  | "CAPITULATION"
  | "EARLY_RECOVERY"
  | "LATERAL"
  | "INSUFFICIENT_DATA";

export type SourceStatus =
  | "REGISTERED_ONLY"
  | "FETCHING"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "ACTIVE_IN_ENGINE"
  | "FAILED"
  | "EXPIRED"
  | "INSUFFICIENT";

export interface PerspectivesSourceEvidence {
  id: string;
  name: string;
  category:
    | "market"
    | "institutional"
    | "on_chain"
    | "derivatives"
    | "macro"
    | "media"
    | "fundamental";
  status: SourceStatus;
  publisher: string;
  originalUrl: string | null;
  publishedAt: number | null;
  retrievedAt: number | null;
  expiresAt: number | null;
  assetIds: string[];
  independentPublicationId: string | null;
  reliability: number;
  usedInEngine: boolean;
}

export interface PerspectivesPricePoint {
  assetId: string;
  month: string;
  pathId: string;
  priceEur: number;
  regime: MarketRegime;
  coverage: PriceCoverageState;
  provider: string;
  generatedAt: number;
  confidence: number;
}

export interface PerspectivesPricePath {
  pathId: string;
  scenarioBand: PerspectivesScenario;
  points: PerspectivesPricePoint[];
}

export interface PerspectivesLot {
  id: string;
  assetId: string;
  acquiredAt: number;
  fundingOrigin: FundingOrigin;
  sourceTransactionId: string;
  sourceEurcBucketId: string | null;
  profitHarvestCycleId: string | null;
  unitsAcquired: number;
  unitsOpen: number;
  unitsSold: number;
  purchasePriceEur: number;
  grossPurchaseEur: number;
  acquisitionCostsEur: number;
  costBasisEur: number;
}

export type EurcBucketStatus =
  | "AVAILABLE"
  | "PARTIALLY_USED"
  | "FULLY_USED"
  | "WITHDRAWN"
  | "CLOSED";

export interface PerspectivesEurcBucket {
  id: string;
  profitHarvestCycleId: string;
  sourceSaleTransactionId: string;
  sourceAssetId: string;
  openedAt: number;
  grossSaleProceedsEur: number;
  soldCostBasisEur: number;
  realizedGainEur: number;
  saleCostsEur: number;
  fiscalReserveEur: number;
  operatingPrincipalEur: number;
  availableEur: number;
  consumedEur: number;
  withdrawnEur: number;
  monthsUndeployed: number;
  status: EurcBucketStatus;
}

export type ProfitHarvestCycleStatus =
  | "OPEN"
  | "PARTIALLY_REBOUGHT"
  | "FULLY_REBOUGHT"
  | "CANCELLED"
  | "CLOSED";

export interface PerspectivesProfitHarvestCycle {
  id: string;
  assetId: string;
  openedAt: number;
  saleTransactionId: string;
  soldUnits: number;
  salePriceEur: number;
  soldCostBasisEur: number;
  grossSaleProceedsEur: number;
  realizedGainEur: number;
  saleCostsEur: number;
  fiscalReserveEur: number;
  eurcBucketId: string;
  capitalRecovered: boolean;
  rebuyLotIds: string[];
  reboughtUnits: number;
  additionalUnits: number;
  status: ProfitHarvestCycleStatus;
}

export type LedgerEntryType =
  | "INITIAL_POSITION"
  | "EXTERNAL_CONTRIBUTION"
  | "PLAN_PURCHASE"
  | "PARTIAL_SALE"
  | "INTERNAL_REBUY"
  | "INTERNAL_REALLOCATION"
  | "FEE"
  | "TAX_RESERVE_CREATED"
  | "TAX_PAYMENT"
  | "TAX_RESERVE_RELEASED"
  | "EXTERNAL_WITHDRAWAL"
  | "MARKET_VALUATION";

export interface PerspectivesLedgerEntry {
  id: string;
  date: number;
  type: LedgerEntryType;
  assetId: string | null;
  lotId: string | null;
  eurcBucketId: string | null;
  profitHarvestCycleId: string | null;
  externalCashEur: number;
  operatingEurcEur: number;
  fiscalReserveEur: number;
  assetUnits: number;
  priceEur: number | null;
  grossAmountEur: number;
  costsEur: number;
  realizedGainEur: number;
  description: string;
}

export interface PerspectivesInitialPosition {
  assetId: string;
  lotId: string;
  acquiredAt: number;
  units: number;
  purchasePriceEur: number;
  acquisitionCostsEur: number;
  currentPriceEur: number;
}

export interface PerspectivesMonthlyContribution {
  id: string;
  date: number;
  assetId: string;
  amountEur: number;
}

export interface PerspectivesTaxBand {
  upToEur: number | null;
  rate: number;
}

export interface PerspectivesSimulationInput {
  now: number;
  horizonDate: number;
  scenario: PerspectivesScenario;
  strategyMode: PerspectivesStrategyMode;
  path: PerspectivesPricePath;
  sources: PerspectivesSourceEvidence[];
  initialPositions: PerspectivesInitialPosition[];
  monthlyContributions: PerspectivesMonthlyContribution[];
  initialOperatingEurcEur: number;
  initialFiscalReserveEur: number;
  initialCashEur: number;
  historicalExternalCapitalEur: number;
  commissionRate: number;
  taxBands: PerspectivesTaxBand[];
}

export interface PerspectivesDecisionAlternative {
  action:
    | "HOLD"
    | "SELL_5"
    | "SELL_10"
    | "SELL_15"
    | "SELL_20"
    | "SELL_25"
    | "KEEP_EURC"
    | "REBUY_20"
    | "REBUY_33"
    | "REBUY_50"
    | "CANCEL_REBUY";
  expectedNetValueEur: number;
  costsEur: number;
  taxEur: number;
  confidence: number;
  reason: string;
}

export interface PerspectivesStrategyDecision {
  id: string;
  date: number;
  assetId: string;
  profitHarvestCycleId: string | null;
  alternatives: PerspectivesDecisionAlternative[];
  selectedAction: PerspectivesDecisionAlternative["action"];
  selectedReason: string;
  usesFutureInformation: false;
}

export type PerspectivesProgrammableOperationType = "PARTIAL_SALE" | "REBUY";

export type PerspectivesTriggerOperator =
  | "PRICE_GREATER_OR_EQUAL"
  | "PRICE_LESS_OR_EQUAL";

export type PerspectivesPercentageBasis =
  | "AVAILABLE_ASSET_UNITS"
  | "AVAILABLE_OPERATING_RESERVE";

export type PerspectivesExecutionMode =
  | "COINBASE_NATIVE_LIMIT"
  | "APP_MONITORED_TRIGGER";

export type PerspectivesProgrammedOperationState =
  | "DRAFT"
  | "AWAITING_CONFIRMATION"
  | "PROGRAMMED"
  | "WAITING_DEPENDENCY"
  | "WAITING_FUNDS"
  | "MONITORING"
  | "BLOCKED_DATA"
  | "BLOCKED_RISK"
  | "BLOCKED_COINBASE"
  | "PREVIEWING"
  | "PREVIEW_READY"
  | "SUBMITTING"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED_BEFORE_SUBMIT"
  | "RECONCILIATION_REQUIRED"
  | "EXPIRED";

export type PerspectivesTradingMode =
  | "SIMULATION"
  | "REVIEW_ONLY"
  | "LIVE_TRADING";

export interface PerspectivesProgrammableOperation {
  simulationOperationId: string;
  simulationId: string;
  scenarioId: PerspectivesScenario;
  pathId: string;
  assetId: string;
  operationType: PerspectivesProgrammableOperationType;
  targetPriceEur: number;
  triggerOperator: PerspectivesTriggerOperator;
  percentage: number;
  percentageBasis: PerspectivesPercentageBasis;
  expectedUnits: number | null;
  expectedAmountEur: number | null;
  cycleId: string | null;
  planId: string | null;
  goalId: string | null;
  sourceSaleOperationId: string | null;
  sourceReserveBucketId: string | null;
  dependsOnOperationId: string | null;
  reason: string;
  confidence: number;
  sources: string[];
  simulatedAt: number;
  expectedDateRange: {
    from: number | null;
    to: number | null;
  };
  expiresAt: number | null;
}

export interface PerspectivesFrozenQuantity {
  frozenUnits: number | null;
  frozenAmountEur: number | null;
  frozenAt: number;
  availableUnitsAtFreeze: number | null;
  operatingReserveAtFreezeEur: number | null;
  fiscalReserveExcludedEur: number;
}

export interface PerspectivesMonthlySnapshot {
  month: string;
  date: number;
  openingNetWealthEur: number;
  closingGrossWealthEur: number;
  closingNetWealthEur: number;
  cryptoMarketValueEur: number;
  operatingEurcEur: number;
  fiscalReserveEur: number;
  cashEur: number;
  outstandingTaxLiabilityEur: number;
  externalCapitalCumulativeEur: number;
  internalRebuyCapitalCumulativeEur: number;
  internalReallocationCapitalCumulativeEur: number;
  totalCapitalDeployedCumulativeEur: number;
  realizedGainCumulativeEur: number;
  unrealizedGainEur: number;
  netProfitEur: number;
  externalContributionsThisMonthEur: number;
  marketResultThisMonthEur: number;
  costsThisMonthEur: number;
  taxesPaidThisMonthEur: number;
  externalWithdrawalsThisMonthEur: number;
  reconciliationDiffEur: number;
  lotIdsOpen: string[];
  eurcBucketIdsOpen: string[];
}

export interface PerspectivesAnnualSnapshot {
  year: number;
  openingNetWealthEur: number;
  closingGrossWealthEur: number;
  closingNetWealthEur: number;
  externalContributionsEur: number;
  internalRebuyCapitalEur: number;
  totalCapitalDeployedEur: number;
  realizedGainEur: number;
  unrealizedGainEur: number;
  netProfitEur: number;
  operatingEurcEur: number;
  fiscalReserveEur: number;
  partialSalesEur: number;
  rebuysEur: number;
  monthlyContinuityDiffEur: number;
}

export interface PerspectivesSimulationOutput {
  engineVersion: "perspectives-v5";
  generatedAt: number;
  scenario: PerspectivesScenario;
  strategyMode: PerspectivesStrategyMode;
  pathId: string;
  sourceManifest: PerspectivesSourceEvidence[];
  ledger: PerspectivesLedgerEntry[];
  lots: PerspectivesLot[];
  eurcBuckets: PerspectivesEurcBucket[];
  profitHarvestCycles: PerspectivesProfitHarvestCycle[];
  decisions: PerspectivesStrategyDecision[];
  monthlySnapshots: PerspectivesMonthlySnapshot[];
  annualSnapshots: PerspectivesAnnualSnapshot[];
  finalGrossWealthEur: number;
  finalNetWealthEur: number;
  externalCapitalEur: number;
  internalRebuyCapitalEur: number;
  internalReallocationCapitalEur: number;
  totalCapitalDeployedEur: number;
  realizedGainEur: number;
  unrealizedGainEur: number;
  netProfitEur: number;
  twrCumulative: number | null;
  twrAnnualized: number | null;
  xirr: number | null;
  validationErrors: string[];
}
