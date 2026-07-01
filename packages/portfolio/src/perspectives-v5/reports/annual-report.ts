import type {
  PerspectivesAnnualSnapshot,
  PerspectivesLedgerEntry,
  PerspectivesMonthlySnapshot,
} from "../domain/types";

export function buildAnnualSnapshots(input: {
  monthlySnapshots: PerspectivesMonthlySnapshot[];
  ledger: PerspectivesLedgerEntry[];
}): PerspectivesAnnualSnapshot[] {
  const grouped = new Map<number, PerspectivesMonthlySnapshot[]>();
  for (const snapshot of input.monthlySnapshots) {
    const year = new Date(snapshot.date).getUTCFullYear();
    const list = grouped.get(year) ?? [];
    list.push(snapshot);
    grouped.set(year, list);
  }

  const output: PerspectivesAnnualSnapshot[] = [];
  for (const [year, snapshots] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const entries = input.ledger.filter((entry) => new Date(entry.date).getUTCFullYear() === year);
    const previous = output.at(-1);
    const continuity = snapshots.slice(1).reduce((max, current, index) => {
      const before = snapshots[index];
      return Math.max(max, Math.abs(current.openingNetWealthEur - before.closingNetWealthEur));
    }, 0);

    output.push({
      year,
      openingNetWealthEur: first.openingNetWealthEur,
      closingGrossWealthEur: last.closingGrossWealthEur,
      closingNetWealthEur: last.closingNetWealthEur,
      externalContributionsEur: snapshots.reduce((sum, item) => sum + item.externalContributionsThisMonthEur, 0),
      internalRebuyCapitalEur: last.internalRebuyCapitalCumulativeEur - (previous?.internalRebuyCapitalEur ?? 0),
      totalCapitalDeployedEur: last.totalCapitalDeployedCumulativeEur - (previous?.totalCapitalDeployedEur ?? 0),
      realizedGainEur: entries.filter((entry) => entry.type === "PARTIAL_SALE").reduce((sum, entry) => sum + entry.realizedGainEur, 0),
      unrealizedGainEur: last.unrealizedGainEur,
      netProfitEur: last.netProfitEur,
      operatingEurcEur: last.operatingEurcEur,
      fiscalReserveEur: last.fiscalReserveEur,
      partialSalesEur: entries.filter((entry) => entry.type === "PARTIAL_SALE").reduce((sum, entry) => sum + entry.grossAmountEur, 0),
      rebuysEur: entries.filter((entry) => entry.type === "INTERNAL_REBUY").reduce((sum, entry) => sum + entry.grossAmountEur, 0),
      monthlyContinuityDiffEur: continuity,
    });
  }
  return output;
}
