// Motor central de señales estratégicas.
// Llama a los motores existentes (partial-sale-engine, rebuy-engine) y produce
// StrategicSignal normalizados. Ninguna página debe recalcular condiciones
// por su cuenta; deben referenciar el signalId devuelto aquí.

import { randomUUID } from "crypto";
import {
  evaluatePartialSaleRule,
  type PartialSaleRule,
  type PositionData,
  type MarketData,
} from "../partial-sale-engine";
import {
  evaluateRebuyTierExtended,
  type RebuyTierExtended,
} from "../rebuy-engine";
import type {
  StrategicSignal,
  StrategicSignalStatus,
  SignalEngineInput,
  SignalEngineResult,
} from "./types";

// Escalones por defecto cuando no hay reglas ni tiers configurados.
// Mantienen el comportamiento de computeTradeAlerts como fallback.
const DEFAULT_SELL_THRESHOLDS: { gainPct: number; sellPct: number; label: string }[] = [
  { gainPct: 200, sellPct: 0.20, label: "Ganancia ≥ +200%" },
  { gainPct: 100, sellPct: 0.15, label: "Ganancia ≥ +100%" },
  { gainPct:  50, sellPct: 0.10, label: "Ganancia ≥ +50%" },
];

const DEFAULT_REBUY_THRESHOLDS: { drawdownPct: number; eurcPct: number; label: string }[] = [
  { drawdownPct: 40, eurcPct: 0.50, label: "Caída ≥ −40%" },
  { drawdownPct: 25, eurcPct: 0.30, label: "Caída ≥ −25%" },
  { drawdownPct: 15, eurcPct: 0.20, label: "Caída ≥ −15%" },
];

// Importe mínimo para que una recompra sea operativamente útil.
// Por debajo de este umbral no se genera señal aunque se cumpla la condición de caída.
const MINIMUM_REBUY_EUR = 25;

function makeSellSignal(
  assetId: string,
  ruleId: string,
  planId: string | null,
  cycleId: string | null,
  currentPriceEur: number,
  referencePriceEur: number | null,
  recommendedPercentage: number,
  recommendedAmountEur: number,
  recommendedQuantity: number,
  fiscalReserveEur: number,
  reasons: string[],
  status: StrategicSignalStatus,
  now: number,
): StrategicSignal {
  return {
    id: randomUUID(),
    deduplicationKey: `sell_partial:${assetId}:${ruleId}`,
    assetId,
    planId,
    cycleId,
    ruleId,
    actionType: "sell_partial",
    status,
    detectedAt: now,
    validFrom: now,
    expiresAt: now + 24 * 3600 * 1000,
    currentPriceEur,
    referencePriceEur,
    targetPriceEur: null,
    drawdownPct: null,
    recommendedPercentage,
    recommendedAmountEur,
    recommendedQuantity,
    fundingSource: "not_applicable",
    availableFundingEur: null,
    fiscalReserveExcludedEur: fiscalReserveEur,
    priority: recommendedAmountEur >= 500 ? "high" : "medium",
    confidence: 0.9,
    dataQuality: currentPriceEur > 0 ? "high" : "low",
    reasons,
    conditionsMatched: reasons,
    conditionsPending: [],
    sourceModules: ["partial-sale-engine"],
    simulationOnly: false,
  };
}

function makeRebuySignal(
  assetId: string,
  tierId: string,
  planId: string | null,
  cycleId: string | null,
  currentPriceEur: number,
  referencePriceEur: number,
  drawdownPct: number,
  recommendedAmountEur: number,
  recommendedQuantity: number,
  availableFundingEur: number,
  reasons: string[],
  status: StrategicSignalStatus,
  now: number,
): StrategicSignal {
  return {
    id: randomUUID(),
    deduplicationKey: `rebuy:${assetId ?? "any"}:${tierId}`,
    assetId,
    planId,
    cycleId,
    ruleId: tierId,
    actionType: "rebuy",
    status,
    detectedAt: now,
    validFrom: now,
    expiresAt: now + 24 * 3600 * 1000,
    currentPriceEur,
    referencePriceEur,
    targetPriceEur: null,
    drawdownPct,
    recommendedPercentage: null,
    recommendedAmountEur,
    recommendedQuantity,
    fundingSource: "free_eurc",
    availableFundingEur,
    fiscalReserveExcludedEur: null,
    priority: drawdownPct >= 30 ? "high" : "medium",
    confidence: 0.85,
    dataQuality: currentPriceEur > 0 ? "high" : "low",
    reasons,
    conditionsMatched: reasons,
    conditionsPending: [],
    sourceModules: ["rebuy-engine"],
    simulationOnly: false,
  };
}

export function evaluateSignals(input: SignalEngineInput): SignalEngineResult {
  const { now, positions, saleRules, rebuyTiers, treasury, lastSalePriceByAsset, activePlanId, activeCycleId } = input;
  const signals: StrategicSignal[] = [];

  const posMap: Record<string, typeof positions[0]> = {};
  for (const p of positions) posMap[p.assetId] = p;

  // ── Señales de venta: reglas configuradas ────────────────────────────────
  const hasConfiguredSaleRules = saleRules.some(r => r.status === "activa");

  if (hasConfiguredSaleRules) {
    for (const rawRule of saleRules) {
      const rule: PartialSaleRule = {
        id: rawRule.id,
        assetId: rawRule.assetId,
        cycleId: rawRule.cycleId,
        name: rawRule.name,
        conditionType: rawRule.conditionType as PartialSaleRule["conditionType"],
        conditionValue: rawRule.conditionValue,
        conditionValue2: rawRule.conditionValue2,
        sellPercentage: rawRule.sellPercentage,
        priority: rawRule.priority,
        status: rawRule.status as PartialSaleRule["status"],
        effectiveDate: rawRule.effectiveDate,
        notes: rawRule.notes,
      };
      const pos = posMap[rawRule.assetId];
      if (!pos) continue;

      const positionData: PositionData = {
        assetId: pos.assetId,
        balance: pos.balance,
        averagePriceEur: pos.averagePriceEur,
        totalInvestedEur: pos.totalInvestedEur,
      };
      const marketData: MarketData = {
        currentPriceEur: pos.currentPriceEur,
        marketPhase: null,
        isEuphoria: false,
      };

      const evaluation = evaluatePartialSaleRule(rule, positionData, marketData, now);
      if (!evaluation.isTriggered || !evaluation.preview) continue;

      const p = evaluation.preview;
      signals.push(makeSellSignal(
        rawRule.assetId,
        rawRule.id,
        activePlanId,
        activeCycleId ?? rawRule.cycleId,
        p.referencePrice,
        pos.averagePriceEur,
        p.percentageOfPosition,
        p.grossProceedsEur,
        p.quantityToSell,
        p.fiscalReserveEur,
        [evaluation.triggeredReason ?? rawRule.name],
        "detected",
        now,
      ));
    }
  } else {
    // Fallback: escalones automáticos cuando no hay reglas configuradas
    for (const pos of positions) {
      const price = pos.currentPriceEur;
      const avgCost = pos.averagePriceEur;
      if (!price || !avgCost || pos.balance <= 0) continue;
      const gainPct = (price / avgCost - 1) * 100;

      for (const t of DEFAULT_SELL_THRESHOLDS) {
        if (gainPct >= t.gainPct) {
          const qty = pos.balance * t.sellPct;
          signals.push(makeSellSignal(
            pos.assetId,
            `default-gain${t.gainPct}`,
            activePlanId,
            activeCycleId,
            price,
            avgCost,
            t.sellPct * 100,
            qty * price,
            qty,
            0,
            [`${t.label} (umbral automático, sin regla configurada)`],
            "detected",
            now,
          ));
          break;
        }
      }
    }
  }

  // ── Señales de recompra: tiers configurados ───────────────────────────────
  const hasConfiguredTiers = rebuyTiers.some(r => r.status === "activa");
  const availableEurc = Math.max(0, treasury.freeRebuyLiquidity);
  // Recompra solo permitida cuando existen ventas parciales reales ejecutadas.
  // Sin venta real previa no hay EURC procedente de beneficios disponible para recomprar.
  const hasAnyExecutedSale = Object.keys(lastSalePriceByAsset).length > 0;

  if (hasConfiguredTiers && hasAnyExecutedSale) {
    let remainingEurc = availableEurc;
    const sortedTiers = rebuyTiers
      .slice()
      .sort((a, b) => b.drawdownPercentage - a.drawdownPercentage || a.priority - b.priority);

    for (const rawTier of sortedTiers) {
      const tier: RebuyTierExtended = {
        id: rawTier.id,
        cycleId: rawTier.cycleId,
        assetId: rawTier.assetId,
        name: rawTier.name,
        drawdownPercentage: rawTier.drawdownPercentage,
        usagePercentage: rawTier.usagePercentage,
        priority: rawTier.priority,
        status: rawTier.status as RebuyTierExtended["status"],
        effectiveDate: rawTier.effectiveDate,
        notes: rawTier.notes,
        referenceType: rawTier.referenceType as RebuyTierExtended["referenceType"],
        referenceValue: rawTier.referenceValue,
        referenceDate: rawTier.referenceDate,
        lastTriggeredAt: rawTier.lastTriggeredAt,
      };
      if (!tier.assetId) continue;
      const pos = posMap[tier.assetId];
      const price = pos?.currentPriceEur ?? null;

      const evaluation = evaluateRebuyTierExtended(
        tier, price, remainingEurc,
        pos?.balance ?? 0, pos?.averagePriceEur ?? null, now
      );
      if (!evaluation.isTriggered || !evaluation.preview) continue;

      const p = evaluation.preview;
      if (p.proposedAmountEur < MINIMUM_REBUY_EUR) continue;

      signals.push(makeRebuySignal(
        tier.assetId,
        tier.id,
        activePlanId,
        activeCycleId ?? tier.cycleId,
        p.currentPriceEur,
        p.referencePrice,
        p.actualDrawdownPct,
        p.proposedAmountEur,
        p.estimatedQuantity,
        p.availableLiquidityEur,
        [p.triggerReason],
        "detected",
        now,
      ));
      remainingEurc = p.eurcRemainingAfterEur;
    }
  } else if (availableEurc >= MINIMUM_REBUY_EUR && hasAnyExecutedSale) {
    // Fallback: escalones automáticos cuando no hay tiers configurados
    for (const pos of positions) {
      const price = pos.currentPriceEur;
      const lastSale = lastSalePriceByAsset[pos.assetId] ?? null;
      if (!price || !lastSale || price >= lastSale) continue;
      const drawdownPct = (lastSale - price) / lastSale * 100;

      for (const t of DEFAULT_REBUY_THRESHOLDS) {
        if (drawdownPct >= t.drawdownPct) {
          const amountEur = availableEurc * t.eurcPct;
          signals.push(makeRebuySignal(
            pos.assetId,
            `default-dd${t.drawdownPct}`,
            activePlanId,
            activeCycleId,
            price,
            lastSale,
            drawdownPct,
            amountEur,
            amountEur / price,
            availableEurc,
            [`${t.label} desde última venta (umbral automático, sin tier configurado)`],
            "detected",
            now,
          ));
          break;
        }
      }
    }
  }

  const triggeredCount = signals.length;
  return {
    signals,
    evaluatedAt: now,
    configuredRulesCount: saleRules.length,
    configuredTiersCount: rebuyTiers.length,
    triggeredCount,
  };
}
