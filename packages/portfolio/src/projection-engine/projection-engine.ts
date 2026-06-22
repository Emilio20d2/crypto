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
import { simulateSaleRules, simulateProposedSales, buildSalesZeroExplanation } from "./sale-simulator";
import { simulateRebuyTiers, simulateProposedRebuys, buildRebuysZeroExplanation } from "./rebuy-simulator";
import type { HypotheticalSaleProposal, HypotheticalRebuyProposal, SimulationPolicy } from "./types";
import { reconcileProjection, validateProjectionOutput } from "./projection-validation";
import { xirrFromPeriods, twrFromPeriods, computeControlScenario } from "./financial-math";
import { simulateResidualReinvestment } from "./residual-reinvestment";

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

function isCycleProjectable(cycle: SnapshotCycle, date: number): boolean {
  return (
    (cycle.status === "active" || cycle.status === "planned") &&
    cycle.startDate <= date &&
    (cycle.endDate == null || cycle.endDate > date)
  );
}

// Determine every cycle that contributes at a given date. Different plans may
// intentionally overlap; each projectable cycle contributes once per month.
function activeCycles(cycles: SnapshotCycle[], date: number): SnapshotCycle[] {
  return [...cycles]
    .filter(cycle => isCycleProjectable(cycle, date))
    .sort((a, b) => a.startDate - b.startDate || a.id.localeCompare(b.id));
}

function sameMonth(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function yearsBetween(start: number, end: number): number {
  return Math.max((end - start) / (365.25 * 24 * 3600 * 1000), 1 / 12);
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
    simulationPolicy = "confirmed_plus_proposals",
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

  // Proposal-mode state (persisted across all months)
  const triggeredProposalSaleKeys = new Set<string>();
  const usedProposalRebuyKeys = new Set<string>();
  const lastSalePriceByAsset: Record<string, number> = {};
  const allHypotheticalSales: HypotheticalSaleProposal[] = [];
  const allHypotheticalRebuys: HypotheticalRebuyProposal[] = [];
  const planId = snapshot.planId ?? "unknown";
  const appliedRevisionIds = new Set<string>();

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

  // ── Asset lifecycle tracking ────────────────────────────────────────────────
  // Track peak prices to detect deterioration and failure per spec §7-9
  const peakPrices: Record<string, number> = {};
  const failedAssets = new Set<string>();      // assets written off (value = 0)
  const deterioratedAssets = new Set<string>(); // assets with >80% drawdown (stop buying)

  for (const [assetId, p] of Object.entries(snapshot.prices)) {
    if (p != null && p > 0) peakPrices[assetId] = p;
  }

  // ── Period-level accumulations ──────────────────────────────────────────────

  const periods: ProjectionPeriod[] = [];
  const allEvents: ProjectionEvent[] = [];
  let futureCapitalEur = 0;
  let totalRealizedGainEur = 0;
  let totalSalesEur = 0;
  let totalRebuysEur = 0;
  let totalTaxGeneratedEur = 0;
  let cumulativeTaxPaid = 0;
  let totalEurcGeneratedEur = 0;
  let totalEurcReinvestedEur = 0;
  let totalLossesEur = 0;
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

  // Mutable copy of cycle assets — modified by substitutions as they become effective
  const mutableCycleAssets: Record<string, SnapshotCycleAsset[]> = {};
  for (const cycle of snapshot.cycles) {
    mutableCycleAssets[cycle.id] = cycle.assets.map(a => ({ ...a }));
  }

  // ── Month-by-month simulation ───────────────────────────────────────────────

  let currentDate = startOfMonth(projectionStartDate);

  while (currentDate <= effectiveHorizon) {
    const currentCycles = activeCycles(snapshot.cycles, currentDate).map(cycle => ({
      ...cycle,
      assets: mutableCycleAssets[cycle.id] ?? cycle.assets,
    }));
    const periodCycleId = currentCycles.length > 0
      ? currentCycles.map(cycle => cycle.id).join("+")
      : snapshot.cycles[snapshot.cycles.length - 1]?.id ?? "none";
    const periodEvents: ProjectionEvent[] = [];

    // Project prices forward
    for (const [assetId, basePrice] of Object.entries(snapshot.prices)) {
      if (basePrice != null && basePrice > 0) {
        prices[assetId] = projectAssetPrice(basePrice, assetId, projectionStartDate, currentDate, scenarioHypotheses);
      }
    }

    // --- Asset lifecycle evaluation (spec §7-9) ---
    // Update peak prices and detect deterioration/failure
    for (const [assetId, price] of Object.entries(prices)) {
      if (price == null || failedAssets.has(assetId)) continue;
      if (price > (peakPrices[assetId] ?? 0)) peakPrices[assetId] = price;
      const peak = peakPrices[assetId] ?? price;
      if (peak > 0) {
        const drawdownFromPeak = (peak - price) / peak;
        if (drawdownFromPeak >= 0.95) {
          // Asset "failed": write off balance to 0, record loss
          if (!failedAssets.has(assetId)) {
            failedAssets.add(assetId);
            deterioratedAssets.add(assetId);
            const lostValue = (balances[assetId] ?? 0) * price;
            if (lostValue > 0) {
              totalLossesEur += lostValue;
              const lossEvt: ProjectionEvent = {
                date: currentDate, type: "sale" as const, cycleId: periodCycleId, assetId,
                description: `Activo fallido (caída >95% desde máximo): pérdida de ${lostValue.toFixed(0)}€`,
                priceEur: price,
              };
              periodEvents.push(lossEvt);
            }
            balances[assetId] = 0;
          }
        } else if (drawdownFromPeak >= 0.80) {
          deterioratedAssets.add(assetId); // stop new purchases
        } else {
          deterioratedAssets.delete(assetId); // recovery
        }
      }
    }

    const usedTierIds = new Set<string>();

    for (const cycle of currentCycles) {
      const cycleId = cycle.id;

      // --- Apply substitutions that become effective this month ---
      for (const sub of snapshot.substitutions) {
        if (sub.cycleId !== cycleId || sub.effectiveDate > currentDate) continue;
        const cycleAssets = mutableCycleAssets[cycleId];
        if (!cycleAssets) continue;
        const fromAsset = cycleAssets.find(a => a.assetId === sub.fromAssetId);
        if (fromAsset && fromAsset.status !== "retired") {
          fromAsset.status = "retired";
          if (sub.toAssetId && !cycleAssets.find(a => a.assetId === sub.toAssetId)) {
            const fromAlloc = fromAsset.allocationPercentage ?? fromAsset.allocationValue ?? 0;
            cycleAssets.push({
              id: `${sub.id}-new`,
              assetId: sub.toAssetId,
              cycleId: sub.cycleId,
              status: "active",
              allocationPercentage: sub.transferMode === "full" ? fromAlloc : null,
              allocationValue: null,
              allocationType: "percentage",
              priority: fromAsset.priority,
              targetAmount: null,
              targetValueEur: null,
              targetPortfolioPercentage: null,
              goalReachedAt: null,
              startDate: sub.effectiveDate,
              endDate: null,
            });
          }
          periodEvents.push({
            date: currentDate,
            type: "substitution" as const,
            cycleId,
            assetId: sub.fromAssetId,
            description: sub.toAssetId
              ? `Sustitución: ${sub.fromAssetId} → ${sub.toAssetId}`
              : `Retirada de activo: ${sub.fromAssetId}`,
          });
        }
      }

      // --- Apply strategy revisions that become effective this month ---
      for (const rev of snapshot.strategyRevisions ?? []) {
        if (rev.cycleId !== cycleId || rev.effectiveDate > currentDate) continue;
        if (appliedRevisionIds.has(rev.id)) continue;
        appliedRevisionIds.add(rev.id);
        try {
          const changes = JSON.parse(rev.changesJson) as {
            assets?: Record<string, number>;
            monthlyAmount?: number;
          };
          const cycleAssets = mutableCycleAssets[cycleId];
          if (changes.assets && cycleAssets) {
            for (const [assetId, newPct] of Object.entries(changes.assets)) {
              const asset = cycleAssets.find(a => a.assetId === assetId);
              if (asset) asset.allocationPercentage = newPct;
            }
          }
          periodEvents.push({
            date: currentDate,
            type: "redistribution" as const,
            cycleId,
            description: `Revisión de estrategia: ${rev.title}`,
          });
        } catch { /* malformed JSON — skip silently */ }
      }

      // --- Sale rules ---
      const saleResults = simulateSaleRules(
        cycleId, currentDate,
        snapshot.saleRules,
        balances, avgCosts, prices,
        fifoLots, fiscalConfig,
        triggeredSaleRuleIds,
      );

      const processSaleResults = (saleResultsToProcess: typeof saleResults) => {
        for (const sr of saleResultsToProcess.filter(r => r.triggered)) {
          initAsset(sr.assetId);
          balances[sr.assetId] = Math.max(0, (balances[sr.assetId] ?? 0) - sr.quantitySold);

          for (const lc of sr.lotsConsumed) {
            const lot = fifoLots.find(l => l.lotId === lc.lotId);
            if (lot) lot.remaining = Math.max(0, lot.remaining - lc.quantity);
          }

          treasury = addSaleProceeds(treasury, sr.grossEur, sr.taxEur);
          assetSold[sr.assetId] = (assetSold[sr.assetId] ?? 0) + sr.quantitySold;
          assetSalesProceeds[sr.assetId] = (assetSalesProceeds[sr.assetId] ?? 0) + sr.grossEur;
          assetRealizedGain[sr.assetId] = (assetRealizedGain[sr.assetId] ?? 0) + sr.gainEur;
          if (sr.event) assetEvents[sr.assetId].push(sr.event);
          if (sr.event) periodEvents.push(sr.event);
          totalRealizedGainEur += sr.gainEur;
          totalSalesEur += sr.grossEur;
          totalTaxGeneratedEur += sr.taxEur;
          if (sr.event?.priceEur) lastSalePriceByAsset[sr.assetId] = sr.event.priceEur;

          totalEurcGeneratedEur += sr.netEurcEur;
          const cr = cycleResultsMap.get(cycleId);
          if (cr) {
            cr.salesEur += sr.grossEur;
            cr.taxGeneratedEur += sr.taxEur;
            cr.eurcGeneratedEur += sr.netEurcEur;
            if (sr.event) cr.events.push(sr.event);
          }
        }
      };

      processSaleResults(saleResults);
      triggeredSaleRuleIds.clear();
      for (const sr of saleResults.filter(r => r.triggered)) triggeredSaleRuleIds.add(sr.ruleId);

      // Proposal-mode sales (when no explicit active rules and policy allows)
      if (simulationPolicy !== "plan_base" && simulationPolicy !== "confirmed_only") {
        const hasActiveRules = snapshot.saleRules.some(r => r.status === "activa" && r.cycleId === cycleId);
        if (!hasActiveRules) {
          const { results: proposedSales, proposals: salePropList } = simulateProposedSales(
            cycleId, currentDate, scenario, planId,
            balances, avgCosts, prices, fifoLots, fiscalConfig,
            triggeredProposalSaleKeys,
          );
          processSaleResults(proposedSales);
          allHypotheticalSales.push(...salePropList);
        }
      }

      // --- Rebuy tiers ---
      const processRebuyResults = (rebuyResultsToProcess: typeof rebuyResults) => {
        for (const rr of rebuyResultsToProcess.filter(r => r.triggered)) {
          initAsset(rr.assetId);
          balances[rr.assetId] = (balances[rr.assetId] ?? 0) + rr.quantityBought;
          treasury = consumeEurcForRebuy(treasury, rr.eurcConsumedEur);

          if (rr.newLot) fifoLots.push(rr.newLot);

          const prevBal = (balances[rr.assetId] ?? 0) - rr.quantityBought;
          const prevCost = avgCosts[rr.assetId] ?? rr.priceEur;
          const newCost =
            (prevBal * prevCost + rr.quantityBought * rr.priceEur) /
            ((balances[rr.assetId] ?? rr.quantityBought) || 1);
          avgCosts[rr.assetId] = newCost;

          assetRebought[rr.assetId] = (assetRebought[rr.assetId] ?? 0) + rr.quantityBought;
          assetCostRebuy[rr.assetId] = (assetCostRebuy[rr.assetId] ?? 0) + rr.eurcConsumedEur;
          if (rr.event) assetEvents[rr.assetId].push(rr.event);
          if (rr.event) periodEvents.push(rr.event);
          totalRebuysEur += rr.eurcConsumedEur;

          const cr = cycleResultsMap.get(cycleId);
          if (cr) {
            cr.rebuysEur += rr.eurcConsumedEur;
            cr.eurcUsedEur += rr.eurcConsumedEur;
            if (rr.event) cr.events.push(rr.event);
          }
        }
      };

      const rebuyResults = simulateRebuyTiers(
        cycleId, currentDate,
        snapshot.rebuyTiers,
        prices,
        eurcAvailable(treasury),
        usedTierIds,
        lotCounter,
      );
      processRebuyResults(rebuyResults);

      // Proposal-mode rebuys (when no explicit active tiers and policy allows)
      if (simulationPolicy !== "plan_base" && simulationPolicy !== "confirmed_only") {
        const hasActiveTiers = snapshot.rebuyTiers.some(t => t.status === "activa" && t.cycleId === cycleId);
        if (!hasActiveTiers) {
          const assetIds = Array.from(new Set([
            ...Object.keys(balances),
            ...Object.keys(lastSalePriceByAsset),
          ]));
          const { results: proposedRebuys, proposals: rebuyPropList } = simulateProposedRebuys(
            cycleId, currentDate, scenario, planId,
            assetIds, prices, eurcAvailable(treasury),
            lastSalePriceByAsset, usedProposalRebuyKeys, lotCounter,
          );
          processRebuyResults(proposedRebuys);
          allHypotheticalRebuys.push(...rebuyPropList);
        }
      }

      // --- Residual EURC reinvestment (spec §1, §2, §4) ---
      // After all rebuys, any remaining EURC must go back into the market.
      // EURC is temporary: it must reach 0 at period close.
      const eurcAfterRebuys = eurcAvailable(treasury);
      if (eurcAfterRebuys >= 0.50) {
        const residualResult = simulateResidualReinvestment(
          eurcAfterRebuys,
          cycle.assets,
          prices,
          balances,
          avgCosts,
          goalReachedAssets,
          failedAssets,
          currentDate,
          lotCounter,
          cycleId,
        );
        if (residualResult.eurSpent > 0) {
          for (const purchase of residualResult.purchases) {
            initAsset(purchase.assetId);
            const prevBal = balances[purchase.assetId] ?? 0;
            const prevCost = avgCosts[purchase.assetId] ?? purchase.priceEur;
            const newBal = prevBal + purchase.quantity;
            const newCost = newBal > 0 ? (prevBal * prevCost + purchase.amountEur) / newBal : purchase.priceEur;
            balances[purchase.assetId] = newBal;
            avgCosts[purchase.assetId] = newCost;
            fifoLots.push(purchase.newLot);
            assetRebought[purchase.assetId] = (assetRebought[purchase.assetId] ?? 0) + purchase.quantity;
            assetCostRebuy[purchase.assetId] = (assetCostRebuy[purchase.assetId] ?? 0) + purchase.amountEur;
          }
          treasury = consumeEurcForRebuy(treasury, residualResult.eurSpent);
          totalRebuysEur += residualResult.eurSpent;
          totalEurcReinvestedEur += residualResult.eurSpent;
          const cr = cycleResultsMap.get(cycleId);
          if (cr) {
            cr.rebuysEur += residualResult.eurSpent;
            cr.eurcUsedEur += residualResult.eurSpent;
          }
        }
      }

      // --- Monthly contribution ---
      // Exclude deteriorated/failed assets from contribution purchases per spec §8
      const healthyAssets = cycle.assets.filter(a =>
        !failedAssets.has(a.assetId) && !deterioratedAssets.has(a.assetId)
      );
      const effectiveAlloc = computeEffectiveAllocation(healthyAssets, goalReachedAssets, currentDate, cycle.monthlyAmountEur);

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

      if (projectExtraordinaryContributions) {
        const scheduled = snapshot.futureContributions.filter(contribution =>
          contribution.cycleId === cycleId &&
          contribution.type === "extraordinaria" &&
          contribution.status === "pendiente" &&
          sameMonth(contribution.plannedDate, currentDate)
        );

        for (const contribution of scheduled) {
          const extraAlloc = contribution.destinationAssetId
            ? { [contribution.destinationAssetId]: 1 }
            : computeEffectiveAllocation(cycle.assets, goalReachedAssets, currentDate, contribution.amountEur);
          const { allocations: extraAllocations, events: extraEvents, totalSpentEur: extraSpent } = simulateMonthlyContribution(
            currentDate, cycleId,
            contribution.amountEur,
            1.0,
            extraAlloc,
            prices,
            lotCounter,
          );

          for (const alloc of extraAllocations) {
            initAsset(alloc.assetId);
            const prevBal = balances[alloc.assetId] ?? 0;
            const prevCost = avgCosts[alloc.assetId] ?? alloc.priceEur;
            const newBal = prevBal + alloc.quantity;
            balances[alloc.assetId] = newBal;
            avgCosts[alloc.assetId] = newBal > 0 ? (prevBal * prevCost + alloc.amountEur) / newBal : alloc.priceEur;
            fifoLots.push({ ...alloc.newLot, source: "projection_contribution" });
            assetBoughtExtraordinary[alloc.assetId] = (assetBoughtExtraordinary[alloc.assetId] ?? 0) + alloc.quantity;
            assetCostContributions[alloc.assetId] = (assetCostContributions[alloc.assetId] ?? 0) + alloc.amountEur;
            const evt = extraEvents.find(e => e.assetId === alloc.assetId);
            if (evt) {
              const extraEvt = { ...evt, type: "extraordinary_contribution" as const, description: `Aportación extraordinaria: ${alloc.amountEur.toFixed(2)} € → ${alloc.assetId}` };
              assetEvents[alloc.assetId].push(extraEvt);
              periodEvents.push(extraEvt);
              const cr = cycleResultsMap.get(cycleId);
              if (cr) cr.events.push(extraEvt);
            }
          }

          futureCapitalEur += extraSpent;
          const cr = cycleResultsMap.get(cycleId);
          if (cr) cr.extraordinaryContributionEur += extraSpent;
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
      cycleId: periodCycleId,
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

  const strategyAssetIds = snapshot.cycles.flatMap(cycle => cycle.assets.map(asset => asset.assetId));
  for (const assetId of new Set([...Object.keys(snapshot.positions), ...Object.keys(balances), ...strategyAssetIds])) {
    initAsset(assetId);
    const initPos = snapshot.positions[assetId];
    const finalPos = lastPeriod?.positions[assetId];
    const strategyAsset = snapshot.cycles
      .flatMap(cycle => cycle.assets)
      .find(asset => asset.assetId === assetId);

    const hyp = scenarioHypotheses.assetRates.find(r => r.assetId === assetId) ?? null;

    const basePrice = snapshot.prices[assetId];
    let trajectory: Array<{ year: number; priceEur: number }> | null = null;
    if (basePrice != null && basePrice > 0 && hyp != null) {
      trajectory = [];
      const startYear = new Date(projectionStartDate).getUTCFullYear();
      const endYear = new Date(effectiveHorizon).getUTCFullYear();
      for (let yr = startYear; yr <= endYear; yr++) {
        const targetDate = new Date(Date.UTC(yr, 11, 31)).getTime();
        const p = projectAssetPrice(basePrice, assetId, projectionStartDate, targetDate, scenarioHypotheses);
        if (p != null) trajectory.push({ year: yr, priceEur: Math.round(p * 100) / 100 });
      }
    }

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
      targetAmount: strategyAsset?.targetAmount ?? null,
      targetValueEur: strategyAsset?.targetValueEur ?? null,
      goalReachedAt: strategyAsset?.goalReachedAt ?? null,
      goalReachedProjectedAt: goalReachedProjectedAt[assetId] ?? null,
      rulesTriggered: snapshot.saleRules.filter(r => r.assetId === assetId && triggeredSaleRuleIds.has(r.id)).map(r => r.id),
      events: assetEvents[assetId] ?? [],
      hypothesis: hyp,
      annualPriceTrajectory: trajectory,
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
  const initialGrossWealthEur = firstPeriod?.grossWealthEur ?? 0;
  const finalNetWealthEur = lastPeriod?.netWealthEur ?? 0;
  const estimatedFeesEur = 0;
  const treasuryInterestEur = 0;
  const estimatedMarketGainEur = Math.round((
    finalNetWealthEur -
    initialGrossWealthEur -
    futureCapitalEur +
    totalTaxGeneratedEur +
    estimatedFeesEur -
    treasuryInterestEur
  ) * 100) / 100;
  // CAGR simple (conservado para compatibilidad; trata todo el capital futuro como si fuera t=0)
  const weightedBaseCapital = Math.max(1, initialGrossWealthEur + futureCapitalEur);
  const projectionYears = yearsBetween(projectionStartDate, effectiveHorizon);
  const weightedAnnualReturn = finalNetWealthEur > 0
    ? Math.pow(finalNetWealthEur / weightedBaseCapital, 1 / projectionYears) - 1
    : null;

  // ── Métricas de rentabilidad correctamente diferenciadas ────────────────────

  // XIRR: tasa interna de retorno personal con flujos reales fechados
  const xirrAnnual = xirrFromPeriods({
    initialGrossWealthEur,
    projectionStartDate,
    periods: periods.map(p => ({ date: p.date, futureCapitalEur: p.futureCapitalEur, grossWealthEur: p.grossWealthEur })),
  });

  // TWR: rentabilidad de la estrategia eliminando el efecto de los flujos externos
  const twrCumulative = twrFromPeriods({
    initialGrossWealthEur,
    periods: periods.map(p => ({ date: p.date, futureCapitalEur: p.futureCapitalEur, grossWealthEur: p.grossWealthEur })),
  });
  const twrAnnual = twrCumulative != null && twrCumulative > 0 && projectionYears > 0
    ? Math.pow(twrCumulative, 1 / projectionYears) - 1
    : null;

  // ROI acumulado simple = (patrimonio final / capital total invertido) − 1
  const totalCapitalInvested = snapshot.historicalCapitalEur + futureCapitalEur;
  const roiAccumulated = totalCapitalInvested > 0 && finalNetWealthEur > 0
    ? finalNetWealthEur / totalCapitalInvested - 1
    : null;

  // Controles independientes: calculadora analítica de anualidad (NO llama a runProjection)
  const controlMonths = periods.length;
  const avgMonthlyContrib = controlMonths > 0 ? futureCapitalEur / controlMonths : 0;
  const controlBaseParams = {
    initialWealthEur: initialGrossWealthEur,
    monthlyContributionEur: avgMonthlyContrib,
    months: controlMonths,
    projectionStartDate,
  };
  const ctrl0 = computeControlScenario({ ...controlBaseParams, annualReturnRate: 0 });
  const ctrl5 = computeControlScenario({ ...controlBaseParams, annualReturnRate: 0.05 });
  const ctrl7 = computeControlScenario({ ...controlBaseParams, annualReturnRate: 0.07 });

  // Zero-value explanations
  const salesZeroExplanation = totalSalesEur === 0
    ? buildSalesZeroExplanation(balances, avgCosts, prices)
    : undefined;
  const rebuysZeroExplanation = totalRebuysEur === 0
    ? buildRebuysZeroExplanation(eurcAvailable(treasury), lastSalePriceByAsset, prices)
    : undefined;

  const reinvestmentRate = totalEurcGeneratedEur > 0
    ? Math.round((totalEurcReinvestedEur / totalEurcGeneratedEur) * 10_000) / 10_000
    : null;

  const summary: ProjectionSummary = {
    scenario,
    horizonDate: effectiveHorizon,
    projectionStartDate,
    initialGrossWealthEur,
    finalGrossWealthEur: lastPeriod?.grossWealthEur ?? 0,
    finalNetWealthEur,
    historicalCapitalEur: snapshot.historicalCapitalEur,
    totalFutureCapitalEur: Math.round(futureCapitalEur * 100) / 100,
    totalCapitalEur: Math.round((snapshot.historicalCapitalEur + futureCapitalEur) * 100) / 100,
    estimatedMarketGainEur,
    treasuryInterestEur,
    estimatedFeesEur,
    weightedAnnualReturn: weightedAnnualReturn != null ? Math.round(weightedAnnualReturn * 10_000) / 10_000 : null,
    xirrAnnual: xirrAnnual != null ? Math.round(xirrAnnual * 100_000) / 100_000 : null,
    twrAnnual: twrAnnual != null ? Math.round(twrAnnual * 100_000) / 100_000 : null,
    roiAccumulated: roiAccumulated != null ? Math.round(roiAccumulated * 100_000) / 100_000 : null,
    controlCeroWealth: ctrl0.finalWealth,
    control5pctWealth: ctrl5.finalWealth,
    control7pctWealth: ctrl7.finalWealth,
    totalRealizedGainEur: Math.round(totalRealizedGainEur * 100) / 100,
    totalUnrealizedGainEur: Math.round(finalUnrealized * 100) / 100,
    totalTaxGeneratedEur: Math.round(totalTaxGeneratedEur * 100) / 100,
    totalTaxPendingEur: lastPeriod?.taxPendingEur ?? 0,
    finalEurcAvailableEur: lastPeriod?.eurcAvailableEur ?? 0,
    finalFiscalReserveEur: lastPeriod?.fiscalReserveEur ?? 0,
    finalCashEur: lastPeriod?.cashEur ?? 0,
    totalEurcGeneratedEur: Math.round(totalEurcGeneratedEur * 100) / 100,
    totalEurcReinvestedEur: Math.round(totalEurcReinvestedEur * 100) / 100,
    reinvestmentRate,
    totalLossesEur: Math.round(totalLossesEur * 100) / 100,
    failedAssets: Array.from(failedAssets),
    probability: scenarioHypotheses.probability,
    confidence: scenarioHypotheses.confidence,
    confidenceFactors,
    nextProjectedEvent: nextEvent,
    simulationPolicy: simulationPolicy as SimulationPolicy,
    salesZeroExplanation,
    rebuysZeroExplanation,
    hypotheticalSales: allHypotheticalSales,
    hypotheticalRebuys: allHypotheticalRebuys,
  };

  // ── Assemble output ─────────────────────────────────────────────────────────

  const output: ProjectionOutput = {
    snapshotId: snapshot.snapshotId,
    projectionStartDate,
    generatedAt: input.now,
    horizonDate: effectiveHorizon,
    scenario,
    scenarioHypotheses,
    summary,
    periods,
    cycleResults: Array.from(cycleResultsMap.values()),
    assetResults,
    reconciliation: { checks: [], allPassed: true, toleranceEur: 1.0 }, // overwritten below
    validation: { valid: true, issues: [] }, // overwritten below
    fifoLots,
    priceSource: "snapshot",
    fiscalVersion: fiscalConfig.version,
    strategyVersion: snapshot.strategyVersion,
    simulationPolicy: simulationPolicy as SimulationPolicy,
    cacheKey: buildCacheKey(input),
  };

  output.reconciliation = reconcileProjection(output);
  output.validation = validateProjectionOutput(output);

  return output;
}
