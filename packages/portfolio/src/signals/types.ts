// Motor central de señales estratégicas.
// Una señal es la única fuente de verdad para una acción detectada.
// Compra Inteligente, Ventas/Recompras, Alertas y Perspectivas la referencian
// por signalId, sin recalcular las condiciones por su cuenta.

export type StrategicActionType =
  | "buy"
  | "buy_partial"
  | "hold"
  | "sell_partial"
  | "sell_total_exceptional"
  | "rebuy"
  | "pause_asset"
  | "review_asset"
  | "replace_asset";

export type StrategicSignalStatus =
  | "detected"
  | "active"
  | "acknowledged"
  | "prepared"
  | "executed"
  | "dismissed"
  | "expired"
  | "cancelled";

export type StrategySignalType =
  | "buy"
  | "sell"
  | "rebuy"
  | "hold"
  | "review"
  | "replace"
  | "alert";

export type StrategySignalStatus =
  | "active"
  | "not_triggered"
  | "insufficient_data"
  | "blocked"
  | "expired";

export interface StrategySignalEvidence {
  label: string;
  value: number | string | boolean | null;
  source: string;
  observedAt: number;
}

export interface StrategySignal {
  signalId: string;
  assetId: string;
  type: StrategySignalType;
  status: StrategySignalStatus;
  generatedAt: number;
  dataVersion: string;
  reason: string;
  evidence: StrategySignalEvidence[];
  missingInputs: string[];
  confidence: number;
}

export type SignalFundingSource =
  | "external_cash"
  | "eur"
  | "free_eurc"
  | "not_applicable";

export type SignalPriority = "low" | "medium" | "high" | "critical";
export type SignalDataQuality = "high" | "medium" | "low" | "insufficient";

export interface StrategicSignal {
  id: string;
  signalId: string;
  /** Clave única para deduplicar: `${actionType}:${assetId}:${ruleId|tierId}` */
  deduplicationKey: string;
  assetId: string;
  planId: string | null;
  cycleId: string | null;
  /** ID de la regla de venta o tier de recompra que originó la señal */
  ruleId: string | null;
  actionType: StrategicActionType;
  status: StrategicSignalStatus;
  detectedAt: number;
  validFrom: number;
  expiresAt: number | null;
  // Precios en el momento de la detección
  currentPriceEur: number | null;
  referencePriceEur: number | null;
  targetPriceEur: number | null;
  drawdownPct: number | null;
  // Cantidades recomendadas
  recommendedPercentage: number | null;
  recommendedAmountEur: number | null;
  recommendedQuantity: number | null;
  // Financiación
  fundingSource: SignalFundingSource;
  availableFundingEur: number | null;
  fiscalReserveExcludedEur: number | null;
  // Metadatos
  priority: SignalPriority;
  confidence: number | null;
  generatedAt: number;
  dataVersion: string;
  reason: string;
  evidence: StrategySignalEvidence[];
  missingInputs: string[];
  dataQuality: SignalDataQuality;
  reasons: string[];
  conditionsMatched: string[];
  conditionsPending: string[];
  sourceModules: string[];
  simulationOnly: boolean;
}

// ─── Input del motor de señales ───────────────────────────────────────────────

export interface SignalPosition {
  assetId: string;
  balance: number;
  averagePriceEur: number | null;
  currentPriceEur: number | null;
  totalInvestedEur: number;
}

export interface SignalSaleRule {
  id: string;
  assetId: string;
  cycleId: string;
  name: string;
  conditionType: string;
  conditionValue: number | null;
  conditionValue2: number | null;
  sellPercentage: number;
  priority: number;
  status: string;
  effectiveDate: number | null;
  notes: string | null;
}

export interface SignalRebuyTier {
  id: string;
  cycleId: string;
  assetId: string | null;
  name: string | null;
  drawdownPercentage: number;
  usagePercentage: number;
  priority: number;
  status: string;
  referenceType: string | null;
  referenceValue: number | null;
  referenceDate: number | null;
  effectiveDate: number | null;
  notes: string | null;
  lastTriggeredAt: number | null;
}

export interface SignalTreasury {
  eurcBalance: number;
  fiscalReserveBalance: number;
  freeRebuyLiquidity: number;
}

export interface SignalEngineInput {
  now: number;
  positions: SignalPosition[];
  saleRules: SignalSaleRule[];
  rebuyTiers: SignalRebuyTier[];
  treasury: SignalTreasury;
  lastSalePriceByAsset: Record<string, number>;
  activePlanId: string | null;
  activeCycleId: string | null;
  /** Modo live = crea señales reales; simulation = solo retorna, sin alertas */
  mode: "live" | "simulation";
}

export interface SignalEngineResult {
  signals: StrategicSignal[];
  evaluatedAt: number;
  configuredRulesCount: number;
  configuredTiersCount: number;
  triggeredCount: number;
}
