import { validatePriceAndSourceManifest } from "./data/price-manifest";
import type {
  PerspectivesPricePoint,
  PerspectivesMonthlySnapshot,
  PerspectivesSimulationInput,
  PerspectivesSimulationOutput,
  PerspectivesStrategyDecision,
} from "./domain/types";
import { PerspectivesPortfolioLedger } from "./ledger/portfolio-ledger";
import { calculateTwr, calculateXirr } from "./metrics/returns";
import { buildAnnualSnapshots } from "./reports/annual-report";
import {
  evaluatePartialSaleAlternatives,
  evaluateRebuyAlternatives,
  rebuyFractionFromAction,
  saleFractionFromAction,
  type MonthlyMarketDecisionSignal,
} from "./strategy/decision-engine";

function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function firstDayOfNextUtcMonth(date: number): number {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function addUtcMonths(date: number, months: number): number {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

function priceMapForMonth(input: PerspectivesSimulationInput, month: string): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const point of input.path.points) {
    if (point.month !== month) continue;
    if (!(point.priceEur > 0) || point.coverage === "INVALID") {
      throw new Error(`INVALID_PRICE_PATH:${point.assetId}:${month}`);
    }
    prices[point.assetId] = point.priceEur;
  }
  return prices;
}

function pricePointForMonth(input: PerspectivesSimulationInput, month: string, assetId: string): PerspectivesPricePoint {
  const point = input.path.points.find((candidate) => candidate.month === month && candidate.assetId === assetId);
  if (!point || !(point.priceEur > 0) || point.coverage === "INVALID") {
    throw new Error(`INVALID_PRICE_PATH:${assetId}:${month}`);
  }
  return point;
}

function requiredAssetIds(input: PerspectivesSimulationInput): string[] {
  return [
    ...new Set([
      ...input.initialPositions.map((position) => position.assetId),
      ...input.monthlyContributions.map((contribution) => contribution.assetId),
    ]),
  ].sort();
}

function sumContributions(input: PerspectivesSimulationInput, month: string): number {
  return input.monthlyContributions
    .filter((contribution) => monthKey(contribution.date) === month)
    .reduce((sum, contribution) => sum + contribution.amountEur, 0);
}

function netWealth(ledger: PerspectivesPortfolioLedger, pricesByAsset: Record<string, number>): number {
  const cryptoMarketValueEur = ledger.marketValue(pricesByAsset);
  const closingGrossWealthEur = cryptoMarketValueEur + ledger.operatingEurc + ledger.fiscalReserve + ledger.cash;
  return closingGrossWealthEur - Math.max(0, ledger.fiscalReserve);
}

function costsForMonth(ledger: PerspectivesPortfolioLedger, month: string): number {
  return ledger.entries
    .filter((entry) => monthKey(entry.date) === month)
    .reduce((sum, entry) => sum + entry.costsEur, 0);
}

function openAverageCostForAsset(ledger: PerspectivesPortfolioLedger, assetId: string): number | null {
  const lots = ledger.openLots.filter((lot) => lot.assetId === assetId);
  const units = lots.reduce((sum, lot) => sum + lot.unitsOpen, 0);
  if (units <= 1e-12) return null;
  const costBasis = lots.reduce((sum, lot) => {
    const ratio = lot.unitsAcquired > 0 ? lot.unitsOpen / lot.unitsAcquired : 0;
    return sum + lot.costBasisEur * ratio;
  }, 0);
  return costBasis / units;
}

function signalForPoint(input: PerspectivesSimulationInput, point: PerspectivesPricePoint): MonthlyMarketDecisionSignal {
  const activeSources = input.sources.filter(
    (source) => source.usedInEngine && source.assetIds.includes(point.assetId),
  );
  const independentPublisherCount = new Set(activeSources.map((source) => source.independentPublicationId ?? source.publisher)).size;
  const profile = (() => {
    switch (point.regime) {
      case "EUPHORIA":
        return { expectedReturn12m: -0.18, downsideProbability12m: 0.74, expectedDownsideDepth: 0.34, stabilizationProbability: 0.58, volatility12m: 0.72 };
      case "DISTRIBUTION":
        return { expectedReturn12m: -0.10, downsideProbability12m: 0.66, expectedDownsideDepth: 0.28, stabilizationProbability: 0.52, volatility12m: 0.64 };
      case "CORRECTION":
        return { expectedReturn12m: -0.03, downsideProbability12m: 0.58, expectedDownsideDepth: 0.22, stabilizationProbability: 0.42, volatility12m: 0.56 };
      case "BULL_EXPANSION":
        return { expectedReturn12m: 0.18, downsideProbability12m: 0.36, expectedDownsideDepth: 0.16, stabilizationProbability: 0.38, volatility12m: 0.48 };
      case "BEAR_MARKET":
      case "CAPITULATION":
        return { expectedReturn12m: 0.08, downsideProbability12m: 0.44, expectedDownsideDepth: 0.24, stabilizationProbability: 0.34, volatility12m: 0.68 };
      case "EARLY_RECOVERY":
        return { expectedReturn12m: 0.16, downsideProbability12m: 0.24, expectedDownsideDepth: 0.12, stabilizationProbability: 0.64, volatility12m: 0.52 };
      default:
        return { expectedReturn12m: 0.05, downsideProbability12m: 0.30, expectedDownsideDepth: 0.12, stabilizationProbability: 0.34, volatility12m: 0.42 };
    }
  })();
  return {
    assetId: point.assetId,
    month: point.month,
    regime: point.regime,
    ...profile,
    confidence: Math.min(1, point.confidence),
    sourceCount: activeSources.length,
    independentPublisherCount,
  };
}

export function runPerspectivesV5Simulation(input: PerspectivesSimulationInput): PerspectivesSimulationOutput {
  const assets = requiredAssetIds(input);
  const validation = validatePriceAndSourceManifest({
    path: input.path,
    requiredAssetIds: assets,
    startDate: input.now,
    endDate: input.horizonDate,
    sources: input.sources,
  });
  if (!validation.valid) {
    throw new Error(validation.errors.join(";"));
  }

  const ledger = new PerspectivesPortfolioLedger(input);
  const monthlySnapshots: PerspectivesMonthlySnapshot[] = [];
  const decisions: PerspectivesStrategyDecision[] = [];
  let cursor = firstDayOfNextUtcMonth(input.now);
  let openingNetWealthEur =
    ledger.marketValue(priceMapForMonth(input, monthKey(cursor))) +
    ledger.operatingEurc +
    ledger.cash;

  while (cursor <= input.horizonDate) {
    const month = monthKey(cursor);
    const pricesByAsset = priceMapForMonth(input, month);

    if (input.strategyMode !== "PASSIVE") {
      for (const assetId of requiredAssetIds(input)) {
        const openLots = ledger.openLots.filter((lot) => lot.assetId === assetId);
        if (openLots.length === 0) continue;
        if (ledger.profitHarvestCycles.some((cycle) => cycle.assetId === assetId && cycle.status === "OPEN")) {
          continue;
        }
        const point = pricePointForMonth(input, month, assetId);
        const totalPortfolioValueEur = ledger.marketValue(pricesByAsset) + ledger.operatingEurc + ledger.cash;
        const portfolioAssetValueEur = openLots.reduce((sum, lot) => sum + lot.unitsOpen * point.priceEur, 0);
        const decision = evaluatePartialSaleAlternatives({
          id: `sale-decision-${input.path.pathId}-${assetId}-${month}`,
          date: cursor,
          assetId,
          currentPriceEur: point.priceEur,
          openLots,
          portfolioAssetValueEur,
          totalPortfolioValueEur,
          commissionRate: input.commissionRate,
          estimatedTaxRate: input.taxBands[0]?.rate ?? 0,
          minimumUnrealizedGainPct: 0.25,
          signal: signalForPoint(input, point),
        });
        decisions.push(decision);
        const fraction = saleFractionFromAction(decision.selectedAction);
        if (fraction != null) {
          ledger.executePartialSale({
            date: cursor,
            assetId,
            fraction,
            priceEur: point.priceEur,
            description: decision.selectedReason,
          });
        }
      }

      for (const bucket of ledger.openBuckets) {
        const cycle = ledger.profitHarvestCycles.find((candidate) => candidate.id === bucket.profitHarvestCycleId);
        if (!cycle || !cycle.capitalRecovered || bucket.sourceAssetId !== cycle.assetId) continue;
        const point = pricePointForMonth(input, month, bucket.sourceAssetId);
        const openAverageCost = openAverageCostForAsset(ledger, bucket.sourceAssetId);
        if (openAverageCost == null) continue;
        const maximumRebuyPrice = Math.min(openAverageCost, cycle.salePriceEur);
        if (point.priceEur >= maximumRebuyPrice) continue;
        const decision = evaluateRebuyAlternatives({
          id: `rebuy-decision-${input.path.pathId}-${bucket.id}-${month}`,
          date: cursor,
          bucket,
          currentPriceEur: point.priceEur,
          commissionRate: input.commissionRate,
          signal: signalForPoint(input, point),
        });
        decisions.push(decision);
        const fraction = rebuyFractionFromAction(decision.selectedAction);
        if (fraction != null) {
          ledger.executeRebuy({
            date: cursor,
            eurcBucketId: bucket.id,
            fraction,
            priceEur: point.priceEur,
            maximumPriceEur: maximumRebuyPrice,
            description: decision.selectedReason,
          });
        }
      }
    }

    const contributions = input.monthlyContributions.filter((contribution) => monthKey(contribution.date) === month);
    for (const contribution of contributions) {
      ledger.buyFromExternalContribution(contribution, pricesByAsset[contribution.assetId]);
    }

    const externalContributionsThisMonthEur = sumContributions(input, month);
    const costsThisMonthEur = costsForMonth(ledger, month);
    const closingNetWealthEur = netWealth(ledger, pricesByAsset);
    const marketResultThisMonthEur =
      closingNetWealthEur - openingNetWealthEur - externalContributionsThisMonthEur + costsThisMonthEur;

    const snapshot = ledger.closeMonth({
      date: cursor,
      pricesByAsset,
      openingNetWealthEur,
      externalContributionsThisMonthEur,
      marketResultThisMonthEur,
      taxesPaidThisMonthEur: 0,
      externalWithdrawalsThisMonthEur: 0,
    });
    monthlySnapshots.push(snapshot);
    openingNetWealthEur = snapshot.closingNetWealthEur;
    ledger.incrementUndeployedBuckets();
    cursor = addUtcMonths(cursor, 1);
  }

  const annualSnapshots = buildAnnualSnapshots({ monthlySnapshots, ledger: ledger.entries });
  const final = monthlySnapshots.at(-1);
  const validationErrors = ledger.validate();
  const twr = calculateTwr({ monthlySnapshots });
  const externalFlows = [
    ...input.initialPositions.map((position) => ({
      date: position.acquiredAt,
      amountEur: -(position.units * position.purchasePriceEur + position.acquisitionCostsEur),
    })),
    ...ledger.entries
      .filter((entry) => entry.type === "EXTERNAL_CONTRIBUTION")
      .map((entry) => ({ date: entry.date, amountEur: -entry.grossAmountEur })),
    final ? { date: final.date, amountEur: final.closingNetWealthEur } : null,
  ].filter((flow): flow is { date: number; amountEur: number } => flow !== null);
  const xirr = calculateXirr(externalFlows);

  return {
    engineVersion: "perspectives-v5",
    generatedAt: Date.now(),
    scenario: input.scenario,
    strategyMode: input.strategyMode,
    pathId: input.path.pathId,
    sourceManifest: input.sources,
    ledger: ledger.entries,
    lots: ledger.lots,
    eurcBuckets: ledger.eurcBuckets,
    profitHarvestCycles: ledger.profitHarvestCycles,
    decisions,
    monthlySnapshots,
    annualSnapshots,
    finalGrossWealthEur: final?.closingGrossWealthEur ?? 0,
    finalNetWealthEur: final?.closingNetWealthEur ?? 0,
    externalCapitalEur: ledger.externalCapital,
    internalRebuyCapitalEur: ledger.internalRebuyCapital,
    internalReallocationCapitalEur: ledger.internalReallocationCapital,
    totalCapitalDeployedEur: ledger.totalCapitalDeployed,
    realizedGainEur: ledger.realizedGain,
    unrealizedGainEur: final?.unrealizedGainEur ?? 0,
    netProfitEur: final?.netProfitEur ?? 0,
    twrCumulative: twr.cumulative,
    twrAnnualized: twr.annualized,
    xirr,
    validationErrors,
  };
}
