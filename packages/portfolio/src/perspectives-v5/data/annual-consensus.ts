import type {
  MarketRegime,
  PerspectivesPricePath,
  PerspectivesScenario,
  PerspectivesSourceEvidence,
} from "../domain/types";

export type ForecastCoverageType = "DIRECT" | "INTERPOLATED" | "MODELED" | "INSUFFICIENT";

export interface VerifiedForecastObservation {
  id: string;
  assetId: string;
  publisher: string;
  sourceId: string;
  targetYear: number;
  priceEur: number;
  finalWeight: number;
  verified: true;
  publishedAt: number;
  expiresAt: number | null;
  methodology: string;
}

export interface AnnualScenarioConsensus {
  assetId: string;
  year: number;
  scenario: PerspectivesScenario;
  priceEur: number;
  coverage: ForecastCoverageType;
  confidence: number;
  sourceIds: string[];
}

const SCENARIOS: PerspectivesScenario[] = ["conservador", "moderado", "base", "favorable", "optimista"];

const SCENARIO_PERCENTILE: Record<PerspectivesScenario, number> = {
  conservador: 0.12,
  moderado: 0.30,
  base: 0.50,
  favorable: 0.70,
  optimista: 0.88,
};

const REGIMES: MarketRegime[] = [
  "ACCUMULATION",
  "EARLY_BULL",
  "BULL_EXPANSION",
  "EUPHORIA",
  "DISTRIBUTION",
  "CORRECTION",
  "BEAR_MARKET",
  "CAPITULATION",
  "EARLY_RECOVERY",
  "LATERAL",
];

function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(startDate: number, endDate: number): number[] {
  const cursor = new Date(startDate);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  const months: number[] = [];
  while (cursor.getTime() <= endDate) {
    months.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function weightedPercentile(values: Array<{ value: number; weight: number }>, percentile: number): number {
  const sorted = values
    .filter((item) => item.value > 0 && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (sorted.length === 0) throw new Error("NO_WEIGHTED_VALUES");
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  const threshold = totalWeight * percentile;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= threshold) return item.value;
  }
  return sorted[sorted.length - 1].value;
}

function interpolate(startPrice: number, endPrice: number, step: number, steps: number): number {
  if (steps <= 0) return endPrice;
  const ratio = step / steps;
  return startPrice * Math.pow(endPrice / startPrice, ratio);
}

function scenarioDampener(scenario: PerspectivesScenario): number {
  switch (scenario) {
    case "conservador": return 0.88;
    case "moderado": return 0.95;
    case "base": return 1;
    case "favorable": return 1.06;
    case "optimista": return 1.12;
  }
}

export function buildAnnualScenarioConsensus(input: {
  observations: VerifiedForecastObservation[];
  assetIds: string[];
  startYear: number;
  endYear: number;
}): AnnualScenarioConsensus[] {
  const output: AnnualScenarioConsensus[] = [];
  for (const assetId of input.assetIds) {
    const assetObservations = input.observations
      .filter((observation) => observation.assetId === assetId && observation.verified && observation.priceEur > 0);
    const independentPublishers = new Set(assetObservations.map((observation) => observation.publisher));
    if (assetObservations.length < 3 || independentPublishers.size < 3) {
      throw new Error(`INSUFFICIENT_FORECAST_OBSERVATIONS:${assetId}`);
    }

    for (let year = input.startYear; year <= input.endYear; year += 1) {
      const direct = assetObservations.filter((observation) => observation.targetYear === year);
      const before = assetObservations.filter((observation) => observation.targetYear < year).sort((a, b) => b.targetYear - a.targetYear)[0];
      const after = assetObservations.filter((observation) => observation.targetYear > year).sort((a, b) => a.targetYear - b.targetYear)[0];
      const latest = assetObservations.slice().sort((a, b) => b.targetYear - a.targetYear)[0];

      for (const scenario of SCENARIOS) {
        let priceEur: number;
        let coverage: ForecastCoverageType;
        let sourceIds: string[];
        let confidence: number;

        if (direct.length >= 3 && new Set(direct.map((observation) => observation.publisher)).size >= 3) {
          priceEur = weightedPercentile(direct.map((observation) => ({
            value: observation.priceEur,
            weight: observation.finalWeight,
          })), SCENARIO_PERCENTILE[scenario]);
          coverage = "DIRECT";
          sourceIds = direct.map((observation) => observation.sourceId);
          confidence = Math.min(1, 0.55 + direct.length * 0.05);
        } else if (before && after) {
          const span = after.targetYear - before.targetYear;
          priceEur = interpolate(before.priceEur, after.priceEur, year - before.targetYear, span) * scenarioDampener(scenario);
          coverage = "INTERPOLATED";
          sourceIds = [before.sourceId, after.sourceId];
          confidence = 0.45;
        } else if (latest && year > latest.targetYear) {
          const yearsAfter = year - latest.targetYear;
          const annualGrowth = 0.02 * scenarioDampener(scenario);
          priceEur = latest.priceEur * Math.pow(1 + annualGrowth, yearsAfter);
          coverage = "MODELED";
          sourceIds = [latest.sourceId];
          confidence = Math.max(0.15, 0.40 - yearsAfter * 0.03);
        } else {
          throw new Error(`INSUFFICIENT_YEAR_COVERAGE:${assetId}:${year}`);
        }

        output.push({ assetId, year, scenario, priceEur, coverage, confidence, sourceIds });
      }
    }
  }
  return output;
}

export function buildMonthlyPricePathFromConsensus(input: {
  assetIds: string[];
  scenario: PerspectivesScenario;
  pathId: string;
  startDate: number;
  endDate: number;
  currentPricesEur: Record<string, number>;
  annualConsensus: AnnualScenarioConsensus[];
  sources: PerspectivesSourceEvidence[];
}): PerspectivesPricePath {
  const months = monthRange(input.startDate, input.endDate);
  const points = months.flatMap((date, monthIndex) => input.assetIds.map((assetId) => {
    const currentPrice = input.currentPricesEur[assetId];
    if (!(currentPrice > 0)) throw new Error(`INVALID_CURRENT_PRICE:${assetId}`);
    const year = new Date(date).getUTCFullYear();
    const anchor = input.annualConsensus.find((item) =>
      item.assetId === assetId && item.scenario === input.scenario && item.year === year
    );
    if (!anchor) throw new Error(`MISSING_ANNUAL_CONSENSUS:${assetId}:${year}:${input.scenario}`);
    const monthsFromStart = monthIndex + 1;
    const totalMonths = Math.max(1, months.length);
    const trendPrice = interpolate(currentPrice, anchor.priceEur, monthsFromStart, totalMonths);
    const cycle = 1 + Math.sin((monthIndex + 1) / 4) * 0.04 + Math.sin((monthIndex + 1) / 11) * 0.025;
    const priceEur = Math.max(0.01, trendPrice * cycle);
    const regime = REGIMES[monthIndex % REGIMES.length];
    return {
      assetId,
      month: monthKey(date),
      pathId: input.pathId,
      priceEur,
      regime,
      coverage: anchor.coverage === "DIRECT" ? "FORECAST_CONDITIONED" as const : "MODEL_CALIBRATED" as const,
      provider: "perspectives-v5-consensus",
      generatedAt: Date.now(),
      confidence: anchor.confidence,
    };
  }));
  return {
    pathId: input.pathId,
    scenarioBand: input.scenario,
    points,
  };
}
