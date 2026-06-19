import type {
  ProjectionInput,
  ProjectionOutput,
  ProjectionPeriod,
  CycleProjectionResult,
  AssetProjectionResult,
  ProjectedAssetPosition,
  ProjectionEvent,
  ProjectionLot,
  SnapshotCycle,
  SnapshotCycleAsset,
  ProjectionSummary,
} from "./types";
import { buildCacheKey } from "./types";
import { initTreasuryState, eurcAvailable, addSaleProceeds, consumeEurcForRebuy } from "./treasury-simulator";
import { projectAssetPrice } from "./asset-simulator";
import { computeEffectiveAllocation, simulateMonthlyContribution, checkGoalReached } from "./contribution-simulator";
import { simulateSaleRules } from "./sale-simulator";
import { simulateRebuyTiers } from "./rebuy-simulator";
import { reconcileProjection, validateProjectionOutput } from "./projection-validation";

const MS_PER_MONTH = (365.25 / 12) * 24 * 3600 * 1000;

function nextMonth(ts: number): number {
  const d = new Date(ts);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// Determine which cycle is active at a given date.
function activeCycle(cycles: SnapshotCycle[], date: number): SnapshotCycle | null {
  return (
    [...cycles]
      .filter(c => (c.status === "active" || c.status === "planned") && c.startDate <= date && (c.endDate == null || c.endDate > date))
      .sort((a, b) => b.startDate - a.startDate)[0] ?? null
  );
}

// Simple lot counter — deterministic sequential IDs.
function makeLotCounter(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-lot-${++n}` };
}

export function runProjection(input: ProjectionInput): ProjectionOutput {
  const { snapshot, projectionStartDate, horizonDate, scenario, scenarioHypotheses, fiscalConfig, options } = input;
  const {
    openCycleHorizonYears = 10,
    complianceRate = 1.0,
    projectExtraordinaryContributions = false,
  } = options;

  const effectiveHorizon = horizonDate > projectionStartDate ? horizonDate
    : projectionStartDate + openCycleHorizonYears * 365.25 * 24 * 3600 * 1000;

  // ── Initialize mutable state from snapshot ──────────────────────────────────

  const balances: Record<string, number> = {};
  const avgCosts: Record<string, number | null> = {};
  const prices: Record<string, number | null> = { ...snapshot.prices };

  for (const [assetId, pos] of Object.entries(snapshot.positions)) {
    balances[assetId] = pos.balance;
    avgCosts[assetId] = pos.avgCostEur;
    if (prices[assetId] == null) prices[assetId] = pos.currentPriceEur;
  }

  let treasury = initTreasuryState(
    snapshot.treasury.cashEur,
    snapshot.treasury.eurcEur,
    snapshot.treasury.fiscalReserveEur,
  );

  // FIFO lots: start from current positions using avg cost as single lot
  const fifoLots: ProjectionLot[] = [];
  for (const [assetId, pos] of Object.entries(snapshot.positions)) {
    if (pos.balance > 0 && pos.avgCostEur != null) {
      fifoLots.push({
        lotId: `hist-${assetId}`,
        assetId,
        acquiredAt: projectionStartDate,
        quantity: pos.balance,
        costPerUnitEur: pos.avgCostEur,
        remaining: pos.balance,
        source: "historical",
      });
    }
  }

  const lotCounter = makeLotCounter(scenario);
  const goalReachedAssets = new Set<string>();
  const goalReachedProjectedAt: Record<string, number> = {};
  const triggeredSaleRuleIds = new Set<string>();

  // Pre-populate goals already reached in snapshot
  for (const cycle of snapshot.cycles) {
    for (const a of cycle.assets) {
      if (a.goalReachedAt !== null) goalReachedAssets.add(a.assetId);
    }
  }

  // ── Accumulators per asset ──────────────────────────────────────────────────

  const assetBoughtContributions: Record<string, number> = {};
  const assetBoughtExtraordinary: Record<string, number> = {};
  const assetSold: Record<string, number> = {};
  const assetRebought: Record<string, number> = {};
  const assetCostContributions: Record<string, number> = {};
  const assetCostRebuy: Record<string, number> = {};
  const assetSalesProceeds: Record<string, number> = {};
  const assetRealizedGain: Record<string, number> = {};
  const assetEvents: Record<string, ProjectionEvent[]> = {};

  function initAsset(assetId: string) {
    if (!(assetId in assetBoughtContributions)) {
      assetBoughtContributions[assetId] = 0;
      assetBoughtExtraordinary[assetId] = 0;
      assetSold[assetId] = 0;
      assetRebought[assetId] = 0;
      assetCostContributions[assetId] = 0;
      assetCostRebuy[assetId] = 0;
      assetSalesProceeds[assetId] = 0;
      assetRealizedGain[assetId] = 0;
      assetEvents[assetId] = [];
    }
  }

  for (const assetId of Object.keys(snapshot.positions)) initAsset(assetId);

  // ── Period-level accumulations ──────────────────────────────────────────────

  const periods: ProjectionPeriod[] = [];
  const allEvents: ProjectionEvent[] = [];
  let futureCapitalEur = 0;
  let totalRealizedGainEur = 0;
  let totalSalesEur = 0;
  let totalRebuysEur = 0;
  let totalTaxGeneratedEur = 0;
  let cumulativeTaxPaid = 0;
  const cycleResultsMap: Map<string, CycleProjectionResult> = new Map();

  // Initialize cycle result accumulators
  for (const cycle of snapshot.cycles) {
    cycleResultsMap.set(cycle.id, {
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      plannedContributionEur: 0,
      simulatedContributionEur: 0,
      extraordinaryContributionEur: 0,
      buysByAsset: {},
      goalReachedAssets: [],
      salesEur: 0,
      rebuysEur: 0,
      taxGeneratedEur: 0,
      eurcGeneratedEur: 0,
      eurcUsedEur: 0,
      startValueEur: 0,
      endValueEur: 0,
      endNetWealthEur: 0,
      effectiveAllocation: {},
      events: [],
    });
  }

  // ── Month-by-month simulation ───────────────────────────────────────────────

  let currentDate = startOfMonth(projectionStartDate);

  while (currentDate <= effectiveHorizon) {
    const cycle = activeCycle(snapshot.cycles, currentDate);
    const cycleId = cycle?.id ?? snapshot.cycles[snapshot.cycles.length - 1]?.id ?? "none";
    const periodEvents: ProjectionEvent[] = [];

    // Project prices forward
    for (const [assetId, basePrice] of Object.entries(snapshot.prices)) {
      if (basePrice != null && basePrice > 0) {
        prices[assetId] = projectAssetPrice(basePrice, assetId, projectionStartDate, currentDate, scenarioHypotheses);
      }
    }

    // --- Sale rules ---
    const saleResults = simulateSaleRules(
      cycleId, currentDate,
      snapshot.saleRules,
      balances, avgCosts, prices,
      fifoLots, fiscalConfig,
      triggeredSaleRuleIds,
    );

    for (const sr of saleResults.filter(r => r.triggered)) {
      initAsset(sr.assetId);
      balances[sr.assetId] = Math.max(0, (balances[sr.assetId] ?? 0) - sr.quantitySold);

      // Consume FIFO lots
      for (const lc of sr.lotsConsumed) {
        const lot = fifoLots.find(l => l.lotId === lc.lotId);
        if (lot) lot.remaining = Math.max(0, lot.remaining - lc.quantity);
      }

      treasury = addSaleProceeds(treasury, sr.grossEur, sr.taxEur);
      assetSold[sr.assetId] = (assetSold[sr.assetId] ?? 0) + sr.quantitySold;
      assetSalesProceeds[sr.assetId] = (assetSalesProceeds[sr.assetId] ?? 0) + sr.grossEur;
      assetRealizedGain[sr.assetId] = (assetRealizedGain[sr.assetId] ?? 0) + sr.gainEur;
      assetEvents[sr.assetId].push(sr.event!);
      periodEvents.push(sr.event!);
      totalRealizedGainEur += sr.gainEur;
      totalSalesEur += sr.grossEur;
      totalTaxGeneratedEur += sr.taxEur;
      triggeredSaleRuleIds.add(sr.ruleId);

      const cr = cycleResultsMap.get(cycleId);
      if (cr) {
        cr.salesEur += sr.grossEur;
        cr.taxGeneratedEur += sr.taxEur;
        cr.eurcGeneratedEur += sr.netEurcEur;
        cr.events.push(sr.event!);
      }
    }

    // --- Rebuy tiers ---
    const usedTierIds = new Set<string>();
    const rebuyResults = simulateRebuyTiers(
      cycleId, currentDate,
      snapshot.rebuyTiers,
      prices,
      eurcAvailable(treasury),
      usedTierIds,
      lotCounter,
    );

    for (const rr of rebuyResults.filter(r => r.triggered)) {
      initAsset(rr.assetId);
      balances[rr.assetId] = (balances[rr.assetId] ?? 0) + rr.quantityBought;
      treasury = consumeEurcForRebuy(treasury, rr.eurcConsumedEur);

      if (rr.newLot) fifoLots.push(rr.newLot);

      // Update avg cost
      const prevBal = (balances[rr.assetId] ?? 0) - rr.quantityBought;
      const prevCost = avgCosts[rr.assetId] ?? rr.priceEur;
      const newCost =
        (prevBal * prevCost + rr.quantityBought * rr.priceEur) /
        ((balances[rr.assetId] ?? rr.quantityBought) || 1);
      avgCosts[rr.assetId] = newCost;

      assetRebought[rr.assetId] = (assetRebought[rr.assetId] ?? 0) + rr.quantityBought;
      assetCostRebuy[rr.assetId] = (assetCostRebuy[rr.assetId] ?? 0) + rr.eurcConsumedEur;
      assetEvents[rr.assetId].push(rr.event!);
      periodEvents.push(rr.event!);
      totalRebuysEur += rr.eurcConsumedEur;

      const cr = cycleResultsMap.get(cycleId);
      if (cr) {
        cr.rebuysEur += rr.eurcConsumedEur;
        cr.eurcUsedEur += rr.eurcConsumedEur;
        cr.events.push(rr.event!);
      }
    }

    // --- Monthly contribution ---
    if (cycle) {
      const effectiveAlloc = computeEffectiveAllocation(cycle.assets, goalReachedAssets, currentDate, cycle.monthlyAmountEur);

      const { allocations, events: contribEvents, totalSpentEur } = simulateMonthlyContribution(
        currentDate, cycleId,
        cycle.monthlyAmountEur * complianceRate,
        1.0, // complianceRate already applied above
        effectiveAlloc,
        prices,
        lotCounter,
      );

      for (const alloc of allocations) {
        initAsset(alloc.assetId);

        // Update balance and avg cost
        const prevBal = balances[alloc.assetId] ?? 0;
        const prevCost = avgCosts[alloc.assetId] ?? alloc.priceEur;
        const newBal = prevBal + alloc.quantity;
        const newCost = newBal > 0 ? (prevBal * prevCost + alloc.amountEur) / newBal : alloc.priceEur;
        balances[alloc.assetId] = newBal;
        avgCosts[alloc.assetId] = newCost;

        fifoLots.push(alloc.newLot);

        assetBoughtContributions[alloc.assetId] = (assetBoughtContributions[alloc.assetId] ?? 0) + alloc.quantity;
        assetCostContributions[alloc.assetId] = (assetCostContributions[alloc.assetId] ?? 0) + alloc.amountEur;
        assetEvents[alloc.assetId].push(contribEvents.find(e => e.assetId === alloc.assetId)!);

        const cr = cycleResultsMap.get(cycleId);
        if (cr) {
          cr.simulatedContributionEur += alloc.amountEur;
          cr.buysByAsset[alloc.assetId] = (cr.buysByAsset[alloc.assetId] ?? 0) + alloc.amountEur;
        }
      }

      futureCapitalEur += totalSpentEur;
      periodEvents.push(...contribEvents);

      const cr = cycleResultsMap.get(cycleId);
      if (cr) cr.plannedContributionEur += cycle.monthlyAmountEur;

      // --- Goal check ---
      const totalPortfolioValue = Object.entries(balances).reduce((s, [aid, bal]) => {
        const p = prices[aid];
        return s + (p != null ? bal * p : 0);
      }, 0);

      for (const asset of cycle.assets) {
        if (goalReachedAssets.has(asset.assetId)) continue;
        const bal = balances[asset.assetId] ?? 0;
        const val = prices[asset.assetId] != null ? bal * prices[asset.assetId]! : null;
        if (checkGoalReached(asset, bal, val, totalPortfolioValue)) {
          goalReachedAssets.add(asset.assetId);
          goalReachedProjectedAt[asset.assetId] = currentDate;
          const goalEvt: ProjectionEvent = {
            date: currentDate, type: "goal_reached", cycleId, assetId: asset.assetId,
            description: `Objetivo alcanzado: ${asset.assetId}`,
          };
          periodEvents.push(goalEvt);
          assetEvents[asset.assetId] = assetEvents[asset.assetId] ?? [];
          assetEvents[asset.assetId].push(goalEvt);

          const cr = cycleResultsMap.get(cycleId);
          if (cr && !cr.goalReachedAssets.includes(asset.assetId)) {
            cr.goalReachedAssets.push(asset.assetId);
            cr.events.push(goalEvt);
          }
        }
      }
    }

    allEvents.push(...periodEvents);

    // --- Compute period snapshot ---
    const portfolioValue = Object.entries(balances).reduce((s, [aid, bal]) => {
      const p = prices[aid];
      return s + (p != null ? bal * p : 0);
    }, 0);

    const positions: Record<string, ProjectedAssetPosition> = {};
    for (const [assetId, bal] of Object.entries(balances)) {
      const p = prices[assetId] ?? null;
      const valEur = p != null ? bal * p : null;
      const avgCost = avgCosts[assetId] ?? null;
      const unrealized = valEur != null && avgCost != null ? valEur - bal * avgCost : null;
      positions[assetId] = { assetId, balance: bal, avgCostEur: avgCost, priceEur: p, valueEur: valEur, unrealizedGainEur: unrealized };
    }

    const grossWealth = portfolioValue + treasury.cashEur + eurcAvailable(treasury) + treasury.fiscalReserveEur;
    const taxCovered = Math.min(treasury.taxPendingEur, treasury.fiscalReserveEur);
    const uncoveredTax = Math.max(0, treasury.taxPendingEur - taxCovered);
    const netWealth = grossWealth - uncoveredTax;

    const unrealizedTotal = Object.values(positions).reduce((s, p) => s + (p.unrealizedGainEur ?? 0), 0);

    periods.push({
      date: currentDate,
      cycleId,
      portfolioValueEur: Math.round(portfolioValue * 100) / 100,
      cashEur: Math.round(treasury.cashEur * 100) / 100,
      eurcAvailableEur: Math.round(eurcAvailable(treasury) * 100) / 100,
      fiscalReserveEur: Math.round(treasury.fiscalReserveEur * 100) / 100,
      grossWealthEur: Math.round(grossWealth * 100) / 100,
      netWealthEur: Math.round(netWealth * 100) / 100,
      historicalCapitalEur: snapshot.historicalCapitalEur,
      futureCapitalEur: Math.round(futureCapitalEur * 100) / 100,
      totalCapitalEur: Math.round((snapshot.historicalCapitalEur + futureCapitalEur) * 100) / 100,
      realizedGainEur: Math.round(totalRealizedGainEur * 100) / 100,
      unrealizedGainEur: Math.round(unrealizedTotal * 100) / 100,
      totalSalesEur: Math.round(totalSalesEur * 100) / 100,
      totalRebuysEur: Math.round(totalRebuysEur * 100) / 100,
      taxGeneratedEur: Math.round(totalTaxGeneratedEur * 100) / 100,
      taxPendingEur: Math.round(treasury.taxPendingEur * 100) / 100,
      taxPaidEur: Math.round(treasury.taxPaidEur * 100) / 100,
      positions,
      events: periodEvents,
    });

    currentDate = nextMonth(currentDate);
  }

  // ── Build asset results ─────────────────────────────────────────────────────

  const assetResults: AssetProjectionResult[] = [];
  const lastPeriod = periods[periods.length - 1];

  for (const assetId of new Set([...Object.keys(snapshot.positions), ...Object.keys(balances)])) {
    initAsset(assetId);
    const initPos = snapshot.positions[assetId];
    const finalPos = lastPeriod?.positions[assetId];

    assetResults.push({
      assetId,
      initialBalance: initPos?.balance ?? 0,
      initialValueEur: initPos?.currentValueEur ?? null,
      initialAvgCostEur: initPos?.avgCostEur ?? null,
      balanceBoughtContributions: assetBoughtContributions[assetId] ?? 0,
      balanceBoughtExtraordinary: assetBoughtExtraordinary[assetId] ?? 0,
      balanceSold: assetSold[assetId] ?? 0,
      balanceRebought: assetRebought[assetId] ?? 0,
      finalBalance: finalPos?.balance ?? balances[assetId] ?? 0,
      costContributionsEur: assetCostContributions[assetId] ?? 0,
      costRebuyEur: assetCostRebuy[assetId] ?? 0,
      salesProceedsEur: assetSalesProceeds[assetId] ?? 0,
      realizedGainEur: assetRealizedGain[assetId] ?? 0,
      finalPriceEur: finalPos?.priceEur ?? null,
      finalValueEur: finalPos?.valueEur ?? null,
      finalAvgCostEur: finalPos?.avgCostEur ?? null,
      unrealizedGainEur: finalPos?.unrealizedGainEur ?? null,
      targetAmount: null,
      targetValueEur: null,
      goalReachedAt: snapshot.cycles.flatMap(c => c.assets).find(a => a.assetId === assetId)?.goalReachedAt ?? null,
      goalReachedProjectedAt: goalReachedProjectedAt[assetId] ?? null,
      rulesTriggered: snapshot.saleRules.filter(r => r.assetId === assetId && triggeredSaleRuleIds.has(r.id)).map(r => r.id),
      events: assetEvents[assetId] ?? [],
    });
  }

  // ── Build summary ───────────────────────────────────────────────────────────

  const firstPeriod = periods[0];
  const nextEvent = allEvents.find(e => e.date > input.now) ?? null;

  const confidenceFactors: string[] = [];
  const missingPrices = snapshot.dataQuality.missingPrices;
  if (missingPrices.length > 0) confidenceFactors.push(`Sin precio: ${missingPrices.join(", ")}`);
  if (!lastPeriod) confidenceFactors.push("Sin periodos proyectados");
  const finalUnrealized = lastPeriod ? Object.values(lastPeriod.positions).reduce((s, p) => s + (p.unrealizedGainEur ?? 0), 0) : 0;

  const summary: ProjectionSummary = {
    scenario,
    horizonDate: effectiveHorizon,
    projectionStartDate,
    initialGrossWealthEur: firstPeriod?.grossWealthEur ?? 0,
    finalGrossWealthEur: lastPeriod?.grossWealthEur ?? 0,
    finalNetWealthEur: lastPeriod?.netWealthEur ?? 0,
    historicalCapitalEur: snapshot.historicalCapitalEur,
    totalFutureCapitalEur: Math.round(futureCapitalEur * 100) / 100,
    totalCapitalEur: Math.round((snapshot.historicalCapitalEur + futureCapitalEur) * 100) / 100,
    totalRealizedGainEur: Math.round(totalRealizedGainEur * 100) / 100,
    totalUnrealizedGainEur: Math.round(finalUnrealized * 100) / 100,
    totalTaxGeneratedEur: Math.round(totalTaxGeneratedEur * 100) / 100,
    totalTaxPendingEur: lastPeriod?.taxPendingEur ?? 0,
    finalEurcAvailableEur: lastPeriod?.eurcAvailableEur ?? 0,
    finalFiscalReserveEur: lastPeriod?.fiscalReserveEur ?? 0,
    finalCashEur: lastPeriod?.cashEur ?? 0,
    probability: scenarioHypotheses.probability,
    confidence: scenarioHypotheses.confidence,
    confidenceFactors,
    nextProjectedEvent: nextEvent,
  };

  // ── Assemble output ─────────────────────────────────────────────────────────

  const output: ProjectionOutput = {
    snapshotId: snapshot.snapshotId,
    projectionStartDate,
    generatedAt: input.now,
    horizonDate: effectiveHorizon,
    scenario,
    summary,
    periods,
    cycleResults: Array.from(cycleResultsMap.values()),
    assetResults,
    reconciliation: { checks: [], allPassed: true, toleranceEur: 1.0 }, // placeholder
    validation: { valid: true, issues: [] }, // placeholder
    fifoLots,
    priceSource: "snapshot",
    fiscalVersion: fiscalConfig.version,
    strategyVersion: snapshot.strategyVersion,
    cacheKey: buildCacheKey(input),
  };

  output.reconciliation = reconcileProjection(output);
  output.validation = validateProjectionOutput(output);

  return output;
}
