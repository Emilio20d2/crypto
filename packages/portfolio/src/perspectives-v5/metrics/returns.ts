import type { PerspectivesMonthlySnapshot } from "../domain/types";

export interface ExternalCashFlow {
  date: number;
  amountEur: number;
}

export function calculateTwr(input: {
  monthlySnapshots: PerspectivesMonthlySnapshot[];
}): { cumulative: number | null; annualized: number | null } {
  if (input.monthlySnapshots.length === 0) return { cumulative: null, annualized: null };
  let cumulativeFactor = 1;
  let measuredMonths = 0;
  for (const snapshot of input.monthlySnapshots) {
    if (snapshot.openingNetWealthEur <= 0) continue;
    const monthlyReturn =
      (snapshot.closingNetWealthEur - snapshot.externalContributionsThisMonthEur + snapshot.costsThisMonthEur) /
      snapshot.openingNetWealthEur -
      1;
    cumulativeFactor *= 1 + monthlyReturn;
    measuredMonths += 1;
  }
  if (measuredMonths === 0) return { cumulative: 0, annualized: 0 };
  const cumulative = cumulativeFactor - 1;
  const annualized = Math.pow(cumulativeFactor, 12 / measuredMonths) - 1;
  return { cumulative, annualized };
}

function npv(rate: number, cashFlows: ExternalCashFlow[]): number {
  const start = cashFlows[0]?.date ?? 0;
  return cashFlows.reduce((sum, flow) => {
    const years = (flow.date - start) / (365.25 * 24 * 60 * 60 * 1000);
    return sum + flow.amountEur / Math.pow(1 + rate, years);
  }, 0);
}

export function calculateXirr(cashFlows: ExternalCashFlow[]): number | null {
  const ordered = cashFlows.slice().sort((a, b) => a.date - b.date);
  if (!ordered.some((flow) => flow.amountEur < 0) || !ordered.some((flow) => flow.amountEur > 0)) return null;
  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low, ordered);
  let highValue = npv(high, ordered);
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid, ordered);
    if (Math.abs(midValue) < 1e-7) return mid;
    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
      highValue = midValue;
    }
  }
  void highValue;
  return (low + high) / 2;
}
