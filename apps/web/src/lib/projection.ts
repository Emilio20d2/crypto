export type ProjectionScenario = "conservador" | "moderado" | "base" | "optimista" | "personalizado";

export interface CycleInput {
  id: string;
  name: string;
  startDate: number;
  endDate: number | null;
  monthlyAmountEur: number;
  status: string;
}

export interface ProjectionPoint {
  cycleId: string;
  cycleName: string;
  periodEnd: number | null;
  totalInvested: number;
  projectedValue: number;
  gains: number;
  estimatedTax: number;
  netValue: number;
}

export interface ProjectionResult {
  scenario: ProjectionScenario;
  annualGrowthRate: number;
  currentValue: number;
  currentInvested: number;
  points: ProjectionPoint[];
  totalFutureInvestment: number;
  projectedTotalValue: number;
  gains: number;
  estimatedTotalTax: number;
  netProjectedValue: number;
  hypotheses: string[];
}

import { calculateSpanishSavingsTax } from "./taxCalculations";

const ANNUAL_RATES: Record<ProjectionScenario, number> = {
  conservador: 0.05,
  moderado: 0.075,
  base: 0.10,
  optimista: 0.20,
  personalizado: 0.10,
};

const AVG_DAYS_PER_MONTH = 30.4375;
const MS_PER_DAY = 24 * 3600 * 1000;

export function computeProjection(
  currentValueEur: number,
  currentInvestedEur: number,
  cycles: CycleInput[],
  scenario: ProjectionScenario,
  customRate: number,
  now: number,
  openCycleHorizonYears = 10,
): ProjectionResult {
  const annualRate = scenario === "personalizado" ? customRate / 100 : ANNUAL_RATES[scenario];
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;

  let value = currentValueEur;
  let invested = currentInvestedEur;
  const points: ProjectionPoint[] = [];

  const relevantCycles = [...cycles]
    .filter(c => c.status !== "paused" && c.startDate !== undefined)
    .sort((a, b) => a.startDate - b.startDate);

  for (const cycle of relevantCycles) {
    const cycleEnd = cycle.endDate ?? (now + openCycleHorizonYears * 365.25 * MS_PER_DAY);
    const effectiveStart = Math.max(cycle.startDate, now);

    if (effectiveStart >= cycleEnd) {
      const gains = Math.max(0, value - invested);
      const tax = calculateSpanishSavingsTax(gains);
      points.push({
        cycleId: cycle.id, cycleName: cycle.name, periodEnd: cycle.endDate,
        totalInvested: invested, projectedValue: value, gains,
        estimatedTax: tax,
        netValue: value - tax,
      });
      continue;
    }

    const months = Math.max(1, Math.round((cycleEnd - effectiveStart) / (AVG_DAYS_PER_MONTH * MS_PER_DAY)));
    for (let m = 0; m < months; m++) {
      value = value * (1 + monthlyRate) + cycle.monthlyAmountEur;
      invested += cycle.monthlyAmountEur;
    }

    const gains = Math.max(0, value - invested);
    const tax = calculateSpanishSavingsTax(gains);
    points.push({
      cycleId: cycle.id, cycleName: cycle.name, periodEnd: cycle.endDate,
      totalInvested: invested, projectedValue: value, gains,
      estimatedTax: tax,
      netValue: value - tax,
    });
  }

  const finalGains = Math.max(0, value - invested);
  const finalTax = calculateSpanishSavingsTax(finalGains);

  return {
    scenario, annualGrowthRate: annualRate,
    currentValue: currentValueEur, currentInvested: currentInvestedEur,
    points,
    totalFutureInvestment: invested,
    projectedTotalValue: value,
    gains: finalGains,
    estimatedTotalTax: finalTax,
    netProjectedValue: value - finalTax,
    hypotheses: [
      `Tasa de crecimiento anual compuesta (CAGR): ${(annualRate * 100).toFixed(0)}%`,
      "Impuesto sobre plusvalías: tramos progresivos españoles del ahorro 2024 (19/21/23/27/28%)",
      "Aportaciones mensuales constantes según plan de cada ciclo",
      "Sin ventas parciales ni recompras intermedias en la simulación",
      "Escenario hipotético ilustrativo. No es una predicción ni asesoramiento financiero.",
    ],
  };
}

export function formatEur(v: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

export function formatPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
