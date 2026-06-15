import * as crypto from "crypto";
import { eq } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = import("drizzle-orm/better-sqlite3").BetterSQLite3Database<any>;
import type { CoinbaseClient } from "./client";
import type { CoinbaseFill, CoinbaseSyncResult, V2Transaction, V2Account } from "./types";
import { normalizeFill, normalizeV2Transactions, NormalizedTransaction } from "./normalizer";

type DbSchema = typeof import("@crypto-control/database").schema;

const SYNC_SOURCE = "coinbase";
const SETTING_SYNC_CURSOR = "coinbase:sync-cursor";
const SETTING_LAST_SYNC_AT = "coinbase:last-sync-at";
const SETTING_LAST_SYNC_STATUS = "coinbase:last-sync-status";
const SETTING_LAST_SYNC_COUNT = "coinbase:last-sync-count";
const SETTING_LAST_SYNC_ERROR = "coinbase:last-sync-error";
const PAGE_SIZE = 100;
const INTER_REQUEST_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CoinbaseSyncService {
  constructor(
    private readonly db: AnyDB,
    private readonly schema: DbSchema,
    private readonly client: CoinbaseClient
  ) {}

  private getSetting(key: string): string | null {
    const rows = this.db
      .select()
      .from(this.schema.settings)
      .where(eq(this.schema.settings.key, key))
      .limit(1)
      .all();
    return rows.length > 0 ? rows[0].value : null;
  }

  private setSetting(key: string, value: string): void {
    this.db
      .insert(this.schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: this.schema.settings.key, set: { value } })
      .run();
  }

  private isDuplicate(externalId: string): boolean {
    const rows = this.db
      .select({ id: this.schema.transactions.id })
      .from(this.schema.transactions)
      .where(eq(this.schema.transactions.externalId, externalId))
      .limit(1)
      .all();
    return rows.length > 0;
  }

  private ensureAssets(
    requiredAssets: { id: string; symbol: string; name: string; type: "crypto" | "fiat" }[]
  ): void {
    const now = Date.now();
    for (const asset of requiredAssets) {
      const existing = this.db
        .select({ id: this.schema.assets.id })
        .from(this.schema.assets)
        .where(eq(this.schema.assets.id, asset.id))
        .limit(1)
        .all();
      if (existing.length === 0) {
        console.log(`[Coinbase Sync] Insertando activo nuevo: ${asset.symbol}`);
        this.db
          .insert(this.schema.assets)
          .values({
            id: asset.id,
            symbol: asset.symbol,
            name: asset.name,
            type: asset.type,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
  }

  private insertNormalized(normalized: NormalizedTransaction): boolean {
    if (this.isDuplicate(normalized.externalId)) return false;

    this.ensureAssets(normalized.requiredAssets);

    const now = Date.now();
    const txId = crypto.randomUUID();

    this.db.transaction((tx) => {
      tx.insert(this.schema.transactions)
        .values({
          id: txId,
          type: normalized.type,
          date: normalized.date,
          externalId: normalized.externalId,
          notes: `Importado de Coinbase`,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const leg of normalized.legs) {
        tx.insert(this.schema.transactionLegs)
          .values({
            id: crypto.randomUUID(),
            transactionId: txId,
            assetId: leg.assetId,
            amount: leg.amount,
            legType: leg.legType,
            valuationEur: leg.acquisitionValueEur ?? undefined,
            acquisitionValueEur: leg.acquisitionValueEur ?? undefined,
            unitAcquisitionPriceEur: leg.unitAcquisitionPriceEur ?? undefined,
            valuationStatus: leg.valuationStatus,
          })
          .run();
      }

      for (const fee of normalized.fees) {
        if (fee.amount > 0) {
          tx.insert(this.schema.fees)
            .values({
              id: crypto.randomUUID(),
              transactionId: txId,
              assetId: fee.assetId,
              amount: fee.amount,
            })
            .run();
        }
      }
    });
    
    return true;
  }

  async sync(): Promise<CoinbaseSyncResult> {
    const startedAt = Date.now();
    console.log("[Coinbase Sync] Iniciando sincronización de cuentas V2 y V3...");
    let newTransactions = 0;
    let skippedDuplicates = 0;
    let totalItemsProcessed = 0;
    let accountsConsulted = 0;
    let pagesDownloaded = 0;
    let transactionsDownloaded = 0;
    let fillsDownloaded = 0;

    // --- PHASE 1: V2 Accounts & Transactions ---
    try {
      let accountsUri: string | undefined = undefined;
      const allAccounts: V2Account[] = [];
      
      do {
        const accountsRes = await this.client.getV2Accounts(accountsUri);
        pagesDownloaded++;
        allAccounts.push(...accountsRes.data);
        accountsUri = accountsRes.pagination?.next_uri || undefined;
        if (accountsUri) await sleep(INTER_REQUEST_DELAY_MS);
      } while (accountsUri);
      
      accountsConsulted = allAccounts.length;
      console.log(`[Coinbase Sync] Cuentas V2 encontradas: ${allAccounts.length}`);
      
      const now = Date.now();
      for (const account of allAccounts) {
        const assetId = account.currency?.code;
        const balance = account.balance?.amount ? parseFloat(account.balance.amount) : 0;
        
        if (assetId) {
          this.ensureAssets([{
            id: assetId,
            symbol: assetId,
            name: account.currency.name || assetId,
            type: ["EUR", "USD", "GBP"].includes(assetId) ? "fiat" : "crypto"
          }]);
        }

        this.db.insert(this.schema.accounts).values({
          id: account.id,
          name: account.name || `${assetId} Wallet`,
          type: "exchange",
          assetId: assetId || null,
          balance: balance,
          createdAt: now
        }).onConflictDoUpdate({
          target: this.schema.accounts.id,
          set: {
            name: account.name || `${assetId} Wallet`,
            assetId: assetId || null,
            balance: balance
          }
        }).run();
      }
      
      const allV2Txs: V2Transaction[] = [];
      
      for (const account of allAccounts) {
        let txUri: string | undefined = undefined;
        let stopPaginating = false;
        
        do {
          const txRes = await this.client.getV2Transactions(account.id, txUri);
          pagesDownloaded++;
          transactionsDownloaded += txRes.data.length;
          
          for (const tx of txRes.data) {
            totalItemsProcessed++;
            
            let isDup = false;
            if (tx.type === "trade" && tx.trade?.id) isDup = this.isDuplicate(tx.trade.id);
            else if (tx.type === "buy" && tx.buy?.id) isDup = this.isDuplicate(tx.buy.id);
            else if (tx.type === "sell" && tx.sell?.id) isDup = this.isDuplicate(tx.sell.id);
            else isDup = this.isDuplicate(tx.id);

            if (isDup) {
              stopPaginating = true;
              skippedDuplicates++;
            } else {
              allV2Txs.push(tx);
            }
          }
          
          txUri = txRes.pagination?.next_uri || undefined;
          if (txUri && !stopPaginating) await sleep(INTER_REQUEST_DELAY_MS);
          else txUri = undefined;
        } while (txUri);
      }
      
      const normalizedV2 = normalizeV2Transactions(allV2Txs);
      normalizedV2.sort((a, b) => a.date - b.date);
      
      for (const norm of normalizedV2) {
        if (this.insertNormalized(norm)) {
          newTransactions++;
        } else {
          skippedDuplicates++;
        }
      }
    } catch (e) {
      console.warn("[Coinbase Sync] Error sincronizando V2:", e);
      throw e;
    }

    // --- PHASE 2: V3 Fills (Advanced Trade) ---
    const cursor = this.getSetting(SETTING_SYNC_CURSOR);
    let allFills: CoinbaseFill[] = [];
    let pageCursor: string | undefined = undefined;
    let isFirstPage = true;

    try {
      do {
        const params: Parameters<typeof this.client.getFills>[0] = {
          limit: String(PAGE_SIZE),
        };
        if (isFirstPage && cursor) {
          params.start_sequence_timestamp = cursor;
        }
        if (pageCursor) {
          params.cursor = pageCursor;
        }

        const response = await this.client.getFills(params);
        pagesDownloaded++;
        allFills = allFills.concat(response.fills);
        fillsDownloaded += response.fills.length;
        pageCursor = response.cursor || undefined;
        isFirstPage = false;

        if (pageCursor) {
          await sleep(INTER_REQUEST_DELAY_MS);
        }
      } while (pageCursor);

      allFills.sort(
        (a, b) =>
          new Date(a.sequence_timestamp).getTime() -
          new Date(b.sequence_timestamp).getTime()
      );

      for (const fill of allFills) {
        totalItemsProcessed++;
        const norm = normalizeFill(fill);
        if (this.insertNormalized(norm)) {
          newTransactions++;
        } else {
          skippedDuplicates++;
        }
      }

      if (allFills.length > 0) {
        const latestFill = allFills[allFills.length - 1];
        this.setSetting(SETTING_SYNC_CURSOR, latestFill.sequence_timestamp);
      }
    } catch (e) {
      console.warn("[Coinbase Sync] Error sincronizando V3 Fills:", e);
      throw e;
    }

    const syncRunId = crypto.randomUUID();
    this.db
      .insert(this.schema.syncRuns)
      .values({
        id: syncRunId,
        source: SYNC_SOURCE,
        timestamp: Date.now(),
        status: "success",
        itemsProcessed: newTransactions,
      })
      .run();

    const now = Date.now();
    this.setSetting(SETTING_LAST_SYNC_AT, String(now));
    this.setSetting(SETTING_LAST_SYNC_STATUS, "success");
    this.setSetting(SETTING_LAST_SYNC_COUNT, String(newTransactions));
    this.setSetting(SETTING_LAST_SYNC_ERROR, "");

    console.log(
      `[Coinbase Sync] Completado: ${newTransactions} nuevas, ${skippedDuplicates} duplicadas de ${totalItemsProcessed} procesadas.`
    );

    return {
      itemsProcessed: totalItemsProcessed,
      newTransactions,
      skippedDuplicates,
      durationMs: Date.now() - startedAt,
      accountsConsulted,
      pagesDownloaded,
      transactionsDownloaded,
      fillsDownloaded,
      updatedTransactions: 0,
      pendingValuations: 0,
      errors: [],
    };
  }

  async syncWithErrorHandling(): Promise<CoinbaseSyncResult> {
    try {
      return await this.sync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Coinbase Sync] Error:", msg);

      this.setSetting(SETTING_LAST_SYNC_STATUS, "error");
      this.setSetting(SETTING_LAST_SYNC_ERROR, msg);

      this.db
        .insert(this.schema.syncRuns)
        .values({
          id: crypto.randomUUID(),
          source: SYNC_SOURCE,
          timestamp: Date.now(),
          status: "error",
          itemsProcessed: 0,
        })
        .run();

      throw e;
    }
  }

  getStatus(): {
    lastSyncAt: number | null;
    lastSyncItemsProcessed: number | null;
    lastSyncStatus: "success" | "error" | null;
    lastSyncError: string | null;
  } {
    const at = this.getSetting(SETTING_LAST_SYNC_AT);
    const count = this.getSetting(SETTING_LAST_SYNC_COUNT);
    const status = this.getSetting(SETTING_LAST_SYNC_STATUS) as "success" | "error" | null;
    const error = this.getSetting(SETTING_LAST_SYNC_ERROR);

    return {
      lastSyncAt: at ? parseInt(at, 10) : null,
      lastSyncItemsProcessed: count ? parseInt(count, 10) : null,
      lastSyncStatus: status || null,
      lastSyncError: error || null,
    };
  }
}
