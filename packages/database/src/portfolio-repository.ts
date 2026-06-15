import { PortfolioRepository, TransactionInput, TransactionLegInput, TransactionType, LegType, FifoLot, LotConsumption, RealizedGain } from "@crypto-control/portfolio";
import { getDb } from "./db";
import { transactions, transactionLegs, fees, lots, lotConsumptions, realizedGains, accounts } from "./schema";

export class DatabasePortfolioRepository implements PortfolioRepository {
  constructor(private db: ReturnType<typeof getDb>) {}

  async getTransactions(): Promise<TransactionInput[]> {
    const allTxs = await this.db.select().from(transactions);
    const allLegs = await this.db.select().from(transactionLegs);
    const allFees = await this.db.select().from(fees);

    type TxType = typeof transactions.$inferSelect;
    type LegTypeRecord = typeof transactionLegs.$inferSelect;
    type FeeRecord = typeof fees.$inferSelect;

    const legsByTxId = allLegs.reduce((acc: Record<string, TransactionLegInput[]>, leg: LegTypeRecord) => {
      if (!acc[leg.transactionId]) acc[leg.transactionId] = [];
      
      const legInput: TransactionLegInput = {
        assetId: leg.assetId,
        amount: leg.amount,
        legType: leg.legType as LegType,
        valuationEur: leg.valuationEur ?? leg.acquisitionValueEur ?? undefined,
        valuationStatus: leg.valuationStatus as "valued" | "pending" | "estimated" | undefined
      };

      acc[leg.transactionId].push(legInput);
      return acc;
    }, {});

    const feesByTxId = allFees.reduce((acc: Record<string, { assetId: string; amount: number }[]>, fee: FeeRecord) => {
      if (!acc[fee.transactionId]) acc[fee.transactionId] = [];
      acc[fee.transactionId].push({ assetId: fee.assetId, amount: fee.amount });
      return acc;
    }, {});

    return allTxs.map((tx: TxType) => ({
      id: tx.id,
      type: tx.type as TransactionType,
      date: tx.date,
      externalId: tx.externalId,
      notes: tx.notes,
      fees: feesByTxId[tx.id] || [],
      legs: legsByTxId[tx.id] || []
    }));
  }

  async getAccountBalances(): Promise<Record<string, number>> {
    const allAccounts = await this.db.select().from(accounts);
    const balances: Record<string, number> = {};
    for (const acc of allAccounts) {
      if (acc.assetId && typeof acc.balance === 'number') {
        balances[acc.assetId] = (balances[acc.assetId] || 0) + acc.balance;
      }
    }
    return balances;
  }

  async getStoredRealizedGains(): Promise<RealizedGain[]> {
    const rows = await this.db.select().from(realizedGains);
    return rows.map((gain) => ({
      transactionId: gain.transactionId,
      assetId: gain.assetId,
      amountSold: gain.amountSold,
      sellValueEur: gain.saleValueEur,
      costBasisEur: gain.costBasisEur,
      realizedGainEur: gain.realizedGainEur,
      date: gain.date,
    }));
  }

  async getStoredFifoLots(): Promise<FifoLot[]> {
    const rows = await this.db.select().from(lots);
    return rows.map((lot) => ({
      id: lot.id,
      assetId: lot.assetId,
      transactionId: lot.transactionId,
      date: lot.date,
      originalAmount: lot.originalAmount,
      remainingAmount: lot.remainingAmount,
      unitAcquisitionPriceEur: lot.unitAcquisitionPriceEur,
    }));
  }

  async saveFifoResults(lotsData: FifoLot[], consumptionsData: LotConsumption[], realizedGainsData: RealizedGain[]): Promise<void> {
    // Build a map of transactionId → sell date from consumptions (which carry tx.date from FifoCalculator)
    const txDateMap = new Map<string, number>();
    for (const c of consumptionsData) {
      txDateMap.set(c.transactionId, c.date);
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(realizedGains);
      await tx.delete(lotConsumptions);
      await tx.delete(lots);

      if (lotsData.length > 0) {
        await tx.insert(lots).values(lotsData.map(l => ({
          id: l.id,
          assetId: l.assetId,
          transactionId: l.transactionId,
          date: l.date,
          originalAmount: l.originalAmount,
          remainingAmount: l.remainingAmount,
          unitAcquisitionPriceEur: l.unitAcquisitionPriceEur,
          isFullyConsumed: l.remainingAmount <= 0 ? 1 : 0
        })));
      }

      if (consumptionsData.length > 0) {
        await tx.insert(lotConsumptions).values(consumptionsData.map(c => ({
          id: c.id,
          lotId: c.lotId,
          transactionId: c.transactionId,
          amountConsumed: c.amountConsumed,
          unitSellPriceEur: c.unitSellPriceEur,
          realizedGainEur: c.realizedGainEur,
          date: c.date
        })));
      }

      if (realizedGainsData.length > 0) {
        await tx.insert(realizedGains).values(realizedGainsData.map(g => ({
          id: `${g.transactionId}_${g.assetId}_fifo`,
          transactionId: g.transactionId,
          assetId: g.assetId,
          amountSold: g.amountSold,
          saleValueEur: g.sellValueEur,
          costBasisEur: g.costBasisEur,
          realizedGainEur: g.realizedGainEur,
          date: (g as RealizedGain & { date?: number }).date ?? txDateMap.get(g.transactionId) ?? Date.now()
        })));
      }
    });
  }
}
