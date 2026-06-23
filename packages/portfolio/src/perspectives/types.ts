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

// ─── Lotes FIFO en la simulación ─────────────────────────────────────────────

export interface SimLot {
  id: string;
  assetId: string;
  acquiredAt: number;  // ms
  quantity: number;
  remaining: number;
  costPerUnitEur: number;
  source: "historical" | "sim_plan" | "sim_rebuy" | "sim_extraordinary";
}

// ─── Estado de un activo en un punto de la simulación ────────────────────────

export interface AssetSimState {
  assetId: string;
  balance: number;
  lots: SimLot[];
  avgCostEur: number | null;
  peakPriceEur: number | null;    // máximo precio visto
  lastSalePriceEur: number | null;
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
  monthEurcReinvestedEur: number;
  // acumulados del escenario hasta este mes
  cumulativeContributionsEur: number;
  cumulativeSalesEur: number;
  cumulativeRebuysEur: number;
  cumulativeTaxEur: number;
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
  eurcReinvestedEur: number;

  // Stock a fin de año
  fiscalReserveEur: number;
  eurcFreeEur: number;
  eurCashEur: number;

  // Rendimiento del año
  annualReturnPct: number | null;

  // Posiciones a fin de año por activo
  positions: Record<string, AnnualAssetPosition>;

  // Cronología de eventos del año
  events: SimEvent[];

  // Motivos de ausencia de operaciones (para transparencia del motor)
  salesSkipReasons: string[];
  rebuysSkipReasons: string[];
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
  assetId?: string;
  amountEur?: number;
  quantity?: number;
  priceEur?: number;
  gainEur?: number;
  taxEur?: number;
  description: string;
}

// ─── Resultado por escenario ─────────────────────────────────────────────────

export interface ScenarioResult {
  scenario: SimScenario;
  label: string;
  annualSnapshots: AnnualSnapshot[];
  summary: ScenarioSummary;
}

export interface ScenarioSummary {
  scenario: SimScenario;
  initialWealthEur: number;
  finalNetWealthEur: number;
  totalContributionsEur: number;
  totalHistoricalCapitalEur: number;
  totalMarketGainEur: number;
  totalSalesEur: number;
  totalRebuysEur: number;
  totalCommissionsEur: number;
  totalTaxEur: number;
  totalEurcReinvestedEur: number;
  finalEurcFreeEur: number;
  finalFiscalReserveEur: number;
  xirr: number | null;
  twr: number | null;
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

export interface PerspectivesSimulation {
  computedAt: number;
  startYear: number;
  endYear: number;
  horizonDate: number;
  scenarios: ScenarioResult[];
  // Validaciones de integridad
  validations: ValidationResult[];
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
  triggerType: "gain_multiple" | "price_target" | "portfolio_weight";
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
  commissionRate: number;  // e.g. 0.004 = 0.4%
  taxBands: TaxBand[];
}

export interface TaxBand {
  upToEur: number | null;  // null = unlimited
  rate: number;
}

export const DEFAULT_SPANISH_TAX_BANDS: TaxBand[] = [
  { upToEur: 6000,  rate: 0.19 },
  { upToEur: 50000, rate: 0.21 },
  { upToEur: 200000, rate: 0.23 },
  { upToEur: null,  rate: 0.26 },
];

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  policy: "full_strategy",
  commissionRate: 0.004,
  taxBands: DEFAULT_SPANISH_TAX_BANDS,
};
