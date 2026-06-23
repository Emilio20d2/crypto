import { computeTaxOnGain } from "./tax-simulator";
import type { SnapshotSaleRule, ProjectionEvent, ProjectionLot, FiscalConfig, HypotheticalSaleProposal } from "./types";

export interface SaleSimulationResult {
  ruleId: string;
  assetId: string;
  triggered: boolean;
  quantitySold: number;
  grossEur: number;
  gainEur: number;
  taxEur: number;
  fiscalReserveEur: number;
  netEurcEur: number;
  event: ProjectionEvent | null;
  lotsConsumed: Array<{ lotId: string; quantity: number; costPerUnitEur: number }>;
}

// Evaluate a sale rule against current price and position.
// Returns whether the rule would trigger at this price.
function ruleConditionMet(
  rule: SnapshotSaleRule,
  currentPriceEur: number,
  avgCostEur: number | null,
): boolean {
  switch (rule.conditionType) {
    case "price_target":
      return rule.conditionValue != null && currentPriceEur >= rule.conditionValue;
    case "cost_multiple":
      return (
        rule.conditionValue != null &&
        avgCostEur != null &&
        avgCostEur > 0 &&
        currentPriceEur >= avgCostEur * rule.conditionValue
      );
    case "gain_percentage":
      return (
        rule.conditionValue != null &&
        avgCostEur != null &&
        avgCostEur > 0 &&
        ((currentPriceEur - avgCostEur) / avgCostEur) * 100 >= rule.conditionValue
      );
    case "euphoria":
      return false; // Not evaluable without live market data
    default:
      return false;
  }
}

function compareSaleRules(a: SnapshotSaleRule, b: SnapshotSaleRule): number {
  if (a.assetId === b.assetId && a.conditionType === b.conditionType) {
    const aThreshold = a.conditionValue ?? Number.POSITIVE_INFINITY;
    const bThreshold = b.conditionValue ?? Number.POSITIVE_INFINITY;
    if (aThreshold !== bThreshold) return aThreshold - bThreshold;
  }
  return a.priority - b.priority;
}

export function simulateSaleRules(
  cycleId: string,
  periodDate: number,
  rules: SnapshotSaleRule[],
  balances: Record<string, number>,
  avgCosts: Record<string, number | null>,
  prices: Record<string, number | null>,
  fifoLots: ProjectionLot[],
  fiscalConfig: FiscalConfig,
  triggeredRuleIds: Set<string>,
): SaleSimulationResult[] {
  const results: SaleSimulationResult[] = [];
  const workingBalances: Record<string, number> = { ...balances };
  const workingLotRemaining = new Map(fifoLots.map(lot => [lot.lotId, lot.remaining]));

  const activeRules = rules
    .filter(r => r.status === "activa" && r.cycleId === cycleId)
    .filter(r => !triggeredRuleIds.has(r.id))
    .sort(compareSaleRules);

  for (const rule of activeRules) {
    const balance = workingBalances[rule.assetId] ?? 0;
    const price = prices[rule.assetId] ?? null;
    const avgCost = avgCosts[rule.assetId] ?? null;

    if (balance <= 0 || price == null || price <= 0) {
      results.push({ ruleId: rule.id, assetId: rule.assetId, triggered: false, quantitySold: 0, grossEur: 0, gainEur: 0, taxEur: 0, fiscalReserveEur: 0, netEurcEur: 0, event: null, lotsConsumed: [] });
      continue;
    }

    if (!ruleConditionMet(rule, price, avgCost)) {
      results.push({ ruleId: rule.id, assetId: rule.assetId, triggered: false, quantitySold: 0, grossEur: 0, gainEur: 0, taxEur: 0, fiscalReserveEur: 0, netEurcEur: 0, event: null, lotsConsumed: [] });
      continue;
    }

    if (rule.sellPercentage <= 0 || rule.sellPercentage >= 100) {
      results.push({ ruleId: rule.id, assetId: rule.assetId, triggered: false, quantitySold: 0, grossEur: 0, gainEur: 0, taxEur: 0, fiscalReserveEur: 0, netEurcEur: 0, event: null, lotsConsumed: [] });
      continue;
    }

    const sellPct = rule.sellPercentage / 100;
    const quantitySold = balance * sellPct;
    const remainingBalance = balance - quantitySold;
    if (remainingBalance <= 0) {
      results.push({ ruleId: rule.id, assetId: rule.assetId, triggered: false, quantitySold: 0, grossEur: 0, gainEur: 0, taxEur: 0, fiscalReserveEur: 0, netEurcEur: 0, event: null, lotsConsumed: [] });
      continue;
    }
    const grossEur = quantitySold * price;

    // FIFO: consume lots in order for this asset
    const assetLots = fifoLots
      .filter(l => l.assetId === rule.assetId && (workingLotRemaining.get(l.lotId) ?? 0) > 0)
      .sort((a, b) => a.acquiredAt - b.acquiredAt);

    let toSell = quantitySold;
    let costBasis = 0;
    const lotsConsumed: Array<{ lotId: string; quantity: number; costPerUnitEur: number }> = [];

    for (const lot of assetLots) {
      if (toSell <= 0) break;
      const lotRemaining = workingLotRemaining.get(lot.lotId) ?? 0;
      const fromLot = Math.min(toSell, lotRemaining);
      costBasis += fromLot * lot.costPerUnitEur;
      lotsConsumed.push({ lotId: lot.lotId, quantity: fromLot, costPerUnitEur: lot.costPerUnitEur });
      workingLotRemaining.set(lot.lotId, Math.max(0, lotRemaining - fromLot));
      toSell -= fromLot;
    }

    // If no FIFO lots (historical position), fall back to avgCost
    if (lotsConsumed.length === 0 && avgCost != null) {
      costBasis = quantitySold * avgCost;
    }

    const gainEur = Math.max(0, grossEur - costBasis);
    const taxEur = computeTaxOnGain(gainEur, fiscalConfig);
    const netEurcEur = Math.max(0, grossEur - taxEur);
    workingBalances[rule.assetId] = remainingBalance;

    results.push({
      ruleId: rule.id,
      assetId: rule.assetId,
      triggered: true,
      quantitySold,
      grossEur: Math.round(grossEur * 100) / 100,
      gainEur: Math.round(gainEur * 100) / 100,
      taxEur: Math.round(taxEur * 100) / 100,
      fiscalReserveEur: Math.round(taxEur * 100) / 100,
      netEurcEur: Math.round(netEurcEur * 100) / 100,
      lotsConsumed,
      event: {
        date: periodDate,
        type: "partial_sale",
        cycleId,
        assetId: rule.assetId,
        amountEur: grossEur,
        quantity: quantitySold,
        priceEur: price,
        gainEur,
        taxEur,
        description: `Venta parcial ${rule.sellPercentage}% de ${rule.assetId} — ${rule.name}`,
      },
    });
  }

  return results;
}

// ── Prudent auto-proposals (no user-configured rules) ────────────────────────
//
// Triggered once per (assetId × tier) across the whole simulation.
// Tiers: +50% → sell 10%, +100% → sell 15%, +200% → sell 20%.
// Never sells 100%; leaves residual balance > 0.

interface ProposalTier {
  key: string;       // "BTC-gain50"
  gainPct: number;   // threshold in %
  sellPct: number;   // fraction to sell (0..1)
  label: string;
}

const PROPOSAL_TIERS: Omit<ProposalTier, "key">[] = [
  { gainPct: 200, sellPct: 0.20, label: "Ganancia +200%" },
  { gainPct: 100, sellPct: 0.15, label: "Ganancia +100%" },
  { gainPct:  50, sellPct: 0.10, label: "Ganancia +50%"  },
];

export function simulateProposedSales(
  cycleId: string,
  periodDate: number,
  scenario: string,
  planId: string,
  balances: Record<string, number>,
  avgCosts: Record<string, number | null>,
  prices: Record<string, number | null>,
  fifoLots: ProjectionLot[],
  fiscalConfig: FiscalConfig,
  triggeredProposalKeys: Set<string>,
): { results: SaleSimulationResult[]; proposals: HypotheticalSaleProposal[] } {
  const results: SaleSimulationResult[] = [];
  const proposals: HypotheticalSaleProposal[] = [];
  const workingBalances: Record<string, number> = { ...balances };
  const workingLotRemaining = new Map(fifoLots.map(l => [l.lotId, l.remaining]));

  for (const [assetId, balance] of Object.entries(workingBalances)) {
    if (balance <= 0) continue;
    const price = prices[assetId] ?? null;
    const avgCost = avgCosts[assetId] ?? null;
    if (price == null || price <= 0 || avgCost == null || avgCost <= 0) continue;

    const gainPct = ((price - avgCost) / avgCost) * 100;

    // Check tiers from highest to lowest (so each fires at most once)
    for (const tier of PROPOSAL_TIERS) {
      const key = `${assetId}-gain${tier.gainPct}`;
      if (triggeredProposalKeys.has(key)) continue;
      if (gainPct < tier.gainPct) continue;

      const currentBal = workingBalances[assetId] ?? 0;
      if (currentBal <= 0) break;

      const quantitySold = currentBal * tier.sellPct;
      const remainingBalance = currentBal - quantitySold;
      if (remainingBalance <= 0) continue; // never sell everything

      const grossEur = quantitySold * price;

      // FIFO cost basis
      const assetLots = fifoLots
        .filter(l => l.assetId === assetId && (workingLotRemaining.get(l.lotId) ?? 0) > 0)
        .sort((a, b) => a.acquiredAt - b.acquiredAt);

      let toSell = quantitySold;
      let costBasis = 0;
      const lotsConsumed: Array<{ lotId: string; quantity: number; costPerUnitEur: number }> = [];
      for (const lot of assetLots) {
        if (toSell <= 0) break;
        const rem = workingLotRemaining.get(lot.lotId) ?? 0;
        const fromLot = Math.min(toSell, rem);
        costBasis += fromLot * lot.costPerUnitEur;
        lotsConsumed.push({ lotId: lot.lotId, quantity: fromLot, costPerUnitEur: lot.costPerUnitEur });
        workingLotRemaining.set(lot.lotId, rem - fromLot);
        toSell -= fromLot;
      }
      if (lotsConsumed.length === 0) costBasis = quantitySold * avgCost;

      const gainEur = Math.max(0, grossEur - costBasis);
      const taxEur  = computeTaxOnGain(gainEur, fiscalConfig);
      const netEurcEur = Math.max(0, grossEur - taxEur);

      workingBalances[assetId] = remainingBalance;
      triggeredProposalKeys.add(key);

      const triggerFactors = [
        `Ganancia ${gainPct.toFixed(0)}% ≥ umbral +${tier.gainPct}%`,
        "Propuesta prudente simulada",
        "Sin reglas explícitas configuradas",
      ];

      const event: ProjectionEvent = {
        date: periodDate,
        type: "partial_sale",
        cycleId,
        assetId,
        amountEur: grossEur,
        quantity: quantitySold,
        priceEur: price,
        gainEur,
        taxEur,
        description: `[Propuesta hipotética] Venta ${(tier.sellPct * 100).toFixed(0)}% ${assetId} — ${tier.label}`,
      };

      results.push({
        ruleId: key,
        assetId,
        triggered: true,
        quantitySold,
        grossEur: Math.round(grossEur * 100) / 100,
        gainEur: Math.round(gainEur * 100) / 100,
        taxEur: Math.round(taxEur * 100) / 100,
        fiscalReserveEur: Math.round(taxEur * 100) / 100,
        netEurcEur: Math.round(netEurcEur * 100) / 100,
        lotsConsumed,
        event,
      });

      proposals.push({
        id: `prop-sale-${key}-${periodDate}`,
        date: periodDate,
        scenario,
        planId,
        cycleId,
        assetId,
        proposalType: "hypothetical_sale",
        sourceType: "simulated_consensus",
        triggerFactors,
        priceEur: price,
        avgCostEur: avgCost,
        unrealizedGainPercentage: gainPct,
        consensusTargetEur: null,
        consensusSourceCount: 0,
        consensusConfidence: 0.4,
        marketPhase: gainPct >= 200 ? "euforia" : gainPct >= 100 ? "expansion" : "alcista",
        riskLevel: gainPct >= 200 ? "alto" : "medio",
        sellPercentage: tier.sellPct * 100,
        quantityBefore: currentBal,
        quantitySold,
        quantityRemaining: remainingBalance,
        grossEur: Math.round(grossEur * 100) / 100,
        feeEur: 0,
        costBasisEur: Math.round(costBasis * 100) / 100,
        realizedGainEur: Math.round(gainEur * 100) / 100,
        taxEur: Math.round(taxEur * 100) / 100,
        fiscalReserveEur: Math.round(taxEur * 100) / 100,
        freeEurcEur: Math.round(netEurcEur * 100) / 100,
        explanation: `${tier.label}: ${gainPct.toFixed(0)}% ganancia → vender ${(tier.sellPct*100).toFixed(0)}% de la posición restante. Propuesta hipotética simulada sin fuentes reales.`,
        sources: [],
      });

      break; // one tier per asset per month
    }
  }

  return { results, proposals };
}

// Compute sales zero-explanation: max gain reached vs first threshold
export function buildSalesZeroExplanation(
  balances: Record<string, number>,
  avgCosts: Record<string, number | null>,
  finalPrices: Record<string, number | null>,
): string {
  let maxGain = -Infinity;
  let maxAsset = "";
  for (const [assetId, bal] of Object.entries(balances)) {
    if (bal <= 0) continue;
    const price = finalPrices[assetId] ?? null;
    const cost  = avgCosts[assetId] ?? null;
    if (price == null || cost == null || cost <= 0) continue;
    const g = ((price - cost) / cost) * 100;
    if (g > maxGain) { maxGain = g; maxAsset = assetId; }
  }
  if (maxAsset === "") return "Sin posiciones con precio y coste disponibles.";
  const firstThreshold = 50;
  if (maxGain >= firstThreshold) return `Umbral alcanzado pero propuestas ya activadas en un mes anterior.`;
  return `No se activaron ventas. Ganancia máxima alcanzada: +${maxGain.toFixed(0)}% en ${maxAsset}. Primera propuesta prudente: +${firstThreshold}%.`;
}
