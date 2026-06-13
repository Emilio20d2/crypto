import { PortfolioRepository, TransactionInput, TransactionLegInput, TransactionType, LegType } from "@crypto-control/portfolio";
import { getDb } from "./db";
import { transactions, transactionLegs } from "./schema";

export class DatabasePortfolioRepository implements PortfolioRepository {
  constructor(private db: ReturnType<typeof getDb>) {}

  async getTransactions(): Promise<TransactionInput[]> {
    const allTxs = await this.db.select().from(transactions);
    const allLegs = await this.db.select().from(transactionLegs);

    const legsByTxId = allLegs.reduce((acc: Record<string, TransactionLegInput[]>, leg: any) => {
      if (!acc[leg.transactionId]) acc[leg.transactionId] = [];
      
      const legInput: TransactionLegInput = {
        assetId: leg.assetId,
        amount: leg.amount,
        legType: leg.legType as LegType,
        valuationEur: leg.valuationEur ?? undefined 
      };

      acc[leg.transactionId].push(legInput);
      return acc;
    }, {});

    return allTxs.map((tx: any) => ({
      id: tx.id,
      type: tx.type as TransactionType,
      date: tx.date,
      legs: legsByTxId[tx.id] || []
    }));
  }
}
