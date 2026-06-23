// Pure domain engine for partial sale rules — no I/O, no React, independently testable.
// Evaluates configurable rules against real position/price data and produces previews.
// NEVER executes sales automatically.

import { SPANISH_FISCAL_CONFIG_2024 } from "./projection-engine/types";

export type PartialSaleConditionType =
  | "price_target"
  | "cost_multiple"
  | "gain_percentage"
  | "market_phase"
  | "euphoria"
  | "combined";

export type PartialSaleRuleStatus =
  | "borrador" | "activa" | "activada" | "preparada" | "ejecutada" | "pausada" | "cancelada";

export interface PartialSaleRule {
  id: string;
  assetId: string;
  cycleId: string;
  name: string;
  conditionType: PartialSaleConditionType;
  conditionValue: number | null;
  conditionValue2: number | null;
  sellPercentage: number;
  priority: number;
  status: PartialSaleRuleStatus;
  effectiveDate: number | null;
  notes: string | null;
}

export interface PositionData {
  assetId: string;
  balance: number;
  averagePriceEur: number | null;
  totalInvestedEur: number;
}

export interface MarketData {
  currentPriceEur: number | null;
  marketPhase: string | null;
  isEuphoria: boolean;
}

export interface SalePreview {
  quantityToSell: number;
  percentageOfPosition: number;
  referencePrice: number;
  grossProceedsEur: number;
  costBasisProportion: number;
  estimatedGainEur: number;
  estimatedTaxEur: number;
  fiscalReserveEur: number;
  netEurcEur: number;
  remainingBalance: number;
  remainingPercentage: number;
  remainingValueEur: number;
}

export interface PartialSaleEvaluation {
  rule: PartialSaleRule;
  isTriggered: boolean;
  triggeredReason: string | null;
  notTriggeredReason: string | null;
  preview: SalePreview | null;
}

export function calculateSpanishSavingsTax(netGain: number): number {
  if (netGain <= 0) return 0;
  const brackets = SPANISH_FISCAL_CONFIG_2024.brackets;
  let remaining = netGain;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    const size = b.upTo !== null ? b.upTo - prev : Infinity;
    const taxable = Math.min(remaining, size);
    tax += taxable * b.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
    if (b.upTo !== null) prev = b.upTo;
  }
  return tax;
}

function buildPreview(
  rule: PartialSaleRule,
  position: PositionData,
  currentPrice: number
): SalePreview {
  const quantityToSell = position.balance * (rule.sellPercentage / 100);
  const percentageOfPosition = rule.sellPercentage;
  const grossProceedsEur = quantityToSell * currentPrice;
  const costBasisProportion = position.totalInvestedEur * (rule.sellPercentage / 100);
  const estimatedGainEur = Math.max(0, grossProceedsEur - costBasisProportion);
  const estimatedTaxEur = calculateSpanishSavingsTax(estimatedGainEur);
  const fiscalReserveEur = estimatedTaxEur;
  const netEurcEur = Math.max(0, grossProceedsEur - estimatedTaxEur);
  const remainingBalance = position.balance - quantityToSell;
  const remainingPercentage = position.balance > 0 ? (remainingBalance / position.balance) * 100 : 0;
  const remainingValueEur = remainingBalance * currentPrice;

  return {
    quantityToSell: Math.round(quantityToSell * 1e8) / 1e8,
    percentageOfPosition,
    referencePrice: currentPrice,
    grossProceedsEur: Math.round(grossProceedsEur * 100) / 100,
    costBasisProportion: Math.round(costBasisProportion * 100) / 100,
    estimatedGainEur: Math.round(estimatedGainEur * 100) / 100,
    estimatedTaxEur: Math.round(estimatedTaxEur * 100) / 100,
    fiscalReserveEur: Math.round(fiscalReserveEur * 100) / 100,
    netEurcEur: Math.round(netEurcEur * 100) / 100,
    remainingBalance: Math.round(remainingBalance * 1e8) / 1e8,
    remainingPercentage: Math.round(remainingPercentage * 100) / 100,
    remainingValueEur: Math.round(remainingValueEur * 100) / 100,
  };
}

function comparePartialSaleRules(a: PartialSaleRule, b: PartialSaleRule): number {
  if (a.assetId === b.assetId && a.conditionType === b.conditionType) {
    const aThreshold = a.conditionValue ?? Number.POSITIVE_INFINITY;
    const bThreshold = b.conditionValue ?? Number.POSITIVE_INFINITY;
    if (aThreshold !== bThreshold) return aThreshold - bThreshold;
  }
  return a.priority - b.priority;
}

function applyPreviewToPosition(position: PositionData, preview: SalePreview): PositionData {
  return {
    ...position,
    balance: preview.remainingBalance,
    totalInvestedEur: Math.max(0, position.totalInvestedEur - preview.costBasisProportion),
  };
}

export function evaluatePartialSaleRule(
  rule: PartialSaleRule,
  position: PositionData | null,
  market: MarketData,
  now = Date.now()
): PartialSaleEvaluation {
  const base: Omit<PartialSaleEvaluation, "isTriggered" | "triggeredReason" | "notTriggeredReason" | "preview"> = { rule };

  if (rule.status !== "activa") {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Estado de la regla: ${rule.status}`, preview: null };
  }

  if (rule.effectiveDate && now < rule.effectiveDate) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Fecha efectiva no alcanzada", preview: null };
  }

  if (!position || position.balance <= 0) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Sin posición disponible", preview: null };
  }

  if (rule.sellPercentage <= 0 || rule.sellPercentage >= 100) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Porcentaje de venta inválido: ${rule.sellPercentage}%`, preview: null };
  }

  const remainingAfterSale = position.balance * (1 - rule.sellPercentage / 100);
  if (remainingAfterSale <= 0) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "La regla liquidaría la posición completa; debe quedar una posición residual", preview: null };
  }

  const price = market.currentPriceEur;

  switch (rule.conditionType) {
    case "price_target": {
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      const target = rule.conditionValue;
      if (target === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio objetivo no configurado", preview: null };
      if (price >= target) {
        const preview = buildPreview(rule, position, price);
        return { ...base, isTriggered: true, triggeredReason: `Precio actual ${price.toFixed(2)} € ≥ objetivo ${target.toFixed(2)} €`, notTriggeredReason: null, preview };
      }
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Precio actual ${price.toFixed(2)} € < objetivo ${target.toFixed(2)} €`, preview: null };
    }

    case "cost_multiple": {
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      const avgCost = position.averagePriceEur;
      if (avgCost === null || avgCost <= 0) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Coste medio no disponible", preview: null };
      const multiple = rule.conditionValue;
      if (multiple === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Múltiplo objetivo no configurado", preview: null };
      const currentMultiple = price / avgCost;
      if (currentMultiple >= multiple) {
        const preview = buildPreview(rule, position, price);
        return { ...base, isTriggered: true, triggeredReason: `Múltiplo actual ${currentMultiple.toFixed(2)}x ≥ objetivo ${multiple}x (coste: ${avgCost.toFixed(2)} €, precio: ${price.toFixed(2)} €)`, notTriggeredReason: null, preview };
      }
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Múltiplo actual ${currentMultiple.toFixed(2)}x < objetivo ${multiple}x`, preview: null };
    }

    case "gain_percentage": {
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      const avgCost = position.averagePriceEur;
      if (avgCost === null || avgCost <= 0) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Coste medio no disponible", preview: null };
      const targetPct = rule.conditionValue;
      if (targetPct === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Porcentaje de subida objetivo no configurado", preview: null };
      const gainPct = ((price - avgCost) / avgCost) * 100;
      if (gainPct >= targetPct) {
        const preview = buildPreview(rule, position, price);
        return { ...base, isTriggered: true, triggeredReason: `Ganancia actual ${gainPct.toFixed(1)}% ≥ objetivo +${targetPct}%`, notTriggeredReason: null, preview };
      }
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Ganancia actual ${gainPct.toFixed(1)}% < objetivo +${targetPct}%`, preview: null };
    }

    case "market_phase": {
      const targetPhase = rule.conditionValue2 !== null ? String(rule.conditionValue2) : null;
      if (!market.marketPhase) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Fase de mercado no disponible", preview: null };
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      // The rule triggers when market phase matches (stored as notes or conditionValue reference)
      // For simplicity, trigger on any non-null market phase when there's a price condition too
      const priceTarget = rule.conditionValue;
      const triggered = priceTarget !== null ? price >= priceTarget : true;
      if (triggered) {
        const preview = buildPreview(rule, position, price);
        return { ...base, isTriggered: true, triggeredReason: `Fase de mercado: ${market.marketPhase}${priceTarget ? `, precio ${price.toFixed(2)} € ≥ ${priceTarget.toFixed(2)} €` : ""}`, notTriggeredReason: null, preview };
      }
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Condición de fase de mercado no alcanzada`, preview: null };
    }

    case "euphoria": {
      if (!market.isEuphoria) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "No se detecta euforia de mercado", preview: null };
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      const preview = buildPreview(rule, position, price);
      return { ...base, isTriggered: true, triggeredReason: "Señal de euforia de mercado detectada", notTriggeredReason: null, preview };
    }

    case "combined": {
      if (price === null) return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
      const priceTarget = rule.conditionValue;
      const gainTarget = rule.conditionValue2;
      const avgCost = position.averagePriceEur;
      const priceOk = priceTarget !== null ? price >= priceTarget : true;
      const gainOk = gainTarget !== null && avgCost !== null && avgCost > 0 ? ((price - avgCost) / avgCost) * 100 >= gainTarget : true;
      if (priceOk && gainOk) {
        const preview = buildPreview(rule, position, price);
        const reasons: string[] = [];
        if (priceTarget !== null) reasons.push(`precio ${price.toFixed(2)} € ≥ ${priceTarget.toFixed(2)} €`);
        if (gainTarget !== null) reasons.push(`ganancia ≥ +${gainTarget}%`);
        return { ...base, isTriggered: true, triggeredReason: reasons.join(" y "), notTriggeredReason: null, preview };
      }
      const missing: string[] = [];
      if (!priceOk && priceTarget !== null) missing.push(`precio ${price.toFixed(2)} € < objetivo ${priceTarget.toFixed(2)} €`);
      if (!gainOk && gainTarget !== null) missing.push(`ganancia insuficiente`);
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: missing.join("; "), preview: null };
    }

    default:
      return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Tipo de condición no soportado", preview: null };
  }
}

export function evaluatePartialSaleRules(
  rules: PartialSaleRule[],
  positions: Record<string, PositionData>,
  markets: Record<string, MarketData>,
  now = Date.now()
): PartialSaleEvaluation[] {
  const workingPositions: Record<string, PositionData> = Object.fromEntries(
    Object.entries(positions).map(([assetId, position]) => [assetId, { ...position }])
  );

  return rules
    .slice()
    .sort(comparePartialSaleRules)
    .map(rule => {
      const position = workingPositions[rule.assetId] ?? null;
      const market = markets[rule.assetId] ?? { currentPriceEur: null, marketPhase: null, isEuphoria: false };
      const evaluation = evaluatePartialSaleRule(rule, position, market, now);
      if (position && evaluation.isTriggered && evaluation.preview) {
        workingPositions[rule.assetId] = applyPreviewToPosition(position, evaluation.preview);
      }
      return evaluation;
    });
}

export function buildPreparedSaleOperation(evaluation: PartialSaleEvaluation): Record<string, unknown> | null {
  if (!evaluation.isTriggered || !evaluation.preview) return null;
  const { rule, preview } = evaluation;
  return {
    type: "prepared_partial_sale",
    assetId: rule.assetId,
    cycleId: rule.cycleId,
    ruleId: rule.id,
    ruleName: rule.name,
    quantityToSell: preview.quantityToSell,
    sellPercentage: preview.percentageOfPosition,
    referencePrice: preview.referencePrice,
    grossProceedsEur: preview.grossProceedsEur,
    estimatedGainEur: preview.estimatedGainEur,
    estimatedTaxEur: preview.estimatedTaxEur,
    fiscalReserveEur: preview.fiscalReserveEur,
    netEurcEur: preview.netEurcEur,
    remainingBalance: preview.remainingBalance,
    triggeredReason: evaluation.triggeredReason,
    preparedAt: Date.now(),
    status: "preparada",
  };
}
