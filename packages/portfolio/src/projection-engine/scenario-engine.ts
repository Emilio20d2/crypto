import type { ProjectionInput, ProjectionOutput, ProjectionScenario, PlanConsolidatedSnapshot, FiscalConfig, ProjectionOptions } from "./types";
import { SPANISH_FISCAL_CONFIG_2024 } from "./types";
import { buildDefaultHypotheses } from "./asset-simulator";
import { runProjection } from "./projection-engine";

export interface ScenarioSet {
  conservador: ProjectionOutput;
  base: ProjectionOutput;
  optimista: ProjectionOutput;
  dinamico: ProjectionOutput;
}

export interface ScenarioComparison {
  scenario: ProjectionScenario;
  label: string;
  finalGrossWealthEur: number;
  finalNetWealthEur: number;
  probability: number | null;
  confidence: number | null;
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
  const scenarios: ProjectionScenario[] = ["conservador", "base", "optimista", "dinamico"];
  const results: Partial<ScenarioSet> = {};

  for (const s of scenarios) {
    const input = buildScenarioInput(snapshot, s, horizonDate, options, fiscalConfig, now, dynamicFactors);
    results[s] = runProjection(input);
  }

  return results as ScenarioSet;
}

export function compareScenarios(set: ScenarioSet): ScenarioComparison[] {
  const LABELS: Record<ProjectionScenario, string> = {
    conservador: "Conservador",
    base: "Base",
    optimista: "Optimista",
    dinamico: "Dinámico",
  };

  return (["conservador", "base", "optimista", "dinamico"] as ProjectionScenario[]).map(s => ({
    scenario: s,
    label: LABELS[s],
    finalGrossWealthEur: set[s].summary.finalGrossWealthEur,
    finalNetWealthEur: set[s].summary.finalNetWealthEur,
    probability: set[s].summary.probability,
    confidence: set[s].summary.confidence,
  }));
}
