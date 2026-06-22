import type { ProjectionInput, ProjectionOutput, ProjectionScenario, PlanConsolidatedSnapshot, FiscalConfig, ProjectionOptions, ScenarioOrderingViolation, WealthFloorViolation, ProjectionSummary, ProjectionPeriod } from "./types";
import { SPANISH_FISCAL_CONFIG_2024, buildCacheKey } from "./types";
import { buildDefaultHypotheses, buildZeroGrowthHypotheses } from "./asset-simulator";
import { runProjection } from "./projection-engine";

// ── Trajectory invariance cache ───────────────────────────────────────────────
//
// Each scenario is run ONCE to the maximum horizon (2044 by default).
// Sub-horizon queries (e.g. 2036) slice the cached full trajectory.
// This guarantees: state-at-2036 is identical whether horizon=2036 or horizon=2044.

interface TrajectoryCache {
  key: string;
  maxHorizon: number;
  output: ProjectionOutput;
  builtAt: number;
}

const trajectoryCache = new Map<string, TrajectoryCache>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function makeTrajCacheKey(input: Omit<ProjectionInput, "now">, maxHorizon: number): string {
  return buildCacheKey({ ...input, horizonDate: maxHorizon });
}

function rebuildSummaryForHorizon(full: ProjectionOutput, cutPeriods: ProjectionPeriod[]): ProjectionSummary {
  const last = cutPeriods[cutPeriods.length - 1];
  const first = cutPeriods[0];
  if (!last || !first) return full.summary;

  const totalRealizedGain = cutPeriods.reduce((s, p) => s + p.realizedGainEur, 0);
  const totalTax = cutPeriods.reduce((s, p) => s + p.taxGeneratedEur, 0);
  const totalSales = cutPeriods.reduce((s, p) => s + p.totalSalesEur, 0);
  const totalRebuys = cutPeriods.reduce((s, p) => s + p.totalRebuysEur, 0);
  const futureCapital = cutPeriods.reduce((s, p) => s + (p.futureCapitalEur - (cutPeriods[cutPeriods.indexOf(p) - 1]?.futureCapitalEur ?? 0)), 0);

  return {
    ...full.summary,
    horizonDate: last.date,
    finalGrossWealthEur: last.grossWealthEur,
    finalNetWealthEur: last.netWealthEur,
    totalFutureCapitalEur: last.futureCapitalEur,
    totalCapitalEur: last.totalCapitalEur,
    estimatedMarketGainEur: last.netWealthEur - first.grossWealthEur - last.futureCapitalEur + totalTax,
    totalRealizedGainEur: totalRealizedGain,
    totalUnrealizedGainEur: Object.values(last.positions).reduce((s, p) => s + (p.unrealizedGainEur ?? 0), 0),
    totalTaxGeneratedEur: totalTax,
    totalTaxPendingEur: last.taxPendingEur,
    finalEurcAvailableEur: last.eurcAvailableEur,
    finalFiscalReserveEur: last.fiscalReserveEur,
    finalCashEur: last.cashEur,
  };
}

function extractSubHorizon(full: ProjectionOutput, horizonDate: number): ProjectionOutput {
  if (horizonDate >= full.horizonDate) return full;
  const cutPeriods = full.periods.filter(p => p.date <= horizonDate);
  if (cutPeriods.length === 0) return { ...full, horizonDate };
  return {
    ...full,
    horizonDate,
    periods: cutPeriods,
    summary: rebuildSummaryForHorizon(full, cutPeriods),
  };
}

/** Run scenario to maxHorizon (cached), then extract the sub-horizon slice. */
export function getProjectionForHorizon(
  input: ProjectionInput,
  maxHorizon: number,
): ProjectionOutput {
  const key = makeTrajCacheKey(input, maxHorizon);
  const now = Date.now();
  const cached = trajectoryCache.get(key);
  if (cached && now - cached.builtAt < CACHE_TTL_MS) {
    return extractSubHorizon(cached.output, input.horizonDate);
  }
  const fullOutput = runProjection({ ...input, horizonDate: maxHorizon });
  trajectoryCache.set(key, { key, maxHorizon, output: fullOutput, builtAt: now });
  return extractSubHorizon(fullOutput, input.horizonDate);
}

/** Clear the trajectory cache (call when snapshot changes). */
export function clearTrajectoryCache(): void {
  trajectoryCache.clear();
}

export interface ScenarioSet {
  conservador:   ProjectionOutput;
  moderado:      ProjectionOutput;
  base:          ProjectionOutput;
  favorable:     ProjectionOutput;
  muy_favorable: ProjectionOutput;
  optimista:     ProjectionOutput;
  dinamico:      ProjectionOutput;
  cero:          ProjectionOutput;
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
  dynamicFactors?: {
    fearAndGreedIndex: number | null;
    btcDominance: number | null;
    assetSentiment?: Record<string, { score: number; direction: string; confidence: number }>;
  },
): ProjectionInput {
  const assetIds = Array.from(new Set([
    ...Object.keys(snapshot.positions),
    ...Object.keys(snapshot.prices),
    ...snapshot.cycles.flatMap(cycle => cycle.assets.map(asset => asset.assetId)),
  ]));

  const hypotheses = scenario === "cero"
    ? buildZeroGrowthHypotheses(assetIds)
    : buildDefaultHypotheses(scenario, assetIds, dynamicFactors);

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

// Maximum horizon used for the invariance cache — all scenarios run to this date.
// Sub-horizons (e.g. 2036) are extracted by slicing the cached trajectory.
const MAX_CACHE_HORIZON_YEAR = 2044;

export function runAllScenarios(
  snapshot: PlanConsolidatedSnapshot,
  horizonDate: number,
  options: ProjectionOptions = {},
  fiscalConfig: FiscalConfig = SPANISH_FISCAL_CONFIG_2024,
  now: number = Date.now(),
  dynamicFactors?: {
    fearAndGreedIndex: number | null;
    btcDominance: number | null;
    assetSentiment?: Record<string, { score: number; direction: string; confidence: number }>;
  },
): ScenarioSet {
  // Use the later of the requested horizon and the cache horizon so that
  // extracting any sub-horizon always works from the same trajectory.
  const maxHorizon = Math.max(
    horizonDate,
    new Date(Date.UTC(MAX_CACHE_HORIZON_YEAR, 11, 31)).getTime(),
  );

  const scenarios: ProjectionScenario[] = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico",
  ];
  const results: Partial<ScenarioSet> = {};

  for (const s of scenarios) {
    const input = buildScenarioInput(snapshot, s, horizonDate, options, fiscalConfig, now, dynamicFactors);
    results[s as keyof ScenarioSet] = getProjectionForHorizon(input, maxHorizon);
  }

  // CERO control: plan_base policy + 0% growth — independent of user policy
  results.cero = runControlCeroScenario(snapshot, horizonDate, fiscalConfig, now);

  return results as ScenarioSet;
}

export function runControlCeroScenario(
  snapshot: PlanConsolidatedSnapshot,
  horizonDate: number,
  fiscalConfig: FiscalConfig = SPANISH_FISCAL_CONFIG_2024,
  now: number = Date.now(),
): ProjectionOutput {
  const assetIds = Array.from(new Set([
    ...Object.keys(snapshot.positions),
    ...Object.keys(snapshot.prices),
    ...snapshot.cycles.flatMap(cycle => cycle.assets.map(asset => asset.assetId)),
  ]));
  const hypotheses = buildZeroGrowthHypotheses(assetIds);

  const input: ProjectionInput = {
    snapshot,
    projectionStartDate: snapshot.projectionStartDate,
    horizonDate,
    scenario: "cero",
    scenarioHypotheses: hypotheses,
    fiscalConfig,
    resolution: "monthly",
    // plan_base: only contributions, no sales/rebuys — guarantees CERO floor
    options: { simulationPolicy: "plan_base", projectExtraordinaryContributions: false },
    now,
  };
  return runProjection(input);
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
  const LABELS: Record<string, string> = {
    conservador:   "Conservador",
    moderado:      "Moderado",
    base:          "Base",
    favorable:     "Favorable",
    muy_favorable: "Muy favorable",
    optimista:     "Optimista",
    dinamico:      "Dinámico",
    cero:          "Control 0%",
  };

  const order: Array<keyof ScenarioSet> = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista", "dinamico", "cero",
  ];

  return order.map(s => ({
    scenario:            s as ProjectionScenario,
    label:               LABELS[s] ?? String(s),
    finalGrossWealthEur: set[s].summary.finalGrossWealthEur,
    finalNetWealthEur:   set[s].summary.finalNetWealthEur,
    probability:         set[s].summary.probability,
    confidence:          set[s].summary.confidence,
  }));
}

// Every positive scenario must reach at least the CERO floor (initial + contributions).
export function validateWealthFloor(set: ScenarioSet): WealthFloorViolation[] {
  const floorEur = set.cero.summary.finalGrossWealthEur;
  const positiveScenarios: Array<keyof ScenarioSet> = [
    "conservador", "moderado", "base", "favorable", "muy_favorable", "optimista",
  ];
  const LABELS: Record<string, string> = {
    conservador: "Conservador", moderado: "Moderado", base: "Base",
    favorable: "Favorable", muy_favorable: "Muy favorable", optimista: "Optimista",
  };

  const violations: WealthFloorViolation[] = [];
  for (const s of positiveScenarios) {
    const actual = set[s].summary.finalGrossWealthEur;
    if (actual < floorEur - 1) {
      violations.push({
        scenario: String(s),
        label: LABELS[s] ?? String(s),
        floorEur,
        actualEur: actual,
        deficitEur: Math.round((floorEur - actual) * 100) / 100,
        explanation: `${LABELS[s] ?? s} (${actual.toFixed(0)}€) cae por debajo del suelo mínimo (${floorEur.toFixed(0)}€) — escenario con crecimiento produce menos que 0%`,
      });
    }
  }
  return violations;
}
