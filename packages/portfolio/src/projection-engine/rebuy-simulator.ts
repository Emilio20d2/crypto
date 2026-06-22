import type { SnapshotRebuyTier, ProjectionEvent, ProjectionLot, HypotheticalRebuyProposal } from "./types";

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

// ── Prudent auto-rebuy proposals ─────────────────────────────────────────────
//
// Triggered once per (assetId × tier). Reference = last sale price for the asset.
// Tiers: -15%→20% EURC, -25%→30%, -40%→50%.
// Rearmed when price rises above lastSalePrice (new sell → resets keys).

interface RebuyProposalTier {
  drawdownPct: number;
  usagePct: number;
  label: string;
}

const REBUY_PROPOSAL_TIERS: RebuyProposalTier[] = [
  { drawdownPct: 40, usagePct: 50, label: "Caída -40%" },
  { drawdownPct: 25, usagePct: 30, label: "Caída -25%" },
  { drawdownPct: 15, usagePct: 20, label: "Caída -15%" },
];

export function simulateProposedRebuys(
  cycleId: string,
  periodDate: number,
  scenario: string,
  planId: string,
  assetIds: string[],
  prices: Record<string, number | null>,
  eurcAvailableEur: number,
  lastSalePriceByAsset: Record<string, number>,
  usedProposalKeys: Set<string>,
  lotCounter: { next: () => string },
): { results: RebuySimulationResult[]; proposals: HypotheticalRebuyProposal[] } {
  const results: RebuySimulationResult[] = [];
  const proposals: HypotheticalRebuyProposal[] = [];

  if (eurcAvailableEur <= 0) return { results, proposals };

  let remainingEurc = eurcAvailableEur;

  for (const assetId of assetIds) {
    if (remainingEurc <= 0) break;

    const price = prices[assetId] ?? null;
    const refPrice = lastSalePriceByAsset[assetId] ?? null;
    if (price == null || price <= 0 || refPrice == null || refPrice <= 0) continue;

    // Rearme: if price recovered above reference, clear used keys for this asset
    if (price >= refPrice) {
      for (const key of [...usedProposalKeys]) {
        if (key.startsWith(`${assetId}-rebuy`)) usedProposalKeys.delete(key);
      }
      continue;
    }

    const drawdownPct = computeDrawdown(refPrice, price);

    for (const tier of REBUY_PROPOSAL_TIERS) {
      if (remainingEurc <= 0) break;
      const key = `${assetId}-rebuy${tier.drawdownPct}`;
      if (usedProposalKeys.has(key)) continue;
      if (drawdownPct < tier.drawdownPct) continue;

      const eurcToUse = remainingEurc * (tier.usagePct / 100);
      if (eurcToUse <= 0) continue;

      const quantityBought = eurcToUse / price;
      const lot: ProjectionLot = {
        lotId: lotCounter.next(),
        assetId,
        acquiredAt: periodDate,
        quantity: quantityBought,
        costPerUnitEur: price,
        remaining: quantityBought,
        source: "projection_rebuy",
      };

      const triggerFactors = [
        `Caída ${drawdownPct.toFixed(0)}% ≥ umbral ${tier.drawdownPct}%`,
        `EURC libre disponible: ${remainingEurc.toFixed(0)}€`,
        "Propuesta prudente simulada",
      ];

      results.push({
        tierId: key,
        assetId,
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
          assetId,
          amountEur: eurcToUse,
          quantity: quantityBought,
          priceEur: price,
          description: `[Propuesta hipotética] Recompra EURC: ${eurcToUse.toFixed(0)}€ → ${assetId} (${tier.label})`,
        },
      });

      proposals.push({
        id: `prop-rebuy-${key}-${periodDate}`,
        date: periodDate,
        scenario,
        planId,
        cycleId,
        assetId,
        proposalType: "hypothetical_rebuy",
        sourceType: "simulated_consensus",
        relatedSaleId: null,
        triggerFactors,
        referenceType: "sale_price",
        referencePriceEur: refPrice,
        currentPriceEur: price,
        drawdownPercentage: drawdownPct,
        consensusTargetEur: null,
        consensusSourceCount: 0,
        consensusConfidence: 0.4,
        eurcBeforeEur: remainingEurc,
        usagePercentage: tier.usagePct,
        eurcUsedEur: eurcToUse,
        eurcRemainingEur: remainingEurc - eurcToUse,
        quantityBought,
        feeEur: 0,
        averageCostBeforeEur: null,
        averageCostAfterEur: price,
        explanation: `${tier.label}: caída ${drawdownPct.toFixed(0)}% desde precio de venta ${refPrice.toFixed(0)}€ → usar ${tier.usagePct}% del EURC libre. Propuesta hipotética simulada.`,
        sources: [],
      });

      remainingEurc -= eurcToUse;
      usedProposalKeys.add(key);
      break; // one tier per asset per period
    }
  }

  return { results, proposals };
}

export function buildRebuysZeroExplanation(
  eurcAvailableEur: number,
  lastSalePriceByAsset: Record<string, number>,
  prices: Record<string, number | null>,
): string {
  if (eurcAvailableEur <= 0) {
    return "Sin EURC libre disponible para recompras. Las ventas simuladas deben generar EURC primero.";
  }
  const hasSales = Object.keys(lastSalePriceByAsset).length > 0;
  if (!hasSales) {
    return "Sin ventas previas. No existe precio de referencia para calcular caídas.";
  }
  let maxDrawdown = 0;
  for (const [assetId, refPrice] of Object.entries(lastSalePriceByAsset)) {
    const price = prices[assetId] ?? null;
    if (price == null || refPrice <= 0) continue;
    const d = ((refPrice - price) / refPrice) * 100;
    if (d > maxDrawdown) maxDrawdown = d;
  }
  const firstThreshold = 15;
  return `Sin recompras activadas. Caída máxima detectada: ${maxDrawdown.toFixed(0)}%. Primera propuesta prudente: -${firstThreshold}%.`;
}
