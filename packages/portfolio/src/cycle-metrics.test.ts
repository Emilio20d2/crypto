import { describe, test, expect } from "vitest";
import { computeCycleMetrics, filterTransactionsForCycle, belongsToCycle, classifyMonthlyContributions } from "./cycle-metrics";
import type { CycleInput } from "./cycle-metrics";
import type { TransactionInput } from "./types";

function dateMs(s: string): number {
  return new Date(s).getTime();
}

describe("computeCycleMetrics", () => {
  test("aportación extra: 100€/mes previstos, 150€ reales en el primer mes no desaparecen", () => {
    const cycle: CycleInput = {
      id: "cycle-1",
      startDate: dateMs("2026-01-01"),
      endDate: null,
      monthlyAmountEur: 100
    };
    const transactions: TransactionInput[] = [
      {
        id: "tx1",
        type: "buy",
        date: dateMs("2026-01-15"),
        legs: [{ assetId: "BTC", amount: 0.003, legType: "destination", valuationEur: 150 }]
      }
    ];
    const now = dateMs("2026-02-01");

    const metrics = computeCycleMetrics(cycle, transactions, { BTC: 50000 }, now);
    expect(metrics.monthsElapsed).toBe(1);
    expect(metrics.expectedContributionToDate).toBe(100);
    expect(metrics.actualContribution).toBe(150);
    expect(metrics.contributionDifference).toBe(50);
    expect(metrics.extraContribution).toBe(50);
  });

  test("ciclo cerrado: % completado y meses restantes se calculan sobre fechas fijas", () => {
    const cycle: CycleInput = {
      id: "cycle-2030",
      startDate: dateMs("2026-01-01"),
      endDate: dateMs("2030-01-01"),
      monthlyAmountEur: 100
    };
    const now = dateMs("2028-01-01");

    const metrics = computeCycleMetrics(cycle, [], {}, now);
    expect(metrics.monthsElapsed).toBe(24);
    expect(metrics.monthsRemaining).toBe(24);
    expect(metrics.percentComplete).toBe(50);
    expect(metrics.expectedContributionTotal).toBe(100 * 48);
  });

  test("ciclo abierto: meses restantes y % completado son null", () => {
    const cycle: CycleInput = {
      id: "cycle-open",
      startDate: dateMs("2026-01-01"),
      endDate: null,
      monthlyAmountEur: 200
    };
    const metrics = computeCycleMetrics(cycle, [], {}, dateMs("2027-01-01"));
    expect(metrics.monthsRemaining).toBeNull();
    expect(metrics.percentComplete).toBeNull();
    expect(metrics.expectedContributionTotal).toBeNull();
  });

  test("valor actual, beneficio y ROI con precio en vivo", () => {
    const cycle: CycleInput = {
      id: "cycle-roi",
      startDate: dateMs("2026-01-01"),
      endDate: null,
      monthlyAmountEur: 100
    };
    const transactions: TransactionInput[] = [
      {
        id: "tx1",
        type: "buy",
        date: dateMs("2026-01-10"),
        legs: [{ assetId: "ADA", amount: 1000, legType: "destination", valuationEur: 100 }]
      }
    ];
    const metrics = computeCycleMetrics(cycle, transactions, { ADA: 0.15 }, dateMs("2026-02-01"));
    expect(metrics.currentValueEur).toBeCloseTo(150);
    expect(metrics.actualContribution).toBe(100);
    expect(metrics.profitEur).toBeCloseTo(50);
    expect(metrics.roiPercentage).toBeCloseTo(50);
  });

  test("belongsToCycle: cycleId explícito prevalece sobre la fecha", () => {
    const cycleA: CycleInput = { id: "A", startDate: dateMs("2026-01-01"), endDate: dateMs("2027-01-01"), monthlyAmountEur: 100 };
    const tx: TransactionInput = {
      id: "tx1",
      type: "buy",
      date: dateMs("2030-06-01"), // fuera del rango de fechas de A
      cycleId: "A",
      legs: [{ assetId: "BTC", amount: 0.001, legType: "destination", valuationEur: 50 }]
    };
    expect(belongsToCycle(tx, cycleA, dateMs("2030-07-01"))).toBe(true);
  });

  test("belongsToCycle: histórico ADA cerrado y TON abierto conviven sin pisarse", () => {
    const adaCycle: CycleInput = { id: "ada", startDate: dateMs("2026-01-01"), endDate: dateMs("2027-08-01"), monthlyAmountEur: 100 };
    const tonCycle: CycleInput = { id: "ton", startDate: dateMs("2027-08-01"), endDate: null, monthlyAmountEur: 100 };

    const adaTx: TransactionInput = { id: "tx-ada", type: "buy", date: dateMs("2027-01-01"), legs: [] };
    const tonTx: TransactionInput = { id: "tx-ton", type: "buy", date: dateMs("2027-09-01"), legs: [] };
    const now = dateMs("2028-01-01");

    expect(filterTransactionsForCycle([adaTx, tonTx], adaCycle, now)).toEqual([adaTx]);
    expect(filterTransactionsForCycle([adaTx, tonTx], tonCycle, now)).toEqual([tonTx]);
  });

  test("activo sin precio en vivo marca hasPendingValuation en vez de fallar", () => {
    const cycle: CycleInput = { id: "c", startDate: dateMs("2026-01-01"), endDate: null, monthlyAmountEur: 50 };
    const transactions: TransactionInput[] = [
      { id: "tx1", type: "buy", date: dateMs("2026-01-05"), legs: [{ assetId: "SEI", amount: 100, legType: "destination", valuationEur: 10 }] }
    ];
    const metrics = computeCycleMetrics(cycle, transactions, { SEI: null }, dateMs("2026-02-01"));
    expect(metrics.hasPendingValuation).toBe(true);
    expect(metrics.currentValueEur).toBe(0);
  });

  test("clasificación mensual: el exceso de un mes no se neta con el déficit de otro", () => {
    const cycle: CycleInput = { id: "c", startDate: dateMs("2026-01-01"), endDate: null, monthlyAmountEur: 100 };
    const transactions: TransactionInput[] = [
      // Enero: 50€ — por debajo de lo programado, sin aportación extra.
      { id: "tx-jan", type: "buy", date: dateMs("2026-01-10"), legs: [{ assetId: "BTC", amount: 0.001, legType: "destination", valuationEur: 50 }] },
      // Febrero: 150€ — 50€ de aportación extra ESE mes, no se compensa con enero.
      { id: "tx-feb", type: "buy", date: dateMs("2026-02-10"), legs: [{ assetId: "BTC", amount: 0.003, legType: "destination", valuationEur: 150 }] }
    ];
    const months = classifyMonthlyContributions(cycle, transactions, dateMs("2026-03-01"));
    expect(months).toEqual([
      { monthKey: "2026-01", programmedEur: 100, actualEur: 50, extraEur: 0 },
      { monthKey: "2026-02", programmedEur: 100, actualEur: 150, extraEur: 50 },
      { monthKey: "2026-03", programmedEur: 100, actualEur: 0, extraEur: 0 }
    ]);
  });

  test("expectedContributionMonthly/Annual se exponen directamente desde el ciclo", () => {
    const cycle: CycleInput = { id: "c", startDate: dateMs("2026-01-01"), endDate: null, monthlyAmountEur: 100 };
    const metrics = computeCycleMetrics(cycle, [], {}, dateMs("2026-02-01"));
    expect(metrics.expectedContributionMonthly).toBe(100);
    expect(metrics.expectedContributionAnnual).toBe(1200);
  });
});
