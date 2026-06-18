// Extended rebuy evaluation engine supporting per-asset tiers and reference types.
// Extends the basic evaluateRebuyTiers from rebuy-tiers.ts with asset-level rules.
// NEVER executes purchases automatically.

export type RebuyReferenceType =
  | "max_since_sale"
  | "sale_price"
  | "cycle_max"
  | "manual";

export type RebuyTierStatus = "activa" | "pausada" | "cancelada";

export interface RebuyTierExtended {
  id: string;
  cycleId: string;
  assetId: string | null;
  name: string | null;
  drawdownPercentage: number;
  usagePercentage: number;
  priority: number;
  status: RebuyTierStatus;
  effectiveDate: number | null;
  notes: string | null;
  referenceType: RebuyReferenceType | null;
  referenceValue: number | null;
  referenceDate: number | null;
  lastTriggeredAt: number | null;
}

export interface RebuyPositionData {
  assetId: string;
  currentPriceEur: number | null;
}

export interface RebuyPreview {
  tierId: string;
  tierName: string | null;
  assetId: string | null;
  drawdownPercentage: number;
  usagePercentage: number;
  currentPriceEur: number;
  referencePrice: number;
  referenceType: string;
  actualDrawdownPct: number;
  availableLiquidityEur: number;
  proposedAmountEur: number;
  estimatedQuantity: number;
  eurcRemainingAfterEur: number;
  estimatedNewAvgCost: number | null;
  triggerReason: string;
}

export interface RebuyEvaluationResult {
  tier: RebuyTierExtended;
  isTriggered: boolean;
  triggeredReason: string | null;
  notTriggeredReason: string | null;
  preview: RebuyPreview | null;
}

function resolveReferencePrice(tier: RebuyTierExtended): { price: number; label: string } | null {
  if (tier.referenceValue !== null && tier.referenceValue > 0) {
    return { price: tier.referenceValue, label: tier.referenceType ?? "manual" };
  }
  return null;
}

function calcDrawdown(currentPrice: number, referencePrice: number): number {
  if (referencePrice <= 0) return 0;
  return ((referencePrice - currentPrice) / referencePrice) * 100;
}

function estimateNewAvgCost(
  existingBalance: number,
  existingAvgCost: number | null,
  buyAmountEur: number,
  buyPriceEur: number
): number | null {
  if (existingAvgCost === null) return null;
  const newQty = buyAmountEur / buyPriceEur;
  const totalQty = existingBalance + newQty;
  if (totalQty <= 0) return null;
  const totalCost = existingBalance * existingAvgCost + buyAmountEur;
  return totalCost / totalQty;
}

export function evaluateRebuyTierExtended(
  tier: RebuyTierExtended,
  assetPrice: number | null,
  availableLiquidityEur: number,
  existingBalance = 0,
  existingAvgCost: number | null = null,
  now = Date.now()
): RebuyEvaluationResult {
  const base = { tier };

  if (tier.status !== "activa") {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Estado: ${tier.status}`, preview: null };
  }

  if (tier.effectiveDate && now < tier.effectiveDate) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Fecha efectiva no alcanzada", preview: null };
  }

  if (availableLiquidityEur <= 0) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Sin liquidez EURC disponible", preview: null };
  }

  if (assetPrice === null || assetPrice <= 0) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Precio actual no disponible", preview: null };
  }

  const ref = resolveReferencePrice(tier);
  if (!ref) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: "Sin precio de referencia configurado", preview: null };
  }

  const actualDrawdown = calcDrawdown(assetPrice, ref.price);

  if (actualDrawdown < tier.drawdownPercentage) {
    return { ...base, isTriggered: false, triggeredReason: null, notTriggeredReason: `Caída actual ${actualDrawdown.toFixed(1)}% < umbral -${tier.drawdownPercentage}% (ref: ${ref.price.toFixed(2)} €)`, preview: null };
  }

  const proposedAmountEur = availableLiquidityEur * (tier.usagePercentage / 100);
  const estimatedQuantity = proposedAmountEur / assetPrice;
  const eurcRemainingAfterEur = availableLiquidityEur - proposedAmountEur;
  const newAvgCost = estimateNewAvgCost(existingBalance, existingAvgCost, proposedAmountEur, assetPrice);
  const triggerReason = `Caída ${actualDrawdown.toFixed(1)}% desde ${ref.label} (${ref.price.toFixed(2)} €): usar ${tier.usagePercentage}% de ${availableLiquidityEur.toFixed(2)} € = ${proposedAmountEur.toFixed(2)} €`;

  const preview: RebuyPreview = {
    tierId: tier.id,
    tierName: tier.name,
    assetId: tier.assetId,
    drawdownPercentage: tier.drawdownPercentage,
    usagePercentage: tier.usagePercentage,
    currentPriceEur: assetPrice,
    referencePrice: ref.price,
    referenceType: ref.label,
    actualDrawdownPct: Math.round(actualDrawdown * 10) / 10,
    availableLiquidityEur,
    proposedAmountEur: Math.round(proposedAmountEur * 100) / 100,
    estimatedQuantity: Math.round(estimatedQuantity * 1e8) / 1e8,
    eurcRemainingAfterEur: Math.round(eurcRemainingAfterEur * 100) / 100,
    estimatedNewAvgCost: newAvgCost !== null ? Math.round(newAvgCost * 100) / 100 : null,
    triggerReason,
  };

  return { ...base, isTriggered: true, triggeredReason: triggerReason, notTriggeredReason: null, preview };
}

export function evaluateRebuyTiersExtended(
  tiers: RebuyTierExtended[],
  prices: Record<string, number | null>,
  availableLiquidityEur: number,
  balances: Record<string, number> = {},
  avgCosts: Record<string, number | null> = {},
  now = Date.now()
): RebuyEvaluationResult[] {
  return tiers
    .sort((a, b) => (b.drawdownPercentage - a.drawdownPercentage) || (a.priority - b.priority))
    .map(tier => {
      const price = tier.assetId ? (prices[tier.assetId] ?? null) : null;
      const balance = tier.assetId ? (balances[tier.assetId] ?? 0) : 0;
      const avgCost = tier.assetId ? (avgCosts[tier.assetId] ?? null) : null;
      return evaluateRebuyTierExtended(tier, price, availableLiquidityEur, balance, avgCost, now);
    });
}

export function buildPreparedRebuyOperation(result: RebuyEvaluationResult): Record<string, unknown> | null {
  if (!result.isTriggered || !result.preview) return null;
  const { tier, preview } = result;
  return {
    type: "prepared_rebuy",
    assetId: tier.assetId,
    cycleId: tier.cycleId,
    tierId: tier.id,
    tierName: tier.name,
    originType: "eurc",
    proposedAmountEur: preview.proposedAmountEur,
    estimatedQuantity: preview.estimatedQuantity,
    currentPriceEur: preview.currentPriceEur,
    referencePrice: preview.referencePrice,
    referenceType: preview.referenceType,
    actualDrawdownPct: preview.actualDrawdownPct,
    eurcRemainingAfterEur: preview.eurcRemainingAfterEur,
    estimatedNewAvgCost: preview.estimatedNewAvgCost,
    triggerReason: preview.triggerReason,
    preparedAt: Date.now(),
    status: "preparada",
  };
}
