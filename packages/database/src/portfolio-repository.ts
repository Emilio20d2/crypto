import { PortfolioRepository, TransactionInput, TransactionLegInput, TransactionType, LegType } from "@crypto-control/portfolio";
import { getDb } from "./db";
import { transactions, transactionLegs, lots, lotConsumptions, realizedGains } from "./schema";

export class DatabasePortfolioRepository implements PortfolioRepository {
  constructor(private db: ReturnType<typeof getDb>) {}

  async getTransactions(): Promise<TransactionInput[]> {
    const allTxs = await this.db.select().from(transactions);
    const allLegs = await this.db.select().from(transactionLegs);

    type TxType = typeof transactions.$inferSelect;
    type LegTypeRecord = typeof transactionLegs.$inferSelect;

    const legsByTxId = allLegs.reduce((acc: Record<string, TransactionLegInput[]>, leg: LegTypeRecord) => {
      if (!acc[leg.transactionId]) acc[leg.transactionId] = [];
      
      const legInput: TransactionLegInput = {
        assetId: leg.assetId,
        amount: leg.amount,
        legType: leg.legType as LegType,
        valuationEur: leg.valuationEur ?? undefined,
        valuationStatus: leg.valuationStatus as "valued" | "pending" | "estimated" | undefined
      };

      acc[leg.transactionId].push(legInput);
      return acc;
    }, {});

    return allTxs.map((tx: TxType) => ({
      id: tx.id,
      type: tx.type as TransactionType,
      date: tx.date,
      legs: legsByTxId[tx.id] || []
    }));
  }

  async saveFifoResults(lotsData: any[], consumptionsData: any[], realizedGainsData: any[]): Promise<void> {
    const { lots, lotConsumptions, realizedGains } = await import("./schema");
    
    // We should do this in a transaction if Drizzle supports it easily,
    // or just run them sequentially.
    await this.db.transaction(async (tx) => {
      // Clear existing first for a full recalculation
      await tx.delete(realizedGains);
      await tx.delete(lotConsumptions);
      await tx.delete(lots);

      // Insert in chunks to avoid SQLite limits if arrays are huge
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
          date: Date.now() // or we could pass the transaction date
        })));
      }
    });
  }
}
