import type { ProjectionInput, ProjectionOutput, ProjectionScenario, PlanConsolidatedSnapshot, FiscalConfig, ProjectionOptions, ScenarioOrderingViolation } from "./types";
import { SPANISH_FISCAL_CONFIG_2024 } from "./types";
import { buildDefaultHypotheses } from "./asset-simulator";
import { runProjection } from "./projection-engine";

export interface ScenarioSet {
  conservador:   ProjectionOutput;
  moderado:      ProjectionOutput;
  base:          ProjectionOutput;
  favorable:     ProjectionOutput;
  muy_favorable: ProjectionOutput;
  optimista:     ProjectionOutput;
  dinamico:      ProjectionOutput;
}

export interface ScenarioComparison {
  scenario:            ProjectionScenario;
  label:               string;
  finalGrossWealthEur: number;
  finalNetWealthEur:   number;
  probability:         number | null;
  confidence:          number | null;
}

export function buildScenarioInput(
  snapshot: PlanConsolidatedSnapshot,
  scenario: ProjectionScenario,
  horizonDate: number,
  options: ProjectionOptions,
  fiscalConfig: FiscalConfig,
  now: number,
  dynamicFactors?: { fearAndGreedIndex: number | null; btcDominance: number | null },
): ProjectionInput {
  const assetIds = Array.from(new Set([
    ...Object.keys(snapshot.positions),
    ...Object.keys(snapshot.prices),
    ...snapshot.cycles.flatMap(cycle => cycle.assets.map(asset => asset.assetId)),
  ]));
  const hypotheses = buildDefaultHypotheses(scenario, assetIds, dynamicFactors);

  return {
    snapshot,
    projectionStartDate: snapshot.projectionStartDate,
    horizonDate,
    scenario,
    scenarioHypotheses: hypotheses,
    fiscalConfig,
    resolution: "monthly",
    options,
    now,
  };
}

export function runAllScenarios(
  snapshot: PlanConsolidatedSnapshot,
  horizonDate: number,
  options: ProjectionOptions = {},
  fiscalConfig: FiscalConfig = SPANISH_FISCAL_CONFIG_2024,
  now: number = Date.now(),
  dynamicFactors?: { fearAndGreedIndex: number | null; btcDominance: number | null },
): ScenarioSet {
  const scenarios: ProjectionScenario[] = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico",
  ];
  const results: Partial<ScenarioSet> = {};

  for (const s of scenarios) {
    const input = buildScenarioInput(snapshot, s, horizonDate, options, fiscalConfig, now, dynamicFactors);
    results[s as keyof ScenarioSet] = runProjection(input);
  }

  return results as ScenarioSet;
}

export function validateScenarioOrdering(set: ScenarioSet): ScenarioOrderingViolation[] {
  const order: Array<keyof ScenarioSet> = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista",
  ];
  const violations: ScenarioOrderingViolation[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    const lower  = set[order[i]].summary.finalGrossWealthEur;
    const higher = set[order[i + 1]].summary.finalGrossWealthEur;
    if (higher < lower - 1.0) {
      violations.push({
        date: set[order[i + 1]].horizonDate,
        lowerScenario: order[i + 1],
        lowerValue: higher,
        higherScenario: order[i],
        higherValue: lower,
        explanation: `${order[i+1]} (${higher.toFixed(0)}€) < ${order[i]} (${lower.toFixed(0)}€) — inversión injustificada`,
      });
    }
  }
  return violations;
}

export function compareScenarios(set: ScenarioSet): ScenarioComparison[] {
  const LABELS: Record<ProjectionScenario, string> = {
    conservador:   "Conservador",
    moderado:      "Moderado",
    base:          "Base",
    favorable:     "Favorable",
    muy_favorable: "Muy favorable",
    optimista:     "Optimista",
    dinamico:      "Dinámico",
  };

  const order: ProjectionScenario[] = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico",
  ];

  return order.map(s => ({
    scenario:            s,
    label:               LABELS[s],
    finalGrossWealthEur: set[s as keyof ScenarioSet].summary.finalGrossWealthEur,
    finalNetWealthEur:   set[s as keyof ScenarioSet].summary.finalNetWealthEur,
    probability:         set[s as keyof ScenarioSet].summary.probability,
    confidence:          set[s as keyof ScenarioSet].summary.confidence,
  }));
}
