import { validatePriceAndSourceManifest } from "./data/price-manifest";
import type {
  PerspectivesMonthlySnapshot,
  PerspectivesSimulationInput,
  PerspectivesSimulationOutput,
} from "./domain/types";
import { PerspectivesPortfolioLedger } from "./ledger/portfolio-ledger";
import { calculateTwr, calculateXirr } from "./metrics/returns";
import { buildAnnualSnapshots } from "./reports/annual-report";

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
  let cursor = firstDayOfNextUtcMonth(input.now);
  let openingNetWealthEur =
    ledger.marketValue(priceMapForMonth(input, monthKey(cursor))) +
    ledger.operatingEurc +
    ledger.cash;

  while (cursor <= input.horizonDate) {
    const month = monthKey(cursor);
    const pricesByAsset = priceMapForMonth(input, month);
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
    decisions: [],
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
