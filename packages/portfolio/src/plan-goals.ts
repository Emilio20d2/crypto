// Domain engine for investment asset goal detection and budget redistribution.
// Pure functions — no I/O, no React, testable in isolation.

export type GoalType = "quantity" | "value" | "portfolio_percentage";

export interface PlanAsset {
  id: string;
  assetId: string;
  cycleId: string;
  allocationType: "percentage" | "amount";
  allocationValue: number;
  allocationPercentage: number | null;
  fixedAmountEur: number | null;
  targetAmount: number | null;
  targetValueEur: number | null;
  targetPortfolioPercentage: number | null;
  startDate: number;
  endDate: number | null;
  status: string;
  isActive: boolean;
}

export interface PositionSnapshot {
  balance: number;
  currentValueEur: number | null;
  currentWeightPct: number | null;
}

export type GoalEvaluationResult =
  | { hasGoal: false }
  | { hasGoal: true; goalType: GoalType; target: number; observedValue: number; reached: boolean; progress: number }
  | { hasGoal: true; goalType: GoalType; target: number; evaluable: false; reason: string };

export interface AllocationChange {
  investmentAssetId: string;
  previousAllocationValue: number;
  previousAllocationPercentage: number | null;
  newAllocationValue: number;
  newAllocationPercentage: number | null;
}

export interface RedistributionRule {
  investmentAssetId: string;
  percentage: number;
}

export interface EffectiveAllocation {
  assets: PlanAsset[];
  totalPct: number;
  totalFixedEur: number;
}

export interface GoalReachedRevisionData {
  type: "goal_reached";
  investmentAssetId: string;
  assetId: string;
  goalType: GoalType;
  observedValue: number;
  releasedAmountEur: number;
  redistributions: Array<{
    investmentAssetId: string;
    previousAllocationValue: number;
    newAllocationValue: number;
  }>;
}

export interface GoalReachedRevisionInput {
  cycleId: string;
  effectiveDate: number;
  title: string;
  notes: string | null;
  changesJson: string;
}

// Evaluate whether an asset's goal has been reached based on a live portfolio snapshot.
export function evaluateAssetGoal(
  asset: PlanAsset,
  position: PositionSnapshot | undefined,
): GoalEvaluationResult {
  if (asset.targetAmount !== null) {
    const target = asset.targetAmount;
    const observedValue = position?.balance ?? 0;
    const progress = target > 0 ? Math.min(1, observedValue / target) : 0;
    return { hasGoal: true, goalType: "quantity", target, observedValue, reached: observedValue >= target, progress };
  }

  if (asset.targetValueEur !== null) {
    const target = asset.targetValueEur;
    if (!position || position.currentValueEur === null) {
      return { hasGoal: true, goalType: "value", target, evaluable: false, reason: "Precio no disponible" };
    }
    const observedValue = position.currentValueEur;
    const progress = target > 0 ? Math.min(1, observedValue / target) : 0;
    return { hasGoal: true, goalType: "value", target, observedValue, reached: observedValue >= target, progress };
  }

  if (asset.targetPortfolioPercentage !== null) {
    const target = asset.targetPortfolioPercentage;
    if (!position || position.currentWeightPct === null) {
      return { hasGoal: true, goalType: "portfolio_percentage", target, evaluable: false, reason: "Valoración de cartera no disponible" };
    }
    const observedValue = position.currentWeightPct;
    const progress = target > 0 ? Math.min(1, observedValue / target) : 0;
    return { hasGoal: true, goalType: "portfolio_percentage", target, observedValue, reached: observedValue >= target, progress };
  }

  return { hasGoal: false };
}

// Evaluate all assets in a cycle against a positions map.
export function evaluateCycleGoals(
  assets: PlanAsset[],
  positions: Record<string, PositionSnapshot>,
): Map<string, GoalEvaluationResult> {
  const results = new Map<string, GoalEvaluationResult>();
  for (const asset of assets) {
    const evaluation = evaluateAssetGoal(asset, positions[asset.assetId]);
    if (evaluation.hasGoal) {
      results.set(asset.id, evaluation);
    }
  }
  return results;
}

// Return how much EUR/month is freed when an asset stops receiving allocations.
export function calculateReleasedAllocation(
  asset: PlanAsset,
  cycleMonthlyAmountEur: number,
): number {
  if (asset.allocationType === "percentage") {
    const pct = asset.allocationPercentage ?? asset.allocationValue;
    return cycleMonthlyAmountEur * pct / 100;
  }
  return asset.fixedAmountEur ?? asset.allocationValue;
}

// Redistribute the released monthly budget among eligible active assets.
// With an explicit rule (percentages that sum to ~100), the rule governs distribution.
// Without a rule, distribute proportionally among percentage-type assets.
export function redistributeReleasedAllocation(
  releasedAmountEur: number,
  cycleMonthlyAmountEur: number,
  eligibleAssets: PlanAsset[],
  rule?: RedistributionRule[],
): AllocationChange[] {
  if (eligibleAssets.length === 0 || releasedAmountEur <= 0) return [];

  if (rule && rule.length > 0) {
    const changes: AllocationChange[] = [];
    for (const r of rule) {
      const target = eligibleAssets.find(a => a.id === r.investmentAssetId);
      if (!target) continue;

      const addedAmount = releasedAmountEur * (r.percentage / 100);
      const prevPct = target.allocationPercentage ?? (target.allocationType === "percentage" ? target.allocationValue : null);
      const prevFixed = target.fixedAmountEur ?? (target.allocationType === "amount" ? target.allocationValue : null);

      let newAllocationValue: number;
      let newAllocationPercentage: number | null;

      if (target.allocationType === "percentage") {
        const addedPct = cycleMonthlyAmountEur > 0 ? (addedAmount / cycleMonthlyAmountEur) * 100 : 0;
        newAllocationPercentage = (prevPct ?? 0) + addedPct;
        newAllocationValue = newAllocationPercentage;
      } else {
        newAllocationPercentage = null;
        newAllocationValue = (prevFixed ?? 0) + addedAmount;
      }

      changes.push({
        investmentAssetId: target.id,
        previousAllocationValue: target.allocationValue,
        previousAllocationPercentage: prevPct,
        newAllocationValue,
        newAllocationPercentage,
      });
    }
    return changes;
  }

  // Proportional fallback: only percentage-type assets
  const pctAssets = eligibleAssets.filter(a => a.allocationType === "percentage");
  if (pctAssets.length === 0) return [];

  const totalPct = pctAssets.reduce((sum, a) => sum + (a.allocationPercentage ?? a.allocationValue), 0);
  if (totalPct <= 0) return [];

  const releasedPct = cycleMonthlyAmountEur > 0 ? (releasedAmountEur / cycleMonthlyAmountEur) * 100 : 0;

  return pctAssets.map(a => {
    const assetPct = a.allocationPercentage ?? a.allocationValue;
    const addedPct = releasedPct * (assetPct / totalPct);
    const newPct = assetPct + addedPct;
    return {
      investmentAssetId: a.id,
      previousAllocationValue: a.allocationValue,
      previousAllocationPercentage: assetPct,
      newAllocationValue: newPct,
      newAllocationPercentage: newPct,
    };
  });
}

// Build the strategy revision input for traceability when a goal is marked as reached.
export function buildGoalReachedRevisionInput(
  completedAsset: PlanAsset,
  goalType: GoalType,
  observedValue: number,
  releasedAmountEur: number,
  allocationChanges: AllocationChange[],
  effectiveDate: number,
): GoalReachedRevisionInput {
  const changesData: GoalReachedRevisionData = {
    type: "goal_reached",
    investmentAssetId: completedAsset.id,
    assetId: completedAsset.assetId,
    goalType,
    observedValue,
    releasedAmountEur,
    redistributions: allocationChanges.map(c => ({
      investmentAssetId: c.investmentAssetId,
      previousAllocationValue: c.previousAllocationValue,
      newAllocationValue: c.newAllocationValue,
    })),
  };

  return {
    cycleId: completedAsset.cycleId,
    effectiveDate,
    title: `Objetivo alcanzado: ${completedAsset.assetId}`,
    notes: null,
    changesJson: JSON.stringify(changesData),
  };
}

// Return the assets active on a given date and their summed allocation totals.
export function getEffectiveAllocationAtDate(
  assets: PlanAsset[],
  date: number,
): EffectiveAllocation {
  const activeAtDate = assets.filter(a =>
    a.startDate <= date &&
    (a.endDate === null || a.endDate >= date) &&
    (a.status === "active" || a.status === "paused"),
  );

  let totalPct = 0;
  let totalFixedEur = 0;

  for (const a of activeAtDate) {
    if (a.allocationType === "percentage") {
      totalPct += a.allocationPercentage ?? a.allocationValue;
    } else {
      totalFixedEur += a.fixedAmountEur ?? a.allocationValue;
    }
  }

  return { assets: activeAtDate, totalPct, totalFixedEur };
}
