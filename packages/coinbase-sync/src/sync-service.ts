import * as crypto from "crypto";
import { eq } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = import("drizzle-orm/better-sqlite3").BetterSQLite3Database<any>;
import type { CoinbaseClient } from "./client";
import type { CoinbaseFill, CoinbaseSyncResult } from "./types";
import { normalizeFill } from "./normalizer";

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

  private insertFill(fill: CoinbaseFill): void {
    const normalized = normalizeFill(fill);

    if (this.isDuplicate(normalized.externalId)) return;

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
  }

  async sync(): Promise<CoinbaseSyncResult> {
    const cursor = this.getSetting(SETTING_SYNC_CURSOR);

    let allFills: CoinbaseFill[] = [];

    // Paginated fetch: collect all pages
    let pageCursor: string | undefined = undefined;
    let isFirstPage = true;

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
      allFills = allFills.concat(response.fills);

      // Coinbase returns empty string cursor when no more pages
      pageCursor = response.cursor || undefined;
      isFirstPage = false;

      if (pageCursor) {
        await sleep(INTER_REQUEST_DELAY_MS);
      }
    } while (pageCursor);

    // Sort fills oldest→newest to process in chronological order
    allFills.sort(
      (a, b) =>
        new Date(a.sequence_timestamp).getTime() -
        new Date(b.sequence_timestamp).getTime()
    );

    let newTransactions = 0;
    let skippedDuplicates = 0;

    for (const fill of allFills) {
      if (this.isDuplicate(fill.entry_id)) {
        skippedDuplicates++;
        continue;
      }
      this.insertFill(fill);
      newTransactions++;
    }

    // Advance the cursor to the latest sequence_timestamp seen
    if (allFills.length > 0) {
      const latestFill = allFills[allFills.length - 1];
      this.setSetting(SETTING_SYNC_CURSOR, latestFill.sequence_timestamp);
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
      `[Coinbase Sync] Completado: ${newTransactions} nuevas, ${skippedDuplicates} duplicadas`
    );

    return {
      itemsProcessed: allFills.length,
      newTransactions,
      skippedDuplicates,
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
