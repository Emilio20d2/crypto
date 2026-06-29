export type ProfitHarvestCycleStatus =
  | "proposed"
  | "prepared"
  | "waiting_rebuy"
  | "partially_rebought"
  | "completed"
  | "expired"
  | "cancelled";

export type ProfitHarvestStrategyMode =
  | "PASSIVE"
  | "USER_RULES"
  | "INTELLIGENT_STRATEGY"
  | "HYBRID";

export interface ProfitHarvestSignalSnapshot {
  signalId: string;
  assetId: string;
  type: "sell" | "rebuy" | "hold" | "review" | "replace" | "alert";
  status: "active" | "not_triggered" | "insufficient_data" | "blocked" | "expired";
  generatedAt: number;
  dataVersion: string;
  reason: string;
  confidence: number;
}

export interface ProfitHarvestRebuy {
  id: string;
  executedAt: number | null;
  priceEur: number;
  eurcUsedEur: number;
  quantity: number;
  costsEur: number;
  simulated: boolean;
}

export interface ProfitHarvestCycle {
  id: string;
  assetId: string;
  cycleId: string | null;
  planId: string | null;
  openedAt: number;
  closedAt: number | null;
  status: ProfitHarvestCycleStatus;
  strategyMode: ProfitHarvestStrategyMode;
  strategySource: "none" | "user_rules" | "intelligent_strategy" | "hybrid";
  simulationOnly: boolean;
  requiresUserConfirmation: boolean;
  lotsAffected: string[];
  unitsSold: number;
  sellPriceEur: number;
  grossSaleEur: number;
  acquisitionCostEur: number;
  realizedGainEur: number;
  taxEur: number;
  costsEur: number;
  eurcFiscalReserveEur: number;
  eurcOperationalEur: number;
  reason: string;
  positiveSignals: ProfitHarvestSignalSnapshot[];
  negativeSignals: ProfitHarvestSignalSnapshot[];
  breakEvenRebuyPriceEur: number;
  minimumDropPct: number;
  targetZone: {
    minPriceEur: number;
    maxPriceEur: number;
    minDropPct: number;
    maxDropPct: number;
  };
  rebuys: ProfitHarvestRebuy[];
  unitsRebought: number;
  additionalUnits: number;
  resultVsHoldEur: number;
  expiresAt: number | null;
}

export interface BuildProfitHarvestCycleInput {
  id: string;
  assetId: string;
  cycleId?: string | null;
  planId?: string | null;
  openedAt: number;
  strategyMode: ProfitHarvestStrategyMode;
  unitsSold: number;
  sellPriceEur: number;
  acquisitionCostEur: number;
  taxEur: number;
  costsEur: number;
  lotsAffected?: string[];
  reason: string;
  positiveSignals?: ProfitHarvestSignalSnapshot[];
  negativeSignals?: ProfitHarvestSignalSnapshot[];
  targetDropPct?: number;
  expiresAt?: number | null;
}

export function strategySourceForHarvest(mode: ProfitHarvestStrategyMode): ProfitHarvestCycle["strategySource"] {
  if (mode === "USER_RULES") return "user_rules";
  if (mode === "INTELLIGENT_STRATEGY") return "intelligent_strategy";
  if (mode === "HYBRID") return "hybrid";
  return "none";
}

export function calculateBreakEvenRebuyPrice(input: {
  unitsSold: number;
  sellPriceEur: number;
  taxEur: number;
  costsEur: number;
}): number {
  if (input.unitsSold <= 0 || input.sellPriceEur <= 0) return 0;
  const grossSaleEur = input.unitsSold * input.sellPriceEur;
  const operationalEurc = Math.max(0, grossSaleEur - input.taxEur - input.costsEur);
  return operationalEurc / input.unitsSold;
}

export function calculateMinimumDropPct(sellPriceEur: number, breakEvenRebuyPriceEur: number): number {
  if (sellPriceEur <= 0 || breakEvenRebuyPriceEur <= 0) return 0;
  return Math.max(0, (1 - breakEvenRebuyPriceEur / sellPriceEur) * 100);
}

export function buildProfitHarvestCycle(input: BuildProfitHarvestCycleInput): ProfitHarvestCycle {
  const grossSaleEur = input.unitsSold * input.sellPriceEur;
  const realizedGainEur = grossSaleEur - input.acquisitionCostEur - input.costsEur;
  const eurcFiscalReserveEur = Math.max(0, input.taxEur);
  const eurcOperationalEur = Math.max(0, grossSaleEur - eurcFiscalReserveEur - input.costsEur);
  const breakEvenRebuyPriceEur = calculateBreakEvenRebuyPrice(input);
  const minimumDropPct = calculateMinimumDropPct(input.sellPriceEur, breakEvenRebuyPriceEur);
  const requestedDropPct = Math.max(input.targetDropPct ?? minimumDropPct, minimumDropPct);
  const targetMaxPriceEur = input.sellPriceEur * (1 - requestedDropPct / 100);
  const targetMinDropPct = requestedDropPct;
  const targetMaxDropPct = Math.min(95, Math.max(targetMinDropPct + 10, targetMinDropPct));
  const targetMinPriceEur = input.sellPriceEur * (1 - targetMaxDropPct / 100);
  const strategySource = strategySourceForHarvest(input.strategyMode);

  return {
    id: input.id,
    assetId: input.assetId,
    cycleId: input.cycleId ?? null,
    planId: input.planId ?? null,
    openedAt: input.openedAt,
    closedAt: null,
    status: "proposed",
    strategyMode: input.strategyMode,
    strategySource,
    simulationOnly: input.strategyMode !== "USER_RULES",
    requiresUserConfirmation: input.strategyMode !== "PASSIVE",
    lotsAffected: input.lotsAffected ?? [],
    unitsSold: input.unitsSold,
    sellPriceEur: input.sellPriceEur,
    grossSaleEur,
    acquisitionCostEur: input.acquisitionCostEur,
    realizedGainEur,
    taxEur: input.taxEur,
    costsEur: input.costsEur,
    eurcFiscalReserveEur,
    eurcOperationalEur,
    reason: input.reason,
    positiveSignals: input.positiveSignals ?? [],
    negativeSignals: input.negativeSignals ?? [],
    breakEvenRebuyPriceEur,
    minimumDropPct,
    targetZone: {
      minPriceEur: targetMinPriceEur,
      maxPriceEur: targetMaxPriceEur,
      minDropPct: targetMinDropPct,
      maxDropPct: targetMaxDropPct,
    },
    rebuys: [],
    unitsRebought: 0,
    additionalUnits: 0,
    resultVsHoldEur: 0,
    expiresAt: input.expiresAt ?? null,
  };
}

export function addSimulatedRebuy(cycle: ProfitHarvestCycle, rebuy: ProfitHarvestRebuy): ProfitHarvestCycle {
  const rebuys = [...cycle.rebuys, rebuy];
  const unitsRebought = rebuys.reduce((sum, item) => sum + item.quantity, 0);
  const eurcUsed = rebuys.reduce((sum, item) => sum + item.eurcUsedEur + item.costsEur, 0);
  const additionalUnits = Math.max(0, unitsRebought - cycle.unitsSold);
  const buyAndHoldValue = cycle.unitsSold * rebuy.priceEur;
  const reboughtValue = unitsRebought * rebuy.priceEur + Math.max(0, cycle.eurcOperationalEur - eurcUsed);

  return {
    ...cycle,
    status: unitsRebought >= cycle.unitsSold ? "completed" : "partially_rebought",
    rebuys,
    unitsRebought,
    additionalUnits,
    resultVsHoldEur: reboughtValue - buyAndHoldValue,
    closedAt: unitsRebought >= cycle.unitsSold ? rebuy.executedAt : cycle.closedAt,
  };
}
