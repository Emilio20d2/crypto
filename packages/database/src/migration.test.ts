import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { initializeDatabase, runMigrations, closeDatabase } from "./db";

describe("Database Migration & Integrity", () => {
  const dbPath = path.resolve(__dirname, "../test-migration.sqlite");
  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  beforeAll(() => {
    // Asegurarse de que partimos de limpio
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterAll(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    // Remove generated backups
    const dir = path.dirname(dbPath);
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith("test-migration.sqlite.backup-")) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  });

  test("Migración de base de datos se ejecuta de forma segura con backups e integrity_check", () => {
    // 1. Inicializamos base limpia
    const { sqlite } = initializeDatabase(dbPath);
    
    // Verificamos estado inicial
    let integrity = sqlite.pragma("integrity_check") as { integrity_check: string }[];
    expect(integrity[0].integrity_check).toBe("ok");

    // Ejecutamos migraciones
    expect(() => runMigrations(migrationsFolder)).not.toThrow();

    // Verificamos tablas esperadas (las nuevas añadidas)
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[];
    const tableNames = tables.map(t => t.name);
    
    expect(tableNames).toContain("realized_gains");
    expect(tableNames).toContain("transaction_legs");
    expect(tableNames).toContain("investment_plans");
    expect(tableNames).toContain("investment_cycles");
    expect(tableNames).toContain("investment_assets");
    expect(tableNames).toContain("strategy_revisions");
    expect(tableNames).toContain("treasury_accounts");
    expect(tableNames).toContain("treasury_movements");
    expect(tableNames).toContain("fiscal_reserve_movements");
    expect(tableNames).toContain("cycle_liquidity_allocations");
    expect(tableNames).toContain("profit_harvest_cycles");
    expect(tableNames).toContain("market_series_cache_v2");
    expect(tableNames).toContain("portfolio_transaction_cache_v2");
    expect(tableNames).toContain("automated_operation_policies_v1");
    expect(tableNames).toContain("automated_operation_runs_v1");

    // Verificamos las nuevas columnas en transaction_legs
    const columnsInfo = sqlite.pragma("table_info('transaction_legs')") as { name: string }[];
    const columnNames = columnsInfo.map(c => c.name);
    expect(columnNames).toContain("valuation_status");
    expect(columnNames).toContain("valuation_source");

    const planColumns = (sqlite.pragma("table_info('investment_plans')") as { name: string }[]).map(c => c.name);
    expect(planColumns).toContain("description");

    const cycleColumns = (sqlite.pragma("table_info('investment_cycles')") as { name: string }[]).map(c => c.name);
    expect(cycleColumns).toContain("contribution_currency");
    expect(cycleColumns).toContain("status");

    const investmentAssetColumns = (sqlite.pragma("table_info('investment_assets')") as { name: string }[]).map(c => c.name);
    expect(investmentAssetColumns).toContain("allocation_percentage");
    expect(investmentAssetColumns).toContain("fixed_amount_eur");
    expect(investmentAssetColumns).toContain("target_amount");
    expect(investmentAssetColumns).toContain("target_value_eur");
    expect(investmentAssetColumns).toContain("target_portfolio_percentage");
    expect(investmentAssetColumns).toContain("status");

    const harvestColumns = (sqlite.pragma("table_info('profit_harvest_cycles')") as { name: string }[]).map(c => c.name);
    expect(harvestColumns).toContain("simulation_only");
    expect(harvestColumns).toContain("requires_user_confirmation");
    expect(harvestColumns).toContain("eurc_fiscal_reserve_eur");
    expect(harvestColumns).toContain("eurc_operational_eur");

    const automationRunColumns = (sqlite.pragma("table_info('automated_operation_runs_v1')") as { name: string }[]).map(c => c.name);
    expect(automationRunColumns).toContain("idempotency_key");
    expect(automationRunColumns).toContain("preview_token");
    expect(automationRunColumns).toContain("preview_id");
    expect(automationRunColumns).toContain("order_ids_json");
    expect(automationRunColumns).toContain("error_code");
    expect(automationRunColumns).toContain("error_message");

    const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[];
    const triggerNames = triggers.map(t => t.name);
    expect(triggerNames).toContain("invalidate_portfolio_tx_cache_v2_after_transaction_insert");
    expect(triggerNames).toContain("invalidate_portfolio_tx_cache_v2_after_leg_update");
    expect(triggerNames).toContain("invalidate_portfolio_tx_cache_v2_after_fee_delete");
    
    closeDatabase();
  });
  
  test("Prueba de rollback ante una migración defectuosa simulada", () => {
    // Simulate rollback: by modifying migration or throwing
    // For this test, we can pass a bad migrations folder that contains invalid SQL
    const badMigrationsFolder = path.resolve(__dirname, "../drizzle-bad");
    if (!fs.existsSync(badMigrationsFolder)) fs.mkdirSync(badMigrationsFolder);
    
    fs.writeFileSync(path.join(badMigrationsFolder, "0000_bad.sql"), "CREATE TABLE invalid_syntax;");

    const { sqlite } = initializeDatabase(dbPath);
    
    expect(() => runMigrations(badMigrationsFolder)).toThrow();

    // After failure, DB is restored from backup, so it should be intact
    const restored = initializeDatabase(dbPath);
    let integrity = restored.sqlite.pragma("integrity_check") as { integrity_check: string }[];
    expect(integrity[0].integrity_check).toBe("ok");

    closeDatabase();
    fs.unlinkSync(path.join(badMigrationsFolder, "0000_bad.sql"));
    fs.rmdirSync(badMigrationsFolder);
  });
});
