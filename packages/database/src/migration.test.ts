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

    // Verificamos las nuevas columnas en transaction_legs
    const columnsInfo = sqlite.pragma("table_info('transaction_legs')") as { name: string }[];
    const columnNames = columnsInfo.map(c => c.name);
    expect(columnNames).toContain("valuation_status");
    expect(columnNames).toContain("valuation_source");
    
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
