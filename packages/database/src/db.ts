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
  const backupPath = `${dbPath}.backup-${Date.now()}`;

  // 1. Crear copia de seguridad
  fs.copyFileSync(dbPath, backupPath);

  try {
    // 2. Verificar integridad inicial
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
    // 4. Restauración en caso de fallo
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

export { schema };
