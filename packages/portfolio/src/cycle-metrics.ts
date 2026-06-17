import { PortfolioCalculator } from "./calculator";
import type { TransactionInput } from "./types";

export interface CycleInput {
  id: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
}

export interface MonthlyContribution {
  monthKey: string; // "YYYY-MM"
  programmedEur: number;
  actualEur: number;
  extraEur: number;
}

export interface CycleMetrics {
  cycleId: string;
  monthsElapsed: number;
  monthsRemaining: number | null;
  percentComplete: number | null;
  expectedContributionMonthly: number;
  expectedContributionAnnual: number;
  expectedContributionToDate: number;
  expectedContributionTotal: number | null;
  actualContribution: number;
  contributionDifference: number;
  extraContribution: number;
  contributionCompliancePercentage: number | null;
  monthlyContributions: MonthlyContribution[];
  currentValueEur: number;
  heldCostBasisEur: number;
  profitEur: number;
  roiPercentage: number | null;
  hasPendingValuation: boolean;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Per-month classification, independent of other months: "si un mes supera
// el importe programado, el exceso se registra como aportación extra" —
// a shortfall one month does NOT absorb an excess the next. This is why
// summing extraEur here can differ from the cumulative `extraContribution`
// in CycleMetrics, which nets the whole cycle's actual vs expected to date.
export function classifyMonthlyContributions(
  cycle: CycleInput,
  cycleTransactions: TransactionInput[],
  now: number = Date.now()
): MonthlyContribution[] {
  const effectiveEnd = Math.min(now, cycle.endDate ?? now);
  if (effectiveEnd < cycle.startDate) return [];

  const actualByMonth = new Map<string, number>();
  for (const tx of cycleTransactions) {
    if (tx.type !== "buy") continue;
    let amount = 0;
    for (const leg of tx.legs) {
      if (leg.legType === "destination" && typeof leg.valuationEur === "number") amount += leg.valuationEur;
    }
    if (amount === 0) continue;
    const key = monthKey(tx.date);
    actualByMonth.set(key, (actualByMonth.get(key) ?? 0) + amount);
  }

  const start = new Date(cycle.startDate);
  const end = new Date(effectiveEnd);
  const startIndex = start.getFullYear() * 12 + start.getMonth();
  const endIndex = end.getFullYear() * 12 + end.getMonth();

  const result: MonthlyContribution[] = [];
  for (let index = startIndex; index <= endIndex; index++) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const actualEur = actualByMonth.get(key) ?? 0;
    result.push({
      monthKey: key,
      programmedEur: cycle.monthlyAmountEur,
      actualEur,
      extraEur: Math.max(0, actualEur - cycle.monthlyAmountEur)
    });
  }
  return result;
}

function monthsBetween(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  const start = new Date(startMs);
  const end = new Date(endMs);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

export function belongsToCycle(tx: TransactionInput, cycle: CycleInput, now: number): boolean {
  if (tx.cycleId) return tx.cycleId === cycle.id;
  const end = cycle.endDate ?? now;
  return tx.date >= cycle.startDate && tx.date <= end;
}

export function filterTransactionsForCycle(
  transactions: TransactionInput[],
  cycle: CycleInput,
  now: number = Date.now()
): TransactionInput[] {
  return transactions.filter((tx) => belongsToCycle(tx, cycle, now));
}

// Money actually put into the cycle: the EUR value of every "buy" — counted
// once at funding time, independent of what later happens to the asset
// (held, sold, converted). This is deliberately a raw sum, not run through
// PortfolioCalculator, because that nets balances down on sells and would
// understate how much was ever contributed.
function computeActualContribution(transactions: TransactionInput[]): number {
  let total = 0;
  for (const tx of transactions) {
    if (tx.type !== "buy") continue;
    for (const leg of tx.legs) {
      if (leg.legType === "destination" && typeof leg.valuationEur === "number") {
        total += leg.valuationEur;
      }
    }
  }
  return total;
}

/**
 * Computes a cycle's financial metrics from its own (already date/cycleId
 * filtered) transactions and live prices for whatever it still holds.
 *
 * Scope: `profitEur`/`roiPercentage` reflect the cycle's current holdings
 * vs money contributed (unrealized performance). Realized gains/taxes from
 * sales within the cycle are tracked separately via the Fiscalidad
 * integration — they are not folded back in here to avoid double counting
 * once a sale's proceeds leave the cycle's holdings.
 */
export function computeCycleMetrics(
  cycle: CycleInput,
  cycleTransactions: TransactionInput[],
  currentPrices: Record<string, number | null>,
  now: number = Date.now()
): CycleMetrics {
  const calculator = new PortfolioCalculator();
  const { positions } = calculator.calculate(cycleTransactions);

  let currentValueEur = 0;
  let heldCostBasisEur = 0;
  let hasPendingValuation = false;

  for (const position of Object.values(positions)) {
    if (position.balance <= 0) continue;
    heldCostBasisEur += position.totalInvestedEur;
    if (position.hasPendingValuation) hasPendingValuation = true;

    const price = currentPrices[position.assetId];
    if (typeof price === "number" && Number.isFinite(price)) {
      currentValueEur += position.balance * price;
    } else {
      hasPendingValuation = true;
    }
  }

  const effectiveEnd = cycle.endDate ?? now;
  const monthsElapsed = monthsBetween(cycle.startDate, Math.min(now, effectiveEnd));
  const monthsRemaining = cycle.endDate === null ? null : Math.max(0, monthsBetween(Math.max(now, cycle.startDate), cycle.endDate));
  const totalMonths = cycle.endDate === null ? null : monthsBetween(cycle.startDate, cycle.endDate);
  const percentComplete = totalMonths === null || totalMonths === 0 ? null : Math.min(100, (monthsElapsed / totalMonths) * 100);

  const expectedContributionToDate = cycle.monthlyAmountEur * monthsElapsed;
  const expectedContributionTotal = totalMonths === null ? null : cycle.monthlyAmountEur * totalMonths;
  const actualContribution = computeActualContribution(cycleTransactions);
  const contributionDifference = actualContribution - expectedContributionToDate;
  const extraContribution = Math.max(0, contributionDifference);
  const monthlyContributions = classifyMonthlyContributions(cycle, cycleTransactions, now);

  const profitEur = currentValueEur - actualContribution;
  const roiPercentage = actualContribution > 0 ? (profitEur / actualContribution) * 100 : null;
  const contributionCompliancePercentage =
    expectedContributionToDate > 0 ? Math.min(100, (actualContribution / expectedContributionToDate) * 100) : null;

  return {
    cycleId: cycle.id,
    monthsElapsed,
    monthsRemaining,
    percentComplete,
    expectedContributionMonthly: cycle.monthlyAmountEur,
    expectedContributionAnnual: cycle.monthlyAmountEur * 12,
    expectedContributionToDate,
    expectedContributionTotal,
    actualContribution,
    contributionDifference,
    extraContribution,
    contributionCompliancePercentage,
    monthlyContributions,
    currentValueEur,
    heldCostBasisEur,
    profitEur,
    roiPercentage,
    hasPendingValuation
  };
}
