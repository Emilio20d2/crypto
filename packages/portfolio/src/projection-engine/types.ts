// ── Escenarios ────────────────────────────────────────────────────────────────

export type ProjectionScenario = "conservador" | "base" | "optimista" | "dinamico";

// ── Configuración fiscal (versionada, sin hardcodear) ─────────────────────────

export interface FiscalBracket {
  upTo: number | null; // null = sin límite
  rate: number; // 0..1
}

export interface FiscalConfig {
  version: string;
  effectiveFrom: number; // timestamp
  brackets: FiscalBracket[];
  jurisdiction: string;
}

// Brackets españoles del ahorro (2024+): 19/21/23/27/28%
export const SPANISH_FISCAL_CONFIG_2024: FiscalConfig = {
  version: "es-2024",
  effectiveFrom: new Date("2024-01-01").getTime(),
  jurisdiction: "ES",
  brackets: [
    { upTo: 6_000,   rate: 0.19 },
    { upTo: 50_000,  rate: 0.21 },
    { upTo: 200_000, rate: 0.23 },
    { upTo: 300_000, rate: 0.27 },
    { upTo: null,    rate: 0.28 },
  ],
};

// ── Hipótesis por escenario ────────────────────────────────────────────────────

export interface AssetScenarioRates {
  assetId: string;
  annualGrowthRate: number; // ej. 0.10 = 10%
  volatility: number;       // 0..1 (informativo, no aleatorio)
  correctionDepth: number;  // fracción máx de corrección esperada
  source?: string;
  hypothesis?: string;
  dataQuality?: "alta" | "media" | "baja";
  confidence?: number;
}

export interface ScenarioHypotheses {
  scenario: ProjectionScenario;
  label: string;
  description: string;
  probability: number | null;
  confidence: number | null; // 0..1
  assetRates: AssetScenarioRates[];
  defaultAnnualGrowthRate: number; // para activos sin tasa específica
  marketPhase: "bull" | "bear" | "sideways" | "unknown";
  dynamicFactors?: DynamicMarketFactors;
}

export interface DynamicMarketFactors {
  fearAndGreedIndex: number | null;
  btcDominance: number | null;
  globalMarketCapEur: number | null;
  generatedAt: number;
  sourcesUsed: string[];
  sourcesUnavailable: string[];
  confidence: number; // 0..1
}

// ── Snapshot consolidado (fuente única de verdad) ─────────────────────────────

export interface SnapshotPlan {
  id: string;
  name: string;
  status: string;
  baseCurrency: string;
}

export interface SnapshotPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  currentValueEur: number | null;
  currentPriceEur: number | null;
}

export interface SnapshotCycleAsset {
  id: string;         // investmentAssetId
  assetId: string;
  cycleId: string;
  status: string;
  allocationPercentage: number | null;
  allocationValue: number | null;
  allocationType: string;
  priority: number;
  targetAmount: number | null;
  targetValueEur: number | null;
  targetPortfolioPercentage: number | null;
  goalReachedAt: number | null;
  startDate: number;
  endDate: number | null;
}

export interface SnapshotCycle {
  id: string;
  planId: string;
  name: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
  status: string;
  assets: SnapshotCycleAsset[];
}

export interface SnapshotContribution {
  id: string;
  cycleId: string;
  type: "periodica" | "extraordinaria";
  plannedDate: number;
  amountEur: number;
  destinationAssetId?: string | null;
  status: "pendiente" | "ejecutada" | "saltada" | "cancelada";
  executedAt: number | null;
}

export interface SnapshotSaleRule {
  id: string;
  cycleId: string;
  assetId: string;
  name: string;
  conditionType: string;
  conditionValue: number | null;
  conditionValue2: number | null;
  sellPercentage: number;
  priority: number;
  status: string;
}

export interface SnapshotRebuyTier {
  id: string;
  cycleId: string;
  assetId: string | null;
  drawdownPercentage: number;
  usagePercentage: number;
  priority: number;
  status: string;
  referenceType: string | null;
  referenceValue: number | null;
  lastTriggeredAt: number | null;
}

export interface SnapshotSubstitution {
  id: string;
  cycleId: string;
  fromAssetId: string;
  toAssetId: string | null;
  effectiveDate: number;
  status: string;
  transferMode: string;
}

export interface SnapshotTreasury {
  cashEur: number;
  eurcEur: number;
  eurcAvailableEur: number;
  fiscalReserveEur: number;
  totalLiquidityEur: number;
}

export interface DataQualityInfo {
  overallScore: number; // 0..1
  missingPrices: string[];
  missingCosts: string[];
  staleData: string[];
  notes: string[];
}

export interface PlanConsolidatedSnapshot {
  snapshotId: string;
  generatedAt: number;
  projectionStartDate: number;

  planId: string;
  planName: string;
  plans?: SnapshotPlan[];

  cycles: SnapshotCycle[];         // ordenados por startDate
  positions: Record<string, SnapshotPosition>;
  historicalCapitalEur: number;   // total aportado hasta projectionStartDate
  historicalSalesEur: number;     // total vendido hasta projectionStartDate
  historicalRebuysEur: number;    // total recomprado hasta projectionStartDate

  futureContributions: SnapshotContribution[];  // status=pendiente, fecha > projectionStartDate
  saleRules: SnapshotSaleRule[];
  rebuyTiers: SnapshotRebuyTier[];
  substitutions: SnapshotSubstitution[];        // status=programada, fecha > projectionStartDate

  treasury: SnapshotTreasury;
  prices: Record<string, number | null>;        // precios en EUR en projectionStartDate

  dataQuality: DataQualityInfo;
  fiscalVersion: string;
  strategyVersion: string;
}

// ── Entrada del motor ─────────────────────────────────────────────────────────

export type ProjectionResolution = "monthly";

export interface ProjectionOptions {
  openCycleHorizonYears?: number;  // años extra para etapas sin fin (default 10)
  maxDeviationPct?: number;        // límite de desviación en equilibrado
  projectExtraordinaryContributions?: boolean;  // default false
  extraordinaryAmountEurPerYear?: number | null;
  complianceRate?: number;         // 0..1, default 1.0 (cumplimiento 100%)
}

export interface ProjectionInput {
  snapshot: PlanConsolidatedSnapshot;
  projectionStartDate: number;
  horizonDate: number;
  scenario: ProjectionScenario;
  scenarioHypotheses: ScenarioHypotheses;
  fiscalConfig: FiscalConfig;
  resolution: ProjectionResolution;
  options: ProjectionOptions;
  now: number;
}

// ── Lotes FIFO ────────────────────────────────────────────────────────────────

export interface ProjectionLot {
  lotId: string;
  assetId: string;
  acquiredAt: number;
  quantity: number;
  costPerUnitEur: number;
  remaining: number;
  source: "historical" | "projection_contribution" | "projection_rebuy";
}

// ── Eventos proyectados ───────────────────────────────────────────────────────

export type ProjectionEventType =
  | "contribution"
  | "extraordinary_contribution"
  | "buy"
  | "partial_sale"
  | "rebuy"
  | "goal_reached"
  | "redistribution"
  | "substitution"
  | "cycle_transition"
  | "tax_paid";

export interface ProjectionEvent {
  date: number;
  type: ProjectionEventType;
  cycleId: string;
  assetId?: string;
  amountEur?: number;
  quantity?: number;
  priceEur?: number;
  gainEur?: number;
  taxEur?: number;
  description: string;
}

// ── Posición proyectada por activo en un periodo ──────────────────────────────

export interface ProjectedAssetPosition {
  assetId: string;
  balance: number;
  avgCostEur: number | null;
  priceEur: number | null;
  valueEur: number | null;
  unrealizedGainEur: number | null;
}

// ── Resultado por periodo ─────────────────────────────────────────────────────

export interface ProjectionPeriod {
  date: number;
  cycleId: string;

  portfolioValueEur: number;
  cashEur: number;
  eurcAvailableEur: number;
  fiscalReserveEur: number;

  grossWealthEur: number;
  netWealthEur: number;

  historicalCapitalEur: number;
  futureCapitalEur: number;
  totalCapitalEur: number;

  realizedGainEur: number;
  unrealizedGainEur: number;

  totalSalesEur: number;
  totalRebuysEur: number;

  taxGeneratedEur: number;
  taxPendingEur: number;
  taxPaidEur: number;

  positions: Record<string, ProjectedAssetPosition>;
  events: ProjectionEvent[];
}

// ── Resultado por etapa ───────────────────────────────────────────────────────

export interface CycleProjectionResult {
  cycleId: string;
  cycleName: string;
  startDate: number;
  endDate: number | null;

  plannedContributionEur: number;
  simulatedContributionEur: number;
  extraordinaryContributionEur: number;

  buysByAsset: Record<string, number>;
  goalReachedAssets: string[];

  salesEur: number;
  rebuysEur: number;

  taxGeneratedEur: number;
  eurcGeneratedEur: number;
  eurcUsedEur: number;

  startValueEur: number;
  endValueEur: number;
  endNetWealthEur: number;

  effectiveAllocation: Record<string, number>;
  events: ProjectionEvent[];
}

// ── Resultado por activo ──────────────────────────────────────────────────────

export interface AssetProjectionResult {
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
  realizedGainEur: number;

  finalPriceEur: number | null;
  finalValueEur: number | null;
  finalAvgCostEur: number | null;
  unrealizedGainEur: number | null;

  targetAmount: number | null;
  targetValueEur: number | null;
  goalReachedAt: number | null;
  goalReachedProjectedAt: number | null;

  rulesTriggered: string[];
  events: ProjectionEvent[];
}

// ── Reconciliación ────────────────────────────────────────────────────────────

export interface ReconciliationCheck {
  name: string;
  passed: boolean;
  expected: number;
  actual: number;
  toleranceEur: number;
  delta: number;
}

export interface Reconciliation {
  checks: ReconciliationCheck[];
  allPassed: boolean;
  toleranceEur: number;
}

// ── Validación ────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ProjectionValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ── Resumen final ─────────────────────────────────────────────────────────────

export interface ProjectionSummary {
  scenario: ProjectionScenario;
  horizonDate: number;
  projectionStartDate: number;

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
  finalFiscalReserveEur: number;
  finalCashEur: number;

  probability: number | null;
  confidence: number | null;
  confidenceFactors: string[];

  nextProjectedEvent: ProjectionEvent | null;
}

// ── Salida del motor ──────────────────────────────────────────────────────────

export interface ProjectionOutput {
  snapshotId: string;
  projectionStartDate: number;
  generatedAt: number;
  horizonDate: number;
  scenario: ProjectionScenario;
  scenarioHypotheses: ScenarioHypotheses;

  summary: ProjectionSummary;
  periods: ProjectionPeriod[];
  cycleResults: CycleProjectionResult[];
  assetResults: AssetProjectionResult[];

  reconciliation: Reconciliation;
  validation: ProjectionValidationResult;
  fifoLots: ProjectionLot[];

  priceSource: string;
  fiscalVersion: string;
  strategyVersion: string;

  cacheKey: string;
}

// ── Clave de caché ────────────────────────────────────────────────────────────

export function buildCacheKey(input: Omit<ProjectionInput, "now">): string {
  return [
    input.snapshot.snapshotId,
    input.scenario,
    input.horizonDate,
    input.fiscalConfig.version,
    input.snapshot.strategyVersion,
    JSON.stringify(input.scenarioHypotheses.assetRates.map(r => `${r.assetId}:${r.annualGrowthRate}`).sort()),
  ].join("|");
}
