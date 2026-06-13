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

export function runMigrations(migrationsFolder: string) {
  if (!dbInstance) throw new Error("Database not initialized");
  migrate(dbInstance, { migrationsFolder });
}

export function getDb() {
  if (!dbInstance) throw new Error("Database not initialized");
  return dbInstance;
}

export { schema };
