import type { SnapshotCycle, SnapshotCycleAsset, ProjectionEvent, ProjectionLot } from "./types";

export interface AllocationResult {
  assetId: string;
  amountEur: number;
  quantity: number;
  priceEur: number;
  newLot: ProjectionLot;
}

// Returns the effective allocation percentages for active (non-goal-reached) assets.
// If all assets have reached their goal, returns empty (no contribution needed).
export function computeEffectiveAllocation(
  cycleAssets: SnapshotCycleAsset[],
  goalReachedAssets: Set<string>,
  now: number,
  monthlyAmountEur?: number,
): Record<string, number> {
  const eligible = cycleAssets.filter(a => {
    if (a.status !== "active") return false;
    if (goalReachedAssets.has(a.assetId)) return false;
    if (a.startDate > now) return false;
    if (a.endDate !== null && a.endDate <= now) return false;
    return true;
  });

  if (eligible.length === 0) return {};

  const monthlyAmount = typeof monthlyAmountEur === "number" && Number.isFinite(monthlyAmountEur) && monthlyAmountEur > 0
    ? monthlyAmountEur
    : null;

  if (monthlyAmount !== null) {
    const allocations: Record<string, number> = {};
    const fixedAssets = eligible.filter(a => a.allocationType === "amount");
    const flexibleAssets = eligible.filter(a => a.allocationType !== "amount");

    let fixedPctTotal = 0;
    for (const asset of fixedAssets) {
      const fixedAmount = asset.allocationValue ?? 0;
      if (fixedAmount <= 0) continue;
      const pct = Math.min(1, fixedAmount / monthlyAmount);
      allocations[asset.assetId] = (allocations[asset.assetId] ?? 0) + pct;
      fixedPctTotal += pct;
    }

    const remainingPct = Math.max(0, 1 - fixedPctTotal);
    if (remainingPct <= 0) return normalizeAllocation(allocations);

    const percentageBasedFlexible = flexibleAssets.filter(a => a.allocationPercentage != null);
    const percentageTotal = percentageBasedFlexible.reduce((s, a) => s + (a.allocationPercentage ?? 0), 0);

    if (percentageTotal > 0) {
      for (const asset of percentageBasedFlexible) {
        allocations[asset.assetId] = (allocations[asset.assetId] ?? 0) + ((asset.allocationPercentage ?? 0) / percentageTotal) * remainingPct;
      }
      return normalizeAllocation(allocations);
    }

    const fallbackAssets = flexibleAssets.length > 0 ? flexibleAssets : eligible;
    const split = remainingPct / fallbackAssets.length;
    for (const asset of fallbackAssets) {
      allocations[asset.assetId] = (allocations[asset.assetId] ?? 0) + split;
    }
    return normalizeAllocation(allocations);
  }

  const percentageBased = eligible.filter(a => a.allocationPercentage != null);
  const total = percentageBased.reduce((s, a) => s + (a.allocationPercentage ?? 0), 0);

  if (total <= 0) {
    // Even split
    const split = 1 / eligible.length;
    return Object.fromEntries(eligible.map(a => [a.assetId, split]));
  }

  return Object.fromEntries(
    percentageBased.map(a => [a.assetId, (a.allocationPercentage ?? 0) / total])
  );
}

function normalizeAllocation(allocations: Record<string, number>): Record<string, number> {
  const entries = Object.entries(allocations).filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([assetId, value]) => [assetId, value / total]));
}

// Simulates a single DCA contribution at a given month.
// Returns how the contribution was allocated and the resulting lot additions.
export function simulateMonthlyContribution(
  monthDate: number,
  cycleId: string,
  monthlyAmountEur: number,
  complianceRate: number,
  effectiveAllocation: Record<string, number>,
  prices: Record<string, number | null>,
  lotCounter: { next: () => string },
): { allocations: AllocationResult[]; events: ProjectionEvent[]; totalSpentEur: number } {
  const effectiveAmount = monthlyAmountEur * Math.min(1, Math.max(0, complianceRate));
  if (effectiveAmount <= 0 || Object.keys(effectiveAllocation).length === 0) {
    return { allocations: [], events: [], totalSpentEur: 0 };
  }

  const allocations: AllocationResult[] = [];
  const events: ProjectionEvent[] = [];
  let totalSpentEur = 0;

  for (const [assetId, pct] of Object.entries(effectiveAllocation)) {
    const amountEur = effectiveAmount * pct;
    if (amountEur <= 0) continue;

    const price = prices[assetId];
    if (!price || price <= 0) continue;

    const quantity = amountEur / price;
    const lot: ProjectionLot = {
      lotId: lotCounter.next(),
      assetId,
      acquiredAt: monthDate,
      quantity,
      costPerUnitEur: price,
      remaining: quantity,
      source: "projection_contribution",
    };

    allocations.push({ assetId, amountEur, quantity, priceEur: price, newLot: lot });
    events.push({
      date: monthDate,
      type: "buy",
      cycleId,
      assetId,
      amountEur,
      quantity,
      priceEur: price,
      description: `Aportación DCA: ${amountEur.toFixed(2)} € → ${assetId}`,
    });
    totalSpentEur += amountEur;
  }

  return { allocations, events, totalSpentEur };
}

// Check if an asset has reached its goal (amount, value, or portfolio %).
export function checkGoalReached(
  asset: SnapshotCycleAsset,
  balance: number,
  valueEur: number | null,
  totalPortfolioValueEur: number | null,
): boolean {
  if (asset.goalReachedAt !== null) return true;

  if (asset.targetAmount != null && balance >= asset.targetAmount) return true;
  if (asset.targetValueEur != null && valueEur != null && valueEur >= asset.targetValueEur) return true;
  if (
    asset.targetPortfolioPercentage != null &&
    totalPortfolioValueEur != null && totalPortfolioValueEur > 0 &&
    valueEur != null &&
    (valueEur / totalPortfolioValueEur) * 100 >= asset.targetPortfolioPercentage
  ) return true;

  return false;
}
