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
): Record<string, number> {
  const eligible = cycleAssets.filter(a => {
    if (a.status !== "active") return false;
    if (goalReachedAssets.has(a.assetId)) return false;
    if (a.endDate !== null && a.endDate <= now) return false;
    return true;
  });

  if (eligible.length === 0) return {};

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
