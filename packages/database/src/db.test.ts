import { expect, test, describe, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import crypto from "crypto";

describe("Base de datos y operaciones", () => {
  let db: any;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });
    // Aplicamos migraciones a memoria. Necesitamos tener el path correcto.
    migrate(db, { migrationsFolder: "./drizzle" });

    // Seed básico para activos
    db.insert(schema.assets).values([
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin", createdAt: Date.now(), updatedAt: Date.now() },
      { id: "ethereum", symbol: "ETH", name: "Ethereum", createdAt: Date.now(), updatedAt: Date.now() },
    ]).run();
  });

  test("Crear una compra", () => {
    const txId = crypto.randomUUID();
    db.insert(schema.transactions).values({
      id: txId, type: "buy", date: Date.now(), createdAt: Date.now(), updatedAt: Date.now()
    }).run();
    db.insert(schema.transactionLegs).values({
      id: crypto.randomUUID(), transactionId: txId, assetId: "bitcoin", amount: 1.5, legType: "destination"
    }).run();

    const txs = db.select().from(schema.transactions).all();
    expect(txs.length).toBe(1);
    expect(txs[0].type).toBe("buy");
  });

  test("Crear una venta", () => {
    const txId = crypto.randomUUID();
    db.insert(schema.transactions).values({
      id: txId, type: "sell", date: Date.now(), createdAt: Date.now(), updatedAt: Date.now()
    }).run();
    db.insert(schema.transactionLegs).values({
      id: crypto.randomUUID(), transactionId: txId, assetId: "bitcoin", amount: -0.5, legType: "source"
    }).run();
    
    const legs = db.select().from(schema.transactionLegs).all();
    expect(legs[0].amount).toBe(-0.5);
  });

  test("Crear una conversión y comisión", () => {
    const txId = crypto.randomUUID();
    db.transaction((tx: any) => {
      tx.insert(schema.transactions).values({
        id: txId, type: "convert", date: Date.now(), createdAt: Date.now(), updatedAt: Date.now()
      }).run();
      
      tx.insert(schema.transactionLegs).values([
        { id: crypto.randomUUID(), transactionId: txId, assetId: "bitcoin", amount: -1, legType: "source" },
        { id: crypto.randomUUID(), transactionId: txId, assetId: "ethereum", amount: 20, legType: "destination" }
      ]).run();

      tx.insert(schema.fees).values({
        id: crypto.randomUUID(), transactionId: txId, assetId: "bitcoin", amount: 0.001
      }).run();
    });

    const fees = db.select().from(schema.fees).all();
    expect(fees[0].amount).toBe(0.001);
  });

  test("Mantener consistencia si una escritura falla", () => {
    const txId = crypto.randomUUID();
    try {
      db.transaction((tx: any) => {
        tx.insert(schema.transactions).values({
          id: txId, type: "buy", date: Date.now(), createdAt: Date.now(), updatedAt: Date.now()
        }).run();
        
        // Error forzado (falta assetId, violará constraint en SQLite en memoria)
        tx.insert(schema.transactionLegs).values({
          id: crypto.randomUUID(), transactionId: txId, amount: 10, legType: "destination"
        }).run();
      });
    } catch (e) {
      // Ignorar error forzado
    }

    const txs = db.select().from(schema.transactions).all();
    expect(txs.length).toBe(0); // Rollback garantizado
  });
});
