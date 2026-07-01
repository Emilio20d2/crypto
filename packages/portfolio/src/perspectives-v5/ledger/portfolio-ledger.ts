import type {
  PerspectivesEurcBucket,
  PerspectivesInitialPosition,
  PerspectivesLedgerEntry,
  PerspectivesLot,
  PerspectivesMonthlyContribution,
  PerspectivesMonthlySnapshot,
  PerspectivesProfitHarvestCycle,
  PerspectivesSimulationInput,
  PerspectivesTaxBand,
} from "../domain/types";

const EPSILON = 0.01;

function uid(prefix: string, sequence: number): string {
  return `${prefix}-${sequence.toString().padStart(6, "0")}`;
}

function monthKey(date: number): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function taxForGain(gainEur: number, bands: PerspectivesTaxBand[]): number {
  if (gainEur <= 0) return 0;
  let remaining = gainEur;
  let previousLimit = 0;
  let tax = 0;
  for (const band of bands) {
    const bandCapacity = band.upToEur == null ? Number.POSITIVE_INFINITY : Math.max(0, band.upToEur - previousLimit);
    const taxable = Math.min(remaining, bandCapacity);
    tax += taxable * band.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
    if (band.upToEur != null) previousLimit = band.upToEur;
  }
  return tax;
}

export interface PartialSaleCommand {
  date: number;
  assetId: string;
  fraction: number;
  priceEur: number;
  description: string;
}

export interface RebuyCommand {
  date: number;
  eurcBucketId: string;
  fraction: number;
  priceEur: number;
  description: string;
}

export interface LedgerCloseInput {
  date: number;
  pricesByAsset: Record<string, number>;
  openingNetWealthEur: number;
  externalContributionsThisMonthEur: number;
  marketResultThisMonthEur: number;
  taxesPaidThisMonthEur?: number;
  externalWithdrawalsThisMonthEur?: number;
}

interface TaxYearState {
  realizedGainEur: number;
  taxLiabilityEur: number;
  taxPaidEur: number;
}

export class PerspectivesPortfolioLedger {
  readonly lots: PerspectivesLot[] = [];
  readonly eurcBuckets: PerspectivesEurcBucket[] = [];
  readonly profitHarvestCycles: PerspectivesProfitHarvestCycle[] = [];
  readonly entries: PerspectivesLedgerEntry[] = [];
  readonly monthlySnapshots: PerspectivesMonthlySnapshot[] = [];

  private operatingEurcEur: number;
  private fiscalReserveEur: number;
  private cashEur: number;
  private externalCapitalEur: number;
  private internalRebuyCapitalEur = 0;
  private internalReallocationCapitalEur = 0;
  private realizedGainEur = 0;
  private externalWithdrawalsEur = 0;
  private sequence = 0;
  private taxByYear = new Map<number, TaxYearState>();

  constructor(private readonly input: PerspectivesSimulationInput) {
    this.operatingEurcEur = input.initialOperatingEurcEur;
    this.fiscalReserveEur = input.initialFiscalReserveEur;
    this.cashEur = input.initialCashEur;
    this.externalCapitalEur = input.historicalExternalCapitalEur;
    for (const position of input.initialPositions) this.addInitialPosition(position);
  }

  get externalCapital(): number {
    return this.externalCapitalEur;
  }

  get internalRebuyCapital(): number {
    return this.internalRebuyCapitalEur;
  }

  get internalReallocationCapital(): number {
    return this.internalReallocationCapitalEur;
  }

  get totalCapitalDeployed(): number {
    const externalPurchases = this.entries
      .filter((entry) => entry.type === "PLAN_PURCHASE")
      .reduce((sum, entry) => sum + entry.grossAmountEur, 0);
    return externalPurchases + this.internalRebuyCapitalEur + this.internalReallocationCapitalEur;
  }

  get operatingEurc(): number {
    return this.operatingEurcEur;
  }

  get fiscalReserve(): number {
    return this.fiscalReserveEur;
  }

  get cash(): number {
    return this.cashEur;
  }

  get realizedGain(): number {
    return this.realizedGainEur;
  }

  get openLots(): PerspectivesLot[] {
    return this.lots.filter((lot) => lot.unitsOpen > 1e-12);
  }

  get openBuckets(): PerspectivesEurcBucket[] {
    return this.eurcBuckets.filter((bucket) => bucket.availableEur > EPSILON);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return uid(prefix, this.sequence);
  }

  private addInitialPosition(position: PerspectivesInitialPosition): void {
    const grossPurchaseEur = position.units * position.purchasePriceEur;
    const lot: PerspectivesLot = {
      id: position.lotId,
      assetId: position.assetId,
      acquiredAt: position.acquiredAt,
      fundingOrigin: "INITIAL_POSITION",
      sourceTransactionId: position.lotId,
      sourceEurcBucketId: null,
      profitHarvestCycleId: null,
      unitsAcquired: position.units,
      unitsOpen: position.units,
      unitsSold: 0,
      purchasePriceEur: position.purchasePriceEur,
      grossPurchaseEur,
      acquisitionCostsEur: position.acquisitionCostsEur,
      costBasisEur: grossPurchaseEur + position.acquisitionCostsEur,
    };
    this.lots.push(lot);
    this.entries.push({
      id: this.nextId("entry"),
      date: position.acquiredAt,
      type: "INITIAL_POSITION",
      assetId: position.assetId,
      lotId: lot.id,
      eurcBucketId: null,
      profitHarvestCycleId: null,
      externalCashEur: 0,
      operatingEurcEur: 0,
      fiscalReserveEur: 0,
      assetUnits: position.units,
      priceEur: position.purchasePriceEur,
      grossAmountEur: grossPurchaseEur,
      costsEur: position.acquisitionCostsEur,
      realizedGainEur: 0,
      description: `Posición inicial ${position.assetId}`,
    });
  }

  buyFromExternalContribution(contribution: PerspectivesMonthlyContribution, priceEur: number): PerspectivesLot {
    if (!(priceEur > 0)) throw new Error(`INVALID_PRICE_PATH:${contribution.assetId}:${monthKey(contribution.date)}`);
    if (!(contribution.amountEur > 0)) throw new Error(`INVALID_CONTRIBUTION:${contribution.id}`);

    const costsEur = contribution.amountEur * this.input.commissionRate;
    const netPurchaseEur = contribution.amountEur - costsEur;
    const units = netPurchaseEur / priceEur;
    const lotId = this.nextId(`lot-plan-${contribution.assetId}`);
    const lot: PerspectivesLot = {
      id: lotId,
      assetId: contribution.assetId,
      acquiredAt: contribution.date,
      fundingOrigin: "EXTERNAL_CONTRIBUTION",
      sourceTransactionId: contribution.id,
      sourceEurcBucketId: null,
      profitHarvestCycleId: null,
      unitsAcquired: units,
      unitsOpen: units,
      unitsSold: 0,
      purchasePriceEur: priceEur,
      grossPurchaseEur: netPurchaseEur,
      acquisitionCostsEur: costsEur,
      costBasisEur: contribution.amountEur,
    };

    this.externalCapitalEur += contribution.amountEur;
    this.lots.push(lot);
    this.entries.push({
      id: this.nextId("entry"),
      date: contribution.date,
      type: "EXTERNAL_CONTRIBUTION",
      assetId: contribution.assetId,
      lotId: null,
      eurcBucketId: null,
      profitHarvestCycleId: null,
      externalCashEur: contribution.amountEur,
      operatingEurcEur: 0,
      fiscalReserveEur: 0,
      assetUnits: 0,
      priceEur: null,
      grossAmountEur: contribution.amountEur,
      costsEur: 0,
      realizedGainEur: 0,
      description: `Aportación externa ${contribution.assetId}`,
    });
    this.entries.push({
      id: this.nextId("entry"),
      date: contribution.date,
      type: "PLAN_PURCHASE",
      assetId: contribution.assetId,
      lotId,
      eurcBucketId: null,
      profitHarvestCycleId: null,
      externalCashEur: -contribution.amountEur,
      operatingEurcEur: 0,
      fiscalReserveEur: 0,
      assetUnits: units,
      priceEur,
      grossAmountEur: contribution.amountEur,
      costsEur,
      realizedGainEur: 0,
      description: `Compra del Plan ${contribution.assetId}`,
    });
    return lot;
  }

  executePartialSale(command: PartialSaleCommand): PerspectivesEurcBucket {
    if (!(command.priceEur > 0)) throw new Error(`INVALID_SALE_PRICE:${command.assetId}`);
    if (!(command.fraction > 0 && command.fraction < 1)) throw new Error(`INVALID_SALE_FRACTION:${command.fraction}`);

    const assetLots = this.openLots
      .filter((lot) => lot.assetId === command.assetId)
      .sort((a, b) => a.acquiredAt - b.acquiredAt);
    const availableUnits = assetLots.reduce((sum, lot) => sum + lot.unitsOpen, 0);
    const unitsToSell = availableUnits * command.fraction;
    if (unitsToSell <= 1e-12) throw new Error(`NO_UNITS_TO_SELL:${command.assetId}`);

    let remaining = unitsToSell;
    let soldCostBasisEur = 0;
    for (const lot of assetLots) {
      if (remaining <= 1e-12) break;
      const units = Math.min(lot.unitsOpen, remaining);
      const costPerOpenUnit = lot.unitsAcquired > 0 ? lot.costBasisEur / lot.unitsAcquired : 0;
      soldCostBasisEur += units * costPerOpenUnit;
      lot.unitsOpen -= units;
      lot.unitsSold += units;
      remaining -= units;
    }
    if (remaining > 1e-8) throw new Error(`FIFO_UNDERFLOW:${command.assetId}:${remaining}`);

    const grossSaleProceedsEur = unitsToSell * command.priceEur;
    const saleCostsEur = grossSaleProceedsEur * this.input.commissionRate;
    const netBeforeTaxEur = grossSaleProceedsEur - saleCostsEur;
    const realizedGainEur = netBeforeTaxEur - soldCostBasisEur;
    const year = new Date(command.date).getUTCFullYear();
    const previousTaxState = this.taxByYear.get(year) ?? { realizedGainEur: 0, taxLiabilityEur: 0, taxPaidEur: 0 };
    const beforeTax = taxForGain(Math.max(0, previousTaxState.realizedGainEur), this.input.taxBands);
    const afterRealizedGain = previousTaxState.realizedGainEur + realizedGainEur;
    const afterTax = taxForGain(Math.max(0, afterRealizedGain), this.input.taxBands);
    const incrementalTaxEur = Math.max(0, afterTax - beforeTax);
    this.taxByYear.set(year, {
      realizedGainEur: afterRealizedGain,
      taxLiabilityEur: afterTax,
      taxPaidEur: previousTaxState.taxPaidEur,
    });

    const operatingPrincipalEur = Math.max(0, netBeforeTaxEur - incrementalTaxEur);
    const cycleId = this.nextId(`harvest-${command.assetId}`);
    const bucketId = this.nextId(`eurc-${command.assetId}`);
    const saleTransactionId = this.nextId(`sale-${command.assetId}`);
    const bucket: PerspectivesEurcBucket = {
      id: bucketId,
      profitHarvestCycleId: cycleId,
      sourceSaleTransactionId: saleTransactionId,
      sourceAssetId: command.assetId,
      openedAt: command.date,
      grossSaleProceedsEur,
      soldCostBasisEur,
      realizedGainEur,
      saleCostsEur,
      fiscalReserveEur: incrementalTaxEur,
      operatingPrincipalEur,
      availableEur: operatingPrincipalEur,
      consumedEur: 0,
      withdrawnEur: 0,
      monthsUndeployed: 0,
      status: "AVAILABLE",
    };
    const cycle: PerspectivesProfitHarvestCycle = {
      id: cycleId,
      assetId: command.assetId,
      openedAt: command.date,
      saleTransactionId,
      soldUnits: unitsToSell,
      salePriceEur: command.priceEur,
      soldCostBasisEur,
      grossSaleProceedsEur,
      realizedGainEur,
      saleCostsEur,
      fiscalReserveEur: incrementalTaxEur,
      eurcBucketId: bucketId,
      rebuyLotIds: [],
      reboughtUnits: 0,
      additionalUnits: 0,
      status: "OPEN",
    };

    this.realizedGainEur += realizedGainEur;
    this.operatingEurcEur += operatingPrincipalEur;
    this.fiscalReserveEur += incrementalTaxEur;
    this.eurcBuckets.push(bucket);
    this.profitHarvestCycles.push(cycle);
    this.entries.push({
      id: saleTransactionId,
      date: command.date,
      type: "PARTIAL_SALE",
      assetId: command.assetId,
      lotId: null,
      eurcBucketId: bucketId,
      profitHarvestCycleId: cycleId,
      externalCashEur: 0,
      operatingEurcEur: operatingPrincipalEur,
      fiscalReserveEur: incrementalTaxEur,
      assetUnits: -unitsToSell,
      priceEur: command.priceEur,
      grossAmountEur: grossSaleProceedsEur,
      costsEur: saleCostsEur,
      realizedGainEur,
      description: command.description,
    });
    return bucket;
  }

  executeRebuy(command: RebuyCommand): PerspectivesLot {
    if (!(command.priceEur > 0)) throw new Error(`INVALID_REBUY_PRICE:${command.eurcBucketId}`);
    if (!(command.fraction > 0 && command.fraction <= 1)) throw new Error(`INVALID_REBUY_FRACTION:${command.fraction}`);

    const bucket = this.eurcBuckets.find((candidate) => candidate.id === command.eurcBucketId);
    if (!bucket) throw new Error(`EURC_BUCKET_NOT_FOUND:${command.eurcBucketId}`);
    if (bucket.availableEur <= EPSILON) throw new Error(`EURC_BUCKET_EMPTY:${command.eurcBucketId}`);
    const cycle = this.profitHarvestCycles.find((candidate) => candidate.id === bucket.profitHarvestCycleId);
    if (!cycle) throw new Error(`HARVEST_CYCLE_NOT_FOUND:${bucket.profitHarvestCycleId}`);

    const principalEur = bucket.availableEur * command.fraction;
    const costsEur = principalEur * this.input.commissionRate;
    const netPurchaseEur = principalEur - costsEur;
    const units = netPurchaseEur / command.priceEur;
    const lotId = this.nextId(`lot-rebuy-${bucket.sourceAssetId}`);
    const transactionId = this.nextId(`rebuy-${bucket.sourceAssetId}`);
    const lot: PerspectivesLot = {
      id: lotId,
      assetId: bucket.sourceAssetId,
      acquiredAt: command.date,
      fundingOrigin: "INTERNAL_REBUY",
      sourceTransactionId: transactionId,
      sourceEurcBucketId: bucket.id,
      profitHarvestCycleId: cycle.id,
      unitsAcquired: units,
      unitsOpen: units,
      unitsSold: 0,
      purchasePriceEur: command.priceEur,
      grossPurchaseEur: netPurchaseEur,
      acquisitionCostsEur: costsEur,
      costBasisEur: principalEur,
    };

    bucket.availableEur -= principalEur;
    bucket.consumedEur += principalEur;
    bucket.status = bucket.availableEur <= EPSILON ? "FULLY_USED" : "PARTIALLY_USED";
    cycle.rebuyLotIds.push(lotId);
    cycle.reboughtUnits += units;
    cycle.additionalUnits = cycle.reboughtUnits - cycle.soldUnits;
    cycle.status = bucket.status === "FULLY_USED" ? "FULLY_REBOUGHT" : "PARTIALLY_REBOUGHT";
    this.operatingEurcEur -= principalEur;
    this.internalRebuyCapitalEur += principalEur;
    this.lots.push(lot);
    this.entries.push({
      id: transactionId,
      date: command.date,
      type: "INTERNAL_REBUY",
      assetId: bucket.sourceAssetId,
      lotId,
      eurcBucketId: bucket.id,
      profitHarvestCycleId: cycle.id,
      externalCashEur: 0,
      operatingEurcEur: -principalEur,
      fiscalReserveEur: 0,
      assetUnits: units,
      priceEur: command.priceEur,
      grossAmountEur: principalEur,
      costsEur,
      realizedGainEur: 0,
      description: command.description,
    });
    return lot;
  }

  incrementUndeployedBuckets(): void {
    for (const bucket of this.openBuckets) bucket.monthsUndeployed += 1;
  }

  marketValue(pricesByAsset: Record<string, number>): number {
    return this.openLots.reduce((sum, lot) => {
      const price = pricesByAsset[lot.assetId];
      if (!(price > 0)) throw new Error(`INVALID_PRICE_PATH:${lot.assetId}`);
      return sum + lot.unitsOpen * price;
    }, 0);
  }

  openCostBasis(): number {
    return this.openLots.reduce((sum, lot) => {
      const ratio = lot.unitsAcquired > 0 ? lot.unitsOpen / lot.unitsAcquired : 0;
      return sum + lot.costBasisEur * ratio;
    }, 0);
  }

  closeMonth(close: LedgerCloseInput): PerspectivesMonthlySnapshot {
    const cryptoMarketValueEur = this.marketValue(close.pricesByAsset);
    const openCostBasisEur = this.openCostBasis();
    const unrealizedGainEur = cryptoMarketValueEur - openCostBasisEur;
    const outstandingTaxLiabilityEur = Math.max(0, this.fiscalReserveEur);
    const closingGrossWealthEur = cryptoMarketValueEur + this.operatingEurcEur + this.fiscalReserveEur + this.cashEur;
    const closingNetWealthEur = closingGrossWealthEur - outstandingTaxLiabilityEur;
    const externalWithdrawalsThisMonthEur = close.externalWithdrawalsThisMonthEur ?? 0;
    this.externalWithdrawalsEur += externalWithdrawalsThisMonthEur;
    const expectedClosing =
      close.openingNetWealthEur +
      close.externalContributionsThisMonthEur +
      close.marketResultThisMonthEur -
      close.taxesPaidThisMonthEur! -
      externalWithdrawalsThisMonthEur;
    const costsThisMonthEur = this.entries
      .filter((entry) => monthKey(entry.date) === monthKey(close.date))
      .reduce((sum, entry) => sum + entry.costsEur, 0);
    const expectedClosingAfterCosts = expectedClosing - costsThisMonthEur;
    const reconciliationDiffEur = closingNetWealthEur - expectedClosingAfterCosts;
    const netProfitEur = closingNetWealthEur + this.externalWithdrawalsEur - this.externalCapitalEur;

    const snapshot: PerspectivesMonthlySnapshot = {
      month: monthKey(close.date),
      date: close.date,
      openingNetWealthEur: close.openingNetWealthEur,
      closingGrossWealthEur,
      closingNetWealthEur,
      cryptoMarketValueEur,
      operatingEurcEur: this.operatingEurcEur,
      fiscalReserveEur: this.fiscalReserveEur,
      cashEur: this.cashEur,
      outstandingTaxLiabilityEur,
      externalCapitalCumulativeEur: this.externalCapitalEur,
      internalRebuyCapitalCumulativeEur: this.internalRebuyCapitalEur,
      internalReallocationCapitalCumulativeEur: this.internalReallocationCapitalEur,
      totalCapitalDeployedCumulativeEur: this.totalCapitalDeployed,
      realizedGainCumulativeEur: this.realizedGainEur,
      unrealizedGainEur,
      netProfitEur,
      externalContributionsThisMonthEur: close.externalContributionsThisMonthEur,
      marketResultThisMonthEur: close.marketResultThisMonthEur,
      costsThisMonthEur,
      taxesPaidThisMonthEur: close.taxesPaidThisMonthEur ?? 0,
      externalWithdrawalsThisMonthEur,
      reconciliationDiffEur,
      lotIdsOpen: this.openLots.map((lot) => lot.id),
      eurcBucketIdsOpen: this.openBuckets.map((bucket) => bucket.id),
    };
    this.monthlySnapshots.push(snapshot);
    return snapshot;
  }

  validate(): string[] {
    const errors: string[] = [];
    for (const lot of this.lots) {
      if (lot.unitsOpen < -1e-10) errors.push(`NEGATIVE_OPEN_UNITS:${lot.id}`);
      if (Math.abs(lot.unitsAcquired - lot.unitsOpen - lot.unitsSold) > 1e-8) {
        errors.push(`LOT_UNIT_RECONCILIATION:${lot.id}`);
      }
    }
    for (const bucket of this.eurcBuckets) {
      const diff = bucket.operatingPrincipalEur - bucket.availableEur - bucket.consumedEur - bucket.withdrawnEur;
      if (Math.abs(diff) > EPSILON) errors.push(`EURC_BUCKET_RECONCILIATION:${bucket.id}:${diff}`);
    }
    for (let index = 1; index < this.monthlySnapshots.length; index += 1) {
      const previous = this.monthlySnapshots[index - 1];
      const current = this.monthlySnapshots[index];
      const diff = current.openingNetWealthEur - previous.closingNetWealthEur;
      if (Math.abs(diff) > EPSILON) errors.push(`MONTHLY_CONTINUITY:${current.month}:${diff}`);
    }
    for (const snapshot of this.monthlySnapshots) {
      if (Math.abs(snapshot.reconciliationDiffEur) > EPSILON) {
        errors.push(`MONTHLY_RECONCILIATION:${snapshot.month}:${snapshot.reconciliationDiffEur}`);
      }
    }
    return errors;
  }
}
