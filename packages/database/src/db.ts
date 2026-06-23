import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

let dbInstance: BetterSQLite3Database<typeof schema> | null = null;
let sqliteInstance: Database.Database | null = null;

export function initializeDatabase(dbPath: string): { db: BetterSQLite3Database<typeof schema>, sqlite: Database.Database } {
  if (dbInstance) return { db: dbInstance, sqlite: sqliteInstance! };

  // Crear o conectar a SQLite
  const sqlite = new Database(dbPath);
  
  // Activar modo WAL para concurrencia y claves foráneas
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  dbInstance = drizzle(sqlite, { schema });
  sqliteInstance = sqlite;

  return { db: dbInstance, sqlite };
}

export function closeDatabase() {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
  }
}

import fs from "fs";
import path from "path";

export function runMigrations(migrationsFolder: string) {
  if (!dbInstance || !sqliteInstance) throw new Error("Database not initialized");

  const dbPath = sqliteInstance.name;

  // Read journal to check how many migrations are pending
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  let pendingCount = 0;
  if (fs.existsSync(journalPath)) {
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as { entries: { tag: string; when: number }[] };
      const applied = sqliteInstance.prepare("SELECT hash FROM `__drizzle_migrations`").all() as { hash: string }[];
      const appliedHashes = new Set(applied.map(r => r.hash));
      const crypto = require("crypto") as typeof import("crypto");
      for (const entry of journal.entries) {
        const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const hash = crypto.createHash("sha256").update(fs.readFileSync(sqlPath, "utf-8")).digest("hex");
        if (!appliedHashes.has(hash)) pendingCount++;
      }
    } catch {
      pendingCount = 1; // assume there might be pending migrations
    }
  }

  // Only create backup if there are pending migrations
  let backupPath: string | null = null;
  if (pendingCount > 0) {
    backupPath = `${dbPath}.backup-${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[DB] ${pendingCount} migrations pending, backup created at ${backupPath}`);
  }

  try {
    // Verificar integridad inicial
    const integrityInitial = sqliteInstance.pragma("integrity_check") as { integrity_check: string }[];
    if (integrityInitial[0].integrity_check !== "ok") {
      throw new Error(`Integridad de base de datos fallida antes de migrar: ${JSON.stringify(integrityInitial)}`);
    }

    // Ejecutar migración (Drizzle maneja las transacciones DDL internamente cuando es posible)
    migrate(dbInstance, { migrationsFolder });

    // 3. Verificar integridad final
    const integrityFinal = sqliteInstance.pragma("integrity_check") as { integrity_check: string }[];
    if (integrityFinal[0].integrity_check !== "ok") {
      throw new Error(`Integridad de base de datos fallida después de migrar: ${JSON.stringify(integrityFinal)}`);
    }

  } catch (error) {
    console.error("Migration failed, restoring backup...", error);
    // Restauración en caso de fallo (solo si se creó backup)
    if (!backupPath) throw error;
    sqliteInstance.close();
    fs.copyFileSync(backupPath, dbPath);
    // Restart connection
    sqliteInstance = new Database(dbPath);
    sqliteInstance.pragma("journal_mode = WAL");
    sqliteInstance.pragma("foreign_keys = ON");
    dbInstance = drizzle(sqliteInstance, { schema });
    throw error;
  }
}

export function getDb() {
  if (!dbInstance) throw new Error("Database not initialized");
  return dbInstance;
}

// Create all plan/cycle/schedule tables using IF NOT EXISTS so this is safe
// to call even when the Drizzle migration failed (legacy DB with conflicting tables).
export function ensureEssentialTables(): void {
  if (!sqliteInstance) throw new Error("Database not initialized");
  const db = sqliteInstance;
  db.exec(`
    CREATE TABLE IF NOT EXISTS investment_plans (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      base_currency TEXT DEFAULT 'EUR' NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_investment_plans_status ON investment_plans (status);

    CREATE TABLE IF NOT EXISTS investment_cycles (
      id TEXT PRIMARY KEY NOT NULL,
      plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_date INTEGER NOT NULL,
      end_date INTEGER,
      monthly_amount_eur REAL NOT NULL,
      priority INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      objetivo TEXT,
      riesgo TEXT,
      allow_extra_contributions INTEGER DEFAULT 1 NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES investment_plans(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_investment_cycles_plan ON investment_cycles (plan_id);
    CREATE INDEX IF NOT EXISTS idx_investment_cycles_dates ON investment_cycles (start_date, end_date);

    CREATE TABLE IF NOT EXISTS investment_assets (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      allocation_percentage REAL,
      allocation_value REAL,
      allocation_type TEXT DEFAULT 'percentage' NOT NULL,
      priority INTEGER DEFAULT 0 NOT NULL,
      target_amount REAL,
      target_value_eur REAL,
      target_portfolio_percentage REAL,
      goal_reached_at INTEGER,
      start_date INTEGER,
      end_date INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_investment_assets_cycle ON investment_assets (cycle_id);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      logo_url TEXT,
      type TEXT DEFAULT 'crypto' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contribution_schedule (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT NOT NULL,
      type TEXT DEFAULT 'periodica' NOT NULL,
      planned_date INTEGER NOT NULL,
      amount_eur REAL NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      destination TEXT,
      status TEXT DEFAULT 'pendiente' NOT NULL,
      executed_at INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_contribution_schedule_cycle ON contribution_schedule (cycle_id);
    CREATE INDEX IF NOT EXISTS idx_contribution_schedule_date ON contribution_schedule (planned_date);
    CREATE INDEX IF NOT EXISTS idx_contribution_schedule_status ON contribution_schedule (status);

    CREATE TABLE IF NOT EXISTS partial_sale_rules (
      id TEXT PRIMARY KEY NOT NULL,
      plan_id TEXT,
      cycle_id TEXT NOT NULL,
      investment_asset_id TEXT,
      asset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_value REAL,
      condition_value2 REAL,
      sell_percentage REAL NOT NULL,
      priority INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'activa' NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cycle_rebuy_tiers (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT NOT NULL,
      asset_id TEXT,
      drawdown_percentage REAL NOT NULL,
      usage_percentage REAL NOT NULL,
      priority INTEGER DEFAULT 0,
      status TEXT DEFAULT 'activa',
      reference_type TEXT,
      reference_value REAL,
      reference_date INTEGER,
      last_triggered_at INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS strategy_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT NOT NULL,
      revision_type TEXT NOT NULL,
      description TEXT,
      effective_date INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_substitutions (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT NOT NULL,
      from_asset_id TEXT NOT NULL,
      to_asset_id TEXT,
      from_investment_asset_id TEXT,
      to_investment_asset_id TEXT,
      effective_date INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'programada' NOT NULL,
      allocation_transfer_mode TEXT DEFAULT 'full',
      notes TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES investment_cycles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS perspectives_goals (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      target_amount_eur REAL,
      target_date INTEGER,
      notes TEXT,
      priority INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cycle_partial_sales (
      id TEXT PRIMARY KEY NOT NULL,
      cycle_id TEXT,
      asset_id TEXT NOT NULL,
      proceeds_eur REAL NOT NULL,
      quantity REAL NOT NULL,
      price_eur REAL NOT NULL,
      gain_eur REAL DEFAULT 0,
      tax_eur REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_movements (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES treasury_accounts(id)
    );

    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      quantity REAL NOT NULL,
      cost_per_unit_eur REAL NOT NULL,
      remaining REAL NOT NULL,
      source TEXT DEFAULT 'purchase' NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategic_signals (
      id TEXT PRIMARY KEY NOT NULL,
      deduplication_key TEXT NOT NULL UNIQUE,
      asset_id TEXT NOT NULL,
      plan_id TEXT,
      cycle_id TEXT,
      rule_id TEXT,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'detected',
      detected_at INTEGER NOT NULL,
      valid_from INTEGER NOT NULL,
      expires_at INTEGER,
      current_price_eur REAL,
      reference_price_eur REAL,
      target_price_eur REAL,
      drawdown_pct REAL,
      recommended_percentage REAL,
      recommended_amount_eur REAL,
      recommended_quantity REAL,
      funding_source TEXT NOT NULL DEFAULT 'not_applicable',
      available_funding_eur REAL,
      fiscal_reserve_excluded_eur REAL,
      priority TEXT NOT NULL DEFAULT 'medium',
      confidence REAL,
      data_quality TEXT NOT NULL DEFAULT 'medium',
      reasons_json TEXT NOT NULL DEFAULT '[]',
      conditions_matched_json TEXT NOT NULL DEFAULT '[]',
      source_modules_json TEXT NOT NULL DEFAULT '[]',
      simulation_only INTEGER NOT NULL DEFAULT 0,
      acknowledged_at INTEGER,
      dismissed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_strategic_signals_status ON strategic_signals (status);
    CREATE INDEX IF NOT EXISTS idx_strategic_signals_asset ON strategic_signals (asset_id);
    CREATE INDEX IF NOT EXISTS idx_strategic_signals_detected ON strategic_signals (detected_at);
  `);
}

export { schema };
