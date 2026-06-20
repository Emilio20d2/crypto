import type { SnapshotRebuyTier, ProjectionEvent, ProjectionLot } from "./types";

export interface RebuySimulationResult {
  tierId: string;
  assetId: string;
  triggered: boolean;
  drawdownPct: number;
  eurcConsumedEur: number;
  quantityBought: number;
  priceEur: number;
  newLot: ProjectionLot | null;
  event: ProjectionEvent | null;
  notTriggeredReason?: string;
}

function computeDrawdown(refPrice: number, currentPrice: number): number {
  if (refPrice <= 0) return 0;
  return ((refPrice - currentPrice) / refPrice) * 100;
}

export function simulateRebuyTiers(
  cycleId: string,
  periodDate: number,
  tiers: SnapshotRebuyTier[],
  prices: Record<string, number | null>,
  eurcAvailableEur: number,
  usedTierIdsThisPeriod: Set<string>,
  lotCounter: { next: () => string },
): RebuySimulationResult[] {
  const results: RebuySimulationResult[] = [];

  if (eurcAvailableEur <= 0) return results;

  const activeTiers = tiers
    .filter(t => t.status === "activa" && t.cycleId === cycleId)
    .filter(t => !usedTierIdsThisPeriod.has(t.id))
    .sort((a, b) => (a.drawdownPercentage - b.drawdownPercentage) || (a.priority - b.priority));

  let remainingEurc = eurcAvailableEur;

  for (const tier of activeTiers) {
    if (remainingEurc <= 0) break;
    if (!tier.assetId) continue;

    const price = prices[tier.assetId] ?? null;
    const refPrice = tier.referenceValue;

    if (price == null || price <= 0) {
      results.push({ tierId: tier.id, assetId: tier.assetId ?? "", triggered: false, drawdownPct: 0, eurcConsumedEur: 0, quantityBought: 0, priceEur: 0, newLot: null, event: null, notTriggeredReason: "Sin precio disponible" });
      continue;
    }

    if (refPrice == null || refPrice <= 0) {
      results.push({ tierId: tier.id, assetId: tier.assetId, triggered: false, drawdownPct: 0, eurcConsumedEur: 0, quantityBought: 0, priceEur: price, newLot: null, event: null, notTriggeredReason: "Sin precio de referencia configurado" });
      continue;
    }

    const drawdownPct = computeDrawdown(refPrice, price);

    if (drawdownPct < tier.drawdownPercentage) {
      results.push({ tierId: tier.id, assetId: tier.assetId, triggered: false, drawdownPct, eurcConsumedEur: 0, quantityBought: 0, priceEur: price, newLot: null, event: null, notTriggeredReason: `Caída ${drawdownPct.toFixed(1)}% < umbral ${tier.drawdownPercentage}%` });
      continue;
    }

    if (tier.usagePercentage <= 0 || tier.usagePercentage >= 100) {
      results.push({ tierId: tier.id, assetId: tier.assetId, triggered: false, drawdownPct, eurcConsumedEur: 0, quantityBought: 0, priceEur: price, newLot: null, event: null, notTriggeredReason: `Porcentaje de EURC inválido: ${tier.usagePercentage}%` });
      continue;
    }

    const eurcToUse = Math.min(remainingEurc, remainingEurc * (tier.usagePercentage / 100));
    if (eurcToUse <= 0) continue;

    const quantityBought = eurcToUse / price;
    const lot: ProjectionLot = {
      lotId: lotCounter.next(),
      assetId: tier.assetId,
      acquiredAt: periodDate,
      quantity: quantityBought,
      costPerUnitEur: price,
      remaining: quantityBought,
      source: "projection_rebuy",
    };

    results.push({
      tierId: tier.id,
      assetId: tier.assetId,
      triggered: true,
      drawdownPct,
      eurcConsumedEur: eurcToUse,
      quantityBought,
      priceEur: price,
      newLot: lot,
      event: {
        date: periodDate,
        type: "rebuy",
        cycleId,
        assetId: tier.assetId,
        amountEur: eurcToUse,
        quantity: quantityBought,
        priceEur: price,
        description: `Recompra EURC: ${eurcToUse.toFixed(2)} € → ${tier.assetId} (caída ${drawdownPct.toFixed(1)}%)`,
      },
    });

    remainingEurc -= eurcToUse;
    usedTierIdsThisPeriod.add(tier.id);
  }

  return results;
}
