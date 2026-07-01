import { PortfolioRepository, TransactionInput, TransactionLegInput, TransactionType, LegType, FifoLot, LotConsumption, RealizedGain } from "@crypto-control/portfolio";
import { getDb, getSqlite } from "./db";
import { transactions, transactionLegs, fees, lots, lotConsumptions, realizedGains, accounts } from "./schema";

interface TransactionCacheRow {
  signature: string;
  data_json: string;
}

export class DatabasePortfolioRepository implements PortfolioRepository {
  constructor(private db: ReturnType<typeof getDb>) {
    this.ensureTransactionCache();
  }

  private ensureTransactionCache(): void {
    const sqlite = getSqlite();
    if (!sqlite) return;
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_transaction_cache_v1 (
        cache_key TEXT PRIMARY KEY NOT NULL,
        signature TEXT NOT NULL,
        data_json TEXT NOT NULL,
        generated_at INTEGER NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_transaction_insert
      AFTER INSERT ON transactions BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_transaction_update
      AFTER UPDATE ON transactions BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_transaction_delete
      AFTER DELETE ON transactions BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;

      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_leg_insert
      AFTER INSERT ON transaction_legs BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_leg_update
      AFTER UPDATE ON transaction_legs BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_leg_delete
      AFTER DELETE ON transaction_legs BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;

      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_fee_insert
      AFTER INSERT ON fees BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_fee_update
      AFTER UPDATE ON fees BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_portfolio_tx_cache_after_fee_delete
      AFTER DELETE ON fees BEGIN
        DELETE FROM portfolio_transaction_cache_v1 WHERE cache_key = 'all-transactions';
      END;
    `);
  }

  private transactionSignature(): string | null {
    const sqlite = getSqlite();
    if (!sqlite) return null;
    this.ensureTransactionCache();
    const row = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM transactions) AS tx_count,
        (SELECT COALESCE(MAX(updated_at), 0) FROM transactions) AS tx_updated,
        (SELECT COUNT(*) FROM transaction_legs) AS leg_count,
        (SELECT COALESCE(SUM(amount), 0) FROM transaction_legs) AS leg_amount_sum,
        (SELECT COALESCE(SUM(COALESCE(acquisition_value_eur, valuation_eur, 0)), 0) FROM transaction_legs) AS leg_value_sum,
        (SELECT COUNT(*) FROM fees) AS fee_count,
        (SELECT COALESCE(SUM(amount), 0) FROM fees) AS fee_amount_sum
    `).get() as Record<string, number>;
    return JSON.stringify(row);
  }

  private readCachedTransactions(signature: string): TransactionInput[] | null {
    const sqlite = getSqlite();
    if (!sqlite) return null;
    const row = sqlite.prepare(`
      SELECT signature, data_json
      FROM portfolio_transaction_cache_v1
      WHERE cache_key = 'all-transactions'
    `).get() as TransactionCacheRow | undefined;
    if (!row || row.signature !== signature) return null;
    try {
      const value = JSON.parse(row.data_json) as TransactionInput[];
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  private saveCachedTransactions(signature: string, value: TransactionInput[]): void {
    const sqlite = getSqlite();
    if (!sqlite) return;
    sqlite.prepare(`
      INSERT INTO portfolio_transaction_cache_v1 (cache_key, signature, data_json, generated_at)
      VALUES ('all-transactions', ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        signature = excluded.signature,
        data_json = excluded.data_json,
        generated_at = excluded.generated_at
    `).run(signature, JSON.stringify(value), Date.now());
  }

  async getTransactions(): Promise<TransactionInput[]> {
    const signature = this.transactionSignature();
    if (signature) {
      const cached = this.readCachedTransactions(signature);
      if (cached) return cached;
    }

    const [allTxs, allLegs, allFees] = await Promise.all([
      this.db.select().from(transactions),
      this.db.select().from(transactionLegs),
      this.db.select().from(fees),
    ]);

    type TxType = typeof transactions.$inferSelect;
    type LegTypeRecord = typeof transactionLegs.$inferSelect;
    type FeeRecord = typeof fees.$inferSelect;

    const legsByTxId = allLegs.reduce((acc: Record<string, TransactionLegInput[]>, leg: LegTypeRecord) => {
      if (!acc[leg.transactionId]) acc[leg.transactionId] = [];
      acc[leg.transactionId].push({
        assetId: leg.assetId,
        amount: leg.amount,
        legType: leg.legType as LegType,
        valuationEur: leg.acquisitionValueEur ?? leg.valuationEur ?? undefined,
        valuationStatus: leg.valuationStatus as "valued" | "pending" | "estimated" | undefined,
      });
      return acc;
    }, {});

    const feesByTxId = allFees.reduce((acc: Record<string, { assetId: string; amount: number }[]>, fee: FeeRecord) => {
      if (!acc[fee.transactionId]) acc[fee.transactionId] = [];
      acc[fee.transactionId].push({ assetId: fee.assetId, amount: fee.amount });
      return acc;
    }, {});

    const result = allTxs.map((tx: TxType) => ({
      id: tx.id,
      type: tx.type as TransactionType,
      date: tx.date,
      externalId: tx.externalId,
      notes: tx.notes,
      cycleId: tx.cycleId,
      fees: feesByTxId[tx.id] || [],
      legs: legsByTxId[tx.id] || [],
    }));

    if (signature) this.saveCachedTransactions(signature, result);
    return result;
  }

  async getAccountBalances(): Promise<Record<string, number>> {
    const allAccounts = await this.db.select().from(accounts);
    const balances: Record<string, number> = {};
    for (const acc of allAccounts) {
      if (acc.assetId && typeof acc.balance === "number") {
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
    const txDateMap = new Map<string, number>();
    for (const consumption of consumptionsData) txDateMap.set(consumption.transactionId, consumption.date);

    await this.db.transaction(async (tx) => {
      await tx.delete(realizedGains);
      await tx.delete(lotConsumptions);
      await tx.delete(lots);

      if (lotsData.length > 0) {
        await tx.insert(lots).values(lotsData.map((lot) => ({
          id: lot.id,
          assetId: lot.assetId,
          transactionId: lot.transactionId,
          date: lot.date,
          originalAmount: lot.originalAmount,
          remainingAmount: lot.remainingAmount,
          unitAcquisitionPriceEur: lot.unitAcquisitionPriceEur,
          isFullyConsumed: lot.remainingAmount <= 0 ? 1 : 0,
        })));
      }

      if (consumptionsData.length > 0) {
        await tx.insert(lotConsumptions).values(consumptionsData.map((consumption) => ({
          id: consumption.id,
          lotId: consumption.lotId,
          transactionId: consumption.transactionId,
          amountConsumed: consumption.amountConsumed,
          unitSellPriceEur: consumption.unitSellPriceEur,
          realizedGainEur: consumption.realizedGainEur,
          date: consumption.date,
        })));
      }

      if (realizedGainsData.length > 0) {
        await tx.insert(realizedGains).values(realizedGainsData.map((gain) => ({
          id: `${gain.transactionId}_${gain.assetId}_fifo`,
          transactionId: gain.transactionId,
          assetId: gain.assetId,
          amountSold: gain.amountSold,
          saleValueEur: gain.sellValueEur,
          costBasisEur: gain.costBasisEur,
          realizedGainEur: gain.realizedGainEur,
          date: (gain as RealizedGain & { date?: number }).date ?? txDateMap.get(gain.transactionId) ?? Date.now(),
        })));
      }
    });
  }
}
