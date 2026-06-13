import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

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
  legType: text("leg_type").notNull(), // "source" | "destination" | "fee"
  valuationEur: real("valuation_eur") // Total value in EUR
});

export const fees = sqliteTable("fees", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  amount: real("amount").notNull()
});

export const lots = sqliteTable("lots", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  date: integer("date").notNull(),
  originalAmount: real("original_amount").notNull(),
  remainingAmount: real("remaining_amount").notNull(),
  unitAcquisitionPriceEur: real("unit_acquisition_price_eur").notNull(),
  isFullyConsumed: integer("is_fully_consumed").notNull().default(0) // boolean
});

export const lotConsumptions = sqliteTable("lot_consumptions", {
  id: text("id").primaryKey(),
  lotId: text("lot_id").notNull().references(() => lots.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }), // The sell/convert transaction
  amountConsumed: real("amount_consumed").notNull(),
  unitSellPriceEur: real("unit_sell_price_eur").notNull(),
  realizedGainEur: real("realized_gain_eur").notNull(),
  date: integer("date").notNull()
});

export const priceHistory = sqliteTable("price_history", {
  assetId: text("asset_id").notNull().references(() => assets.id),
  quoteCurrency: text("quote_currency").notNull().default("EUR"),
  timestamp: integer("timestamp").notNull(),
  price: real("price").notNull(),
  provider: text("provider").notNull(),
  interval: text("interval").notNull(), // '1m', '5m', '1h', '1d' etc.
  fetchedAt: integer("fetched_at").notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.assetId, table.quoteCurrency, table.timestamp, table.provider, table.interval] }),
    idx1: index("idx_price_history_query").on(table.assetId, table.quoteCurrency, table.interval, table.timestamp),
    idx2: index("idx_price_history_fetched").on(table.fetchedAt),
    idx3: index("idx_price_history_provider").on(table.provider)
  };
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
