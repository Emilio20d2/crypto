import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildProfitHarvestCycle, addSimulatedRebuy } from "@crypto-control/portfolio";
import { closeDatabase, initializeDatabase, runMigrations } from "./db";
import { DatabaseProfitHarvestRepository } from "./profit-harvest-repository";
import * as schema from "./schema";

describe("DatabaseProfitHarvestRepository", () => {
  const dbPath = path.resolve(__dirname, "../test-profit-harvest.sqlite");
  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("persists strategic cycles without creating real operations", () => {
    const { db } = initializeDatabase(dbPath);
    runMigrations(migrationsFolder);
    const now = Date.UTC(2036, 0, 1);
    db.insert(schema.assets).values({
      id: "BTC",
      symbol: "BTC",
      name: "Bitcoin",
      type: "crypto",
      createdAt: now,
      updatedAt: now,
    }).run();

    const repo = new DatabaseProfitHarvestRepository(db);
    const cycle = buildProfitHarvestCycle({
      id: "cycle-1",
      assetId: "BTC",
      openedAt: now,
      strategyMode: "INTELLIGENT_STRATEGY",
      unitsSold: 1,
      sellPriceEur: 100,
      acquisitionCostEur: 50,
      taxEur: 19,
      costsEur: 1,
      reason: "Propuesta estratégica simulada",
      positiveSignals: [{
        signalId: "signal-1",
        assetId: "BTC",
        type: "sell",
        status: "active",
        generatedAt: now,
        dataVersion: "v1",
        reason: "Ganancia suficiente",
        confidence: 0.8,
      }],
    });

    repo.upsert(cycle);

    const saved = repo.getById("cycle-1");
    expect(saved).not.toBeNull();
    expect(saved?.simulationOnly).toBe(true);
    expect(saved?.requiresUserConfirmation).toBe(true);
    expect(saved?.eurcFiscalReserveEur).toBe(19);
    expect(saved?.eurcOperationalEur).toBe(80);
    expect(saved?.positiveSignals[0]?.signalId).toBe("signal-1");

    const transactions = db.select().from(schema.transactions).all();
    const gains = db.select().from(schema.realizedGains).all();
    expect(transactions).toHaveLength(0);
    expect(gains).toHaveLength(0);
  });

  it("updates rebuy state durably while preserving the same cycle id", () => {
    const { db } = initializeDatabase(dbPath);
    runMigrations(migrationsFolder);
    const now = Date.UTC(2036, 0, 1);
    db.insert(schema.assets).values({
      id: "ETH",
      symbol: "ETH",
      name: "Ethereum",
      type: "crypto",
      createdAt: now,
      updatedAt: now,
    }).run();

    const repo = new DatabaseProfitHarvestRepository(db);
    const cycle = buildProfitHarvestCycle({
      id: "cycle-2",
      assetId: "ETH",
      openedAt: now,
      strategyMode: "HYBRID",
      unitsSold: 2,
      sellPriceEur: 100,
      acquisitionCostEur: 120,
      taxEur: 15,
      costsEur: 5,
      reason: "Propuesta híbrida",
    });
    repo.upsert(cycle);

    const updated = addSimulatedRebuy(cycle, {
      id: "rebuy-1",
      executedAt: Date.UTC(2036, 1, 1),
      priceEur: 60,
      eurcUsedEur: 180,
      quantity: 3,
      costsEur: 0,
      simulated: true,
    });
    repo.upsert(updated);

    const rows = repo.list({ assetId: "ETH" });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("cycle-2");
    expect(rows[0].status).toBe("completed");
    expect(rows[0].rebuys).toHaveLength(1);
    expect(rows[0].additionalUnits).toBeCloseTo(1);
  });
});
