// Domain engine for asset substitution validation and application.
// Pure functions — no I/O, no React, independently testable.

export type SubstitutionStatus = "borrador" | "programada" | "aplicada" | "cancelada";
export type AllocationTransferMode = "full" | "custom" | "pending";

export interface SubstitutionCycleInput {
  id: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
}

export interface SubstitutionAssetInput {
  id: string;
  assetId: string;
  cycleId: string;
  status: string;
  allocationType: "percentage" | "amount";
  allocationValue: number;
  allocationPercentage: number | null;
  fixedAmountEur: number | null;
  startDate: number;
  endDate: number | null;
  isActive: boolean;
}

export interface SubstitutionInput {
  id?: string;
  cycleId: string;
  fromAssetId: string;
  toAssetId: string | null;
  effectiveDate: number;
  allocationTransferMode: AllocationTransferMode | null;
  allocationTransferPercentage: number | null;
  allocationTransferAmount: number | null;
  reason: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

// Validate a substitution before creating/applying it
export function validateAssetSubstitution(
  input: SubstitutionInput,
  cycle: SubstitutionCycleInput,
  existingActiveAssets: SubstitutionAssetInput[],
): ValidationResult {
  if (!input.fromAssetId.trim()) {
    return { valid: false, reason: "El activo saliente es obligatorio." };
  }

  if (input.toAssetId && input.toAssetId === input.fromAssetId) {
    return { valid: false, reason: "El activo entrante no puede ser el mismo que el saliente." };
  }

  // fromAsset must exist in cycle
  const fromAsset = existingActiveAssets.find(
    a => a.assetId === input.fromAssetId && a.cycleId === input.cycleId
  );
  if (!fromAsset) {
    return { valid: false, reason: `El activo saliente (${input.fromAssetId}) no existe en este ciclo.` };
  }

  // effectiveDate must be within the cycle bounds
  if (input.effectiveDate < cycle.startDate) {
    return { valid: false, reason: "La fecha efectiva no puede ser anterior al inicio del ciclo." };
  }
  if (cycle.endDate !== null && input.effectiveDate > cycle.endDate) {
    return { valid: false, reason: "La fecha efectiva no puede ser posterior al fin del ciclo." };
  }

  // toAsset must not already be active in the cycle with overlapping dates
  if (input.toAssetId) {
    const existing = existingActiveAssets.find(
      a => a.assetId === input.toAssetId &&
           a.cycleId === input.cycleId &&
           (a.endDate === null || a.endDate >= input.effectiveDate) &&
           a.startDate <= input.effectiveDate &&
           a.status === "active"
    );
    if (existing) {
      return { valid: false, reason: `El activo entrante (${input.toAssetId}) ya está activo en este ciclo durante ese período.` };
    }
  }

  // Validate transfer mode fields
  if (input.allocationTransferMode === "custom") {
    if (input.allocationTransferPercentage !== null && input.allocationTransferPercentage !== undefined) {
      if (input.allocationTransferPercentage < 0 || input.allocationTransferPercentage > 100) {
        return { valid: false, reason: "El porcentaje de transferencia debe estar entre 0 y 100." };
      }
    }
    if (input.allocationTransferAmount !== null && input.allocationTransferAmount !== undefined) {
      if (input.allocationTransferAmount < 0) {
        return { valid: false, reason: "El importe de transferencia no puede ser negativo." };
      }
    }
  }

  return { valid: true };
}

export interface SubstitutionEffect {
  fromAssetId: string;
  fromInvestmentAssetId: string | null;
  closeFromAt: number;
  toAssetId: string | null;
  toInvestmentAssetNewConfig: {
    allocationType: "percentage" | "amount";
    allocationValue: number;
    allocationPercentage: number | null;
    fixedAmountEur: number | null;
    startDate: number;
  } | null;
  revisionTitle: string;
  revisionChangesJson: string;
}

// Compute what changes applying a substitution should make
export function applyAssetSubstitution(
  sub: SubstitutionInput & { id: string },
  fromAsset: SubstitutionAssetInput,
  cycle: SubstitutionCycleInput,
): SubstitutionEffect {
  const transferredAlloc = computeTransferredAllocation(sub, fromAsset, cycle);

  const toConfig = sub.toAssetId
    ? {
        allocationType: fromAsset.allocationType,
        allocationValue: transferredAlloc.allocationValue,
        allocationPercentage: transferredAlloc.allocationPercentage,
        fixedAmountEur: transferredAlloc.fixedAmountEur,
        startDate: sub.effectiveDate,
      }
    : null;

  const changesJson = JSON.stringify({
    type: "asset_substitution",
    substitutionId: sub.id,
    fromAssetId: sub.fromAssetId,
    toAssetId: sub.toAssetId,
    effectiveDate: sub.effectiveDate,
    allocationTransferMode: sub.allocationTransferMode ?? "full",
    previousAllocationValue: fromAsset.allocationValue,
    newAllocationValue: transferredAlloc.allocationValue,
    reason: sub.reason,
  });

  return {
    fromAssetId: sub.fromAssetId,
    fromInvestmentAssetId: fromAsset.id,
    closeFromAt: sub.effectiveDate,
    toAssetId: sub.toAssetId,
    toInvestmentAssetNewConfig: toConfig,
    revisionTitle: sub.toAssetId
      ? `Sustitución: ${sub.fromAssetId} → ${sub.toAssetId}`
      : `Retirada de activo: ${sub.fromAssetId}`,
    revisionChangesJson: changesJson,
  };
}

interface TransferredAllocation {
  allocationValue: number;
  allocationPercentage: number | null;
  fixedAmountEur: number | null;
}

function computeTransferredAllocation(
  sub: SubstitutionInput,
  fromAsset: SubstitutionAssetInput,
  cycle: SubstitutionCycleInput,
): TransferredAllocation {
  const mode = sub.allocationTransferMode ?? "full";

  if (mode === "pending") {
    return { allocationValue: 0, allocationPercentage: null, fixedAmountEur: null };
  }

  if (mode === "full") {
    return {
      allocationValue: fromAsset.allocationValue,
      allocationPercentage: fromAsset.allocationPercentage,
      fixedAmountEur: fromAsset.fixedAmountEur,
    };
  }

  // custom mode
  if (fromAsset.allocationType === "percentage") {
    const pct = sub.allocationTransferPercentage ?? fromAsset.allocationPercentage ?? fromAsset.allocationValue;
    return { allocationValue: pct, allocationPercentage: pct, fixedAmountEur: null };
  } else {
    const monthly = cycle.monthlyAmountEur;
    const amount = sub.allocationTransferAmount ?? fromAsset.fixedAmountEur ?? fromAsset.allocationValue;
    const pct = monthly > 0 ? (amount / monthly) * 100 : null;
    return { allocationValue: amount, allocationPercentage: pct, fixedAmountEur: amount };
  }
}

// Check if a substitution can be cancelled
export function canCancelSubstitution(status: SubstitutionStatus): boolean {
  return status === "borrador" || status === "programada";
}

// Check if a substitution can be applied
export function canApplySubstitution(status: SubstitutionStatus): boolean {
  return status === "borrador" || status === "programada";
}

// Validate that the transfer allocation doesn't push cycle totals above 100%
export function validateAllocationBudget(
  existingActiveAssets: SubstitutionAssetInput[],
  fromAssetId: string,
  newAllocationValue: number,
  allocationType: "percentage" | "amount",
  cycleMonthlyEur: number,
): ValidationResult {
  // Sum current allocations, excluding the from-asset (which will be removed)
  let totalPct = 0;
  let totalFixed = 0;

  for (const a of existingActiveAssets) {
    if (a.assetId === fromAssetId) continue;
    if (a.allocationType === "percentage") {
      totalPct += a.allocationPercentage ?? a.allocationValue;
    } else {
      totalFixed += a.fixedAmountEur ?? a.allocationValue;
    }
  }

  if (allocationType === "percentage") {
    if (totalPct + newAllocationValue > 100.01) {
      return {
        valid: false,
        reason: `El reparto total superaría el 100% (${(totalPct + newAllocationValue).toFixed(1)}%).`,
      };
    }
  } else {
    if (totalFixed + newAllocationValue > cycleMonthlyEur * 1.001) {
      return {
        valid: false,
        reason: `Los importes fijos superarían el total mensual del ciclo (${(totalFixed + newAllocationValue).toFixed(2)} > ${cycleMonthlyEur.toFixed(2)} €).`,
      };
    }
  }

  return { valid: true };
}

// Get active assets in a cycle at a given date
export function getCycleAssetsAtDate(
  assets: SubstitutionAssetInput[],
  cycleId: string,
  date: number,
): SubstitutionAssetInput[] {
  return assets.filter(a =>
    a.cycleId === cycleId &&
    a.startDate <= date &&
    (a.endDate === null || a.endDate >= date) &&
    (a.status === "active" || a.status === "paused")
  );
}
