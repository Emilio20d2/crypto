import type { SnapshotCycle, ContributionLedger, ContributionLedgerCycle } from "./types";

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function nextMonthTs(ts: number): number {
  const d = new Date(ts);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}

export function buildContributionLedger(
  cycles: SnapshotCycle[],
  planName: string,
  projectionStartDate: number,
  horizonDate: number,
  plansTotal: number,
): ContributionLedger {
  const now = startOfMonth(projectionStartDate);
  const ledgerCycles: ContributionLedgerCycle[] = [];

  for (const cycle of cycles) {
    const cycleStart = cycle.startDate;
    const cycleEnd = cycle.endDate ?? horizonDate;

    // Find range [firstMonth, lastMonth] that falls within [now, horizonDate] AND [cycleStart, cycleEnd)
    const rangeStart = Math.max(now, startOfMonth(cycleStart));
    const rangeEnd = Math.min(horizonDate, cycleEnd);

    if (rangeStart >= rangeEnd) {
      ledgerCycles.push({
        cycleId: cycle.id,
        cycleName: cycle.name,
        planName,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        monthlyAmountEur: cycle.monthlyAmountEur,
        firstMonthIncluded: null,
        lastMonthIncluded: null,
        monthsIncluded: 0,
        totalFutureEur: 0,
      });
      continue;
    }

    let months = 0;
    let firstMonth: number | null = null;
    let lastMonth: number | null = null;
    let cursor = startOfMonth(rangeStart);

    while (cursor < rangeEnd) {
      if (firstMonth === null) firstMonth = cursor;
      lastMonth = cursor;
      months++;
      cursor = nextMonthTs(cursor);
    }

    ledgerCycles.push({
      cycleId: cycle.id,
      cycleName: cycle.name,
      planName,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      monthlyAmountEur: cycle.monthlyAmountEur,
      firstMonthIncluded: firstMonth,
      lastMonthIncluded: lastMonth,
      monthsIncluded: months,
      totalFutureEur: Math.round(months * cycle.monthlyAmountEur * 100) / 100,
    });
  }

  const totalFutureEur = ledgerCycles.reduce((s, c) => s + c.totalFutureEur, 0);
  const cyclesIncluded = ledgerCycles.filter(c => c.monthsIncluded > 0).length;
  const plansIncluded = cyclesIncluded > 0 ? 1 : 0;

  let coverageNote: string | null = null;
  if (cyclesIncluded < cycles.length) {
    const excluded = cycles.length - cyclesIncluded;
    coverageNote = `${excluded} ciclo(s) fuera del horizonte de proyección`;
  }
  if (cycles.length === 0) {
    coverageNote = "No hay ciclos configurados — no se proyectan aportaciones";
  }

  return {
    generatedAt: projectionStartDate,
    projectionStartDate,
    horizonDate,
    cycles: ledgerCycles,
    cyclesTotal: cycles.length,
    cyclesIncluded,
    plansTotal,
    plansIncluded,
    totalFutureEur: Math.round(totalFutureEur * 100) / 100,
    coverageNote,
  };
}
