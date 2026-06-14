import { describe, test, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@crypto-control/database";
import * as path from "path";
import { eq } from "drizzle-orm";
import { CoinbaseSyncService } from "./sync-service";
import type { CoinbaseClient } from "./client";
import type { FillsResponse } from "./types";

const MIGRATIONS_PATH = path.resolve(__dirname, "../../database/drizzle");

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_PATH });

  // Seed required assets
  const now = Date.now();
  db.insert(schema.assets).values([
    { id: "BTC",  symbol: "BTC",  name: "Bitcoin",  type: "crypto", createdAt: now, updatedAt: now },
    { id: "ETH",  symbol: "ETH",  name: "Ethereum", type: "crypto", createdAt: now, updatedAt: now },
    { id: "EUR",  symbol: "EUR",  name: "Euro",      type: "fiat",   createdAt: now, updatedAt: now },
  ]).run();

  return db;
}

function makeClient(fillsResponse: FillsResponse): CoinbaseClient {
  return {
    getFills: vi.fn().mockResolvedValue(fillsResponse),
    getV2Accounts: vi.fn().mockResolvedValue({ data: [], pagination: null }),
    testConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as CoinbaseClient;
}

function makeFillResponse(overrides: Partial<FillsResponse> = {}): FillsResponse {
  return {
    fills: [
      {
        entry_id: "fill-abc",
        trade_id: "trade-abc",
        order_id: "order-abc",
        trade_time: "2024-01-15T10:00:00Z",
        trade_type: "FILL",
        price: "50000",
        size: "0.001",
        commission: "1.25",
        product_id: "BTC-EUR",
        sequence_timestamp: "2024-01-15T10:00:00.000Z",
        liquidity_indicator: "MAKER",
        size_in_quote: false,
        user_id: "user-1",
        side: "BUY",
      },
    ],
    cursor: "",
    ...overrides,
  };
}

describe("CoinbaseSyncService", () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  test("fill nuevo se inserta correctamente en transactions + transactionLegs + fees", async () => {
    const client = makeClient(makeFillResponse());
    const svc = new CoinbaseSyncService(db, schema, client);

    const result = await svc.sync();

    expect(result.newTransactions).toBe(1);
    expect(result.skippedDuplicates).toBe(0);

    const txs = db.select().from(schema.transactions).all();
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe("buy");
    expect(txs[0].externalId).toBe("fill-abc");

    const legs = db.select().from(schema.transactionLegs).all();
    expect(legs).toHaveLength(1);
    expect(legs[0].assetId).toBe("BTC");
    expect(legs[0].amount).toBeCloseTo(0.001);
    expect(legs[0].legType).toBe("destination");

    const fees = db.select().from(schema.fees).all();
    expect(fees).toHaveLength(1);
    expect(fees[0].assetId).toBe("EUR");
    expect(fees[0].amount).toBeCloseTo(1.25);
  });

  test("fill duplicado (mismo externalId) se omite → skippedDuplicates++", async () => {
    const client = makeClient(makeFillResponse());
    const svc = new CoinbaseSyncService(db, schema, client);

    // First sync
    await svc.sync();
    // Second sync with same fills
    const result = await svc.sync();

    expect(result.newTransactions).toBe(0);
    expect(result.skippedDuplicates).toBe(1);

    // Only one transaction in DB
    const txs = db.select().from(schema.transactions).all();
    expect(txs).toHaveLength(1);
  });

  test("cursor se actualiza al sequence_timestamp del fill más reciente", async () => {
    const client = makeClient(
      makeFillResponse({
        fills: [
          {
            entry_id: "fill-1",
            trade_id: "t1", order_id: "o1",
            trade_time: "2024-01-10T10:00:00Z",
            trade_type: "FILL",
            price: "50000", size: "0.001", commission: "0",
            product_id: "BTC-EUR",
            sequence_timestamp: "2024-01-10T10:00:00.000Z",
            liquidity_indicator: "MAKER", size_in_quote: false, user_id: "u", side: "BUY",
          },
          {
            entry_id: "fill-2",
            trade_id: "t2", order_id: "o2",
            trade_time: "2024-01-20T10:00:00Z",
            trade_type: "FILL",
            price: "55000", size: "0.002", commission: "0",
            product_id: "BTC-EUR",
            sequence_timestamp: "2024-01-20T10:00:00.000Z",
            liquidity_indicator: "MAKER", size_in_quote: false, user_id: "u", side: "BUY",
          },
        ],
      })
    );
    const svc = new CoinbaseSyncService(db, schema, client);
    await svc.sync();

    const cursorRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "coinbase:sync-cursor"))
      .limit(1)
      .all();

    expect(cursorRow[0].value).toBe("2024-01-20T10:00:00.000Z");
  });

  test("syncRuns registra entrada con status=success tras sync exitoso", async () => {
    const client = makeClient(makeFillResponse());
    const svc = new CoinbaseSyncService(db, schema, client);
    await svc.sync();

    const runs = db.select().from(schema.syncRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe("coinbase");
    expect(runs[0].status).toBe("success");
    expect(runs[0].itemsProcessed).toBe(1);
  });

  test("activo desconocido se auto-crea en assets durante la inserción del fill", async () => {
    const client = makeClient(
      makeFillResponse({
        fills: [
          {
            entry_id: "fill-sol",
            trade_id: "t", order_id: "o",
            trade_time: "2024-01-15T10:00:00Z",
            trade_type: "FILL",
            price: "100", size: "5", commission: "0.5",
            product_id: "SOL-EUR",
            sequence_timestamp: "2024-01-15T10:00:00.000Z",
            liquidity_indicator: "MAKER", size_in_quote: false, user_id: "u", side: "BUY",
          },
        ],
      })
    );
    const svc = new CoinbaseSyncService(db, schema, client);
    await svc.sync();

    const sol = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, "SOL"))
      .limit(1)
      .all();

    expect(sol).toHaveLength(1);
    expect(sol[0].symbol).toBe("SOL");
    expect(sol[0].type).toBe("crypto");
  });

  test("error de red → syncWithErrorHandling registra status=error en syncRuns y settings", async () => {
    const client = {
      getFills: vi.fn(),
      getV2Accounts: vi.fn().mockRejectedValue(new Error("Network timeout")),
      testConnection: vi.fn(),
    } as unknown as CoinbaseClient;

    const svc = new CoinbaseSyncService(db, schema, client);
    await expect(svc.syncWithErrorHandling()).rejects.toThrow("Network timeout");

    const runs = db.select().from(schema.syncRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("error");

    const errRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "coinbase:last-sync-status"))
      .limit(1)
      .all();
    expect(errRow[0].value).toBe("error");
  });
});
