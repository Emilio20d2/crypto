import { validatePriceAndSourceManifest } from "./data/price-manifest";
import type {
  PerspectivesMonthlySnapshot,
  PerspectivesSimulationInput,
  PerspectivesSimulationOutput,
} from "./domain/types";
import { PerspectivesPortfolioLedger } from "./ledger/portfolio-ledger";
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

function buildSnapshot(params: {
  ledger: PerspectivesPortfolioLedger;
  month: string;
  date: number;
  openingNetWealthEur: number;
  pricesByAsset: Record<string, number>;
  externalContributionsThisMonthEur: number;
  previousCryptoMarketValueEur: number;
}): PerspectivesMonthlySnapshot {
  const cryptoMarketValueEur = params.ledger.marketValue(params.pricesByAsset);
  const openCostBasisEur = params.ledger.openCostBasis();
  const unrealizedGainEur = cryptoMarketValueEur - openCostBasisEur;
  const operatingEurcEur = params.ledger.operatingEurc;
  const fiscalReserveEur = params.ledger.fiscalReserve;
  const cashEur = params.ledger.cash;
  const outstandingTaxLiabilityEur = Math.max(0, fiscalReserveEur);
  const closingGrossWealthEur = cryptoMarketValueEur + operatingEurcEur + fiscalReserveEur + cashEur;
  const closingNetWealthEur = closingGrossWealthEur - outstandingTaxLiabilityEur;
  const costsThisMonthEur = params.ledger.entries
    .filter((entry) => monthKey(entry.date) === params.month)
    .reduce((sum, entry) => sum + entry.costsEur, 0);
  const marketResultThisMonthEur = cryptoMarketValueEur - params.previousCryptoMarketValueEur;
  const netProfitEur = closingNetWealthEur - params.ledger.externalCapital;

  return {
    month: params.month,
    date: params.date,
    openingNetWealthEur: params.openingNetWealthEur,
    closingGrossWealthEur,
    closingNetWealthEur,
    cryptoMarketValueEur,
    operatingEurcEur,
    fiscalReserveEur,
    cashEur,
    outstandingTaxLiabilityEur,
    externalCapitalCumulativeEur: params.ledger.externalCapital,
    internalRebuyCapitalCumulativeEur: params.ledger.internalRebuyCapital,
    internalReallocationCapitalCumulativeEur: params.ledger.internalReallocationCapital,
    totalCapitalDeployedCumulativeEur: params.ledger.totalCapitalDeployed,
    realizedGainCumulativeEur: params.ledger.realizedGain,
    unrealizedGainEur,
    netProfitEur,
    externalContributionsThisMonthEur: params.externalContributionsThisMonthEur,
    marketResultThisMonthEur,
    costsThisMonthEur,
    taxesPaidThisMonthEur: 0,
    externalWithdrawalsThisMonthEur: 0,
    reconciliationDiffEur: 0,
    lotIdsOpen: params.ledger.openLots.map((lot) => lot.id),
    eurcBucketIdsOpen: params.ledger.openBuckets.map((bucket) => bucket.id),
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
  let cursor = firstDayOfNextUtcMonth(input.now);
  let openingNetWealthEur =
    ledger.marketValue(priceMapForMonth(input, monthKey(cursor))) +
    ledger.operatingEurc +
    ledger.cash;
  let previousCryptoMarketValueEur = ledger.marketValue(priceMapForMonth(input, monthKey(cursor)));

  while (cursor <= input.horizonDate) {
    const month = monthKey(cursor);
    const pricesByAsset = priceMapForMonth(input, month);
    const contributions = input.monthlyContributions.filter((contribution) => monthKey(contribution.date) === month);
    for (const contribution of contributions) {
      ledger.buyFromExternalContribution(contribution, pricesByAsset[contribution.assetId]);
    }

    const snapshot = buildSnapshot({
      ledger,
      month,
      date: cursor,
      openingNetWealthEur,
      pricesByAsset,
      externalContributionsThisMonthEur: sumContributions(input, month),
      previousCryptoMarketValueEur,
    });
    monthlySnapshots.push(snapshot);
    ledger.monthlySnapshots.push(snapshot);
    openingNetWealthEur = snapshot.closingNetWealthEur;
    previousCryptoMarketValueEur = snapshot.cryptoMarketValueEur;
    ledger.incrementUndeployedBuckets();
    cursor = addUtcMonths(cursor, 1);
  }

  const annualSnapshots = buildAnnualSnapshots({ monthlySnapshots, ledger: ledger.entries });
  const final = monthlySnapshots.at(-1);
  const validationErrors = ledger.validate();

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
    validationErrors,
  };
}
