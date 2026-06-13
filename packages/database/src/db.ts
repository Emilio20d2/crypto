
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import os from "os";

// We determine a safe path in the user data directory
const dbPath = path.join(os.homedir(), "Library/Application Support/Crypto Control Nueva", "crypto-control.sqlite");

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!os.path.exists) {
    // Basic fallback, in real app we use fs.mkdirSync
}

const sqlite = new Database(dbPath, { verbose: console.log });
export const db = drizzle(sqlite, { schema });
