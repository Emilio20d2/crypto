import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(), // Ej. "bitcoin"
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  type: text("type").notNull().default("crypto"), // "crypto" | "fiat"
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "exchange" | "wallet" | "bank"
  createdAt: integer("created_at").notNull()
});

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "buy" | "sell" | "convert" | "transfer_in" | "transfer_out" | "reward" | "staking" | "airdrop" | "fee" | "adjustment"
  date: integer("date").notNull(), // timestamp ms
  externalId: text("external_id"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const transactionLegs = sqliteTable("transaction_legs", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  accountId: text("account_id").references(() => accounts.id),
  amount: real("amount").notNull(), // Positivo = entrada, Negativo = salida
  legType: text("leg_type").notNull() // "source" | "destination" | "fee"
});

export const fees = sqliteTable("fees", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  amount: real("amount").notNull()
});

export const priceHistory = sqliteTable("price_history", {
  assetId: text("asset_id").notNull().references(() => assets.id),
  timestamp: integer("timestamp").notNull(),
  priceEur: real("price_eur").notNull(),
  source: text("source").notNull()
});

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(),
  timestamp: integer("timestamp").notNull(),
  totalValueEur: real("total_value_eur").notNull()
});

export const targets = sqliteTable("targets", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id),
  targetPriceEur: real("target_price_eur").notNull()
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id),
  priceThreshold: real("price_threshold").notNull(),
  direction: text("direction").notNull(), // "above" | "below"
  isActive: integer("is_active").notNull().default(1)
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull()
});

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  timestamp: integer("timestamp").notNull(),
  status: text("status").notNull(),
  itemsProcessed: integer("items_processed").notNull()
});
