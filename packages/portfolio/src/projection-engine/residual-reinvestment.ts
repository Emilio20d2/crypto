import type { SnapshotCycleAsset, ProjectionLot } from "./types";

export interface ResidualPurchase {
  assetId: string;
  quantity: number;
  priceEur: number;
  amountEur: number;
  newLot: ProjectionLot;
}

export interface ResidualReinvestmentResult {
  purchases: ResidualPurchase[];
  eurSpent: number;
}

/**
 * Reinvest any remaining EURC after rebuys into active portfolio assets.
 * Implements the "reinversión total" rule: EURC is temporary and must reach 0.
 *
 * Priority order per spec §5:
 *  1. rebuys (already done before calling this)
 *  2. underweighted assets (those below their allocation %)
 *  3. opportunities (largest drawdown from cost)
 *  4. current allocation distribution
 *  5. user config
 */
export function simulateResidualReinvestment(
  eurcAvailable: number,
  cycleAssets: SnapshotCycleAsset[],
  prices: Record<string, number | null>,
  balances: Record<string, number>,
  avgCosts: Record<string, number | null>,
  goalReachedAssets: Set<string>,
  failedAssets: Set<string>,
  currentDate: number,
  lotCounter: { next: () => string },
  cycleId: string,
): ResidualReinvestmentResult {
  if (eurcAvailable < 0.01) return { purchases: [], eurSpent: 0 };

  // Filter to eligible assets: active, has price, not goal-reached, not failed
  const eligible = cycleAssets.filter(a =>
    !goalReachedAssets.has(a.assetId) &&
    !failedAssets.has(a.assetId) &&
    (prices[a.assetId] ?? 0) > 0 &&
    a.status === "active"
  );

  if (eligible.length === 0) return { purchases: [], eurSpent: 0 };

  // Resolve allocation percentage (use allocationPercentage if available, else allocationValue as %)
  const resolveAllocPct = (a: SnapshotCycleAsset): number => {
    if (a.allocationType === "percentage" && a.allocationPercentage != null) return a.allocationPercentage;
    if (a.allocationValue != null) return a.allocationValue;
    return 0;
  };

  // Compute current portfolio value for weighting
  const totalPortfolioValue = Object.entries(balances).reduce((s, [aid, bal]) => {
    const p = prices[aid];
    return s + (p != null && p > 0 ? bal * p : 0);
  }, 0) + eurcAvailable;

  // Compute target vs actual allocations to find underweighted assets first
  type Candidate = { assetId: string; allocationPct: number; currentPct: number; under: number; price: number };
  const candidates: Candidate[] = eligible.map(a => {
    const price = prices[a.assetId]!;
    const currentValue = (balances[a.assetId] ?? 0) * price;
    const currentPct = totalPortfolioValue > 0 ? currentValue / totalPortfolioValue : 0;
    const allocationPct = resolveAllocPct(a);
    const targetPct = allocationPct / 100;
    return {
      assetId: a.assetId,
      allocationPct,
      currentPct,
      under: Math.max(0, targetPct - currentPct),
      price,
    };
  });

  // Sort: most underweighted first, then by allocation %
  candidates.sort((a, b) => b.under - a.under || b.allocationPct - a.allocationPct);

  // Build weight-proportional allocation of the EURC to reinvest
  const totalAlloc = candidates.reduce((s, c) => s + c.allocationPct, 0);
  if (totalAlloc <= 0) return { purchases: [], eurSpent: 0 };

  const purchases: ResidualPurchase[] = [];
  let eurSpent = 0;

  for (const candidate of candidates) {
    const share = candidate.allocationPct / totalAlloc;
    const amountEur = Math.round(eurcAvailable * share * 100) / 100;
    if (amountEur < 0.01) continue;

    const quantity = amountEur / candidate.price;
    const lotId = lotCounter.next();

    purchases.push({
      assetId: candidate.assetId,
      quantity,
      priceEur: candidate.price,
      amountEur,
      newLot: {
        lotId,
        assetId: candidate.assetId,
        acquiredAt: currentDate,
        quantity,
        costPerUnitEur: candidate.price,
        remaining: quantity,
        source: "projection_residual_reinvestment",
      },
    });
    eurSpent += amountEur;
  }

  // Absorb any rounding residual into the first purchase
  const roundingResidue = Math.round((eurcAvailable - eurSpent) * 100) / 100;
  if (roundingResidue > 0.001 && purchases.length > 0) {
    const first = purchases[0];
    const extraQty = roundingResidue / first.priceEur;
    first.amountEur += roundingResidue;
    first.quantity += extraQty;
    first.newLot.quantity += extraQty;
    first.newLot.remaining += extraQty;
    eurSpent += roundingResidue;
  }

  return { purchases, eurSpent: Math.round(eurSpent * 100) / 100 };
}
