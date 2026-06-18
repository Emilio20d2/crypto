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
  assetId: text("asset_id").references(() => assets.id),
  balance: real("balance").notNull().default(0),
  createdAt: integer("created_at").notNull()
});

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "buy" | "sell" | "convert" | "transfer_in" | "transfer_out" | "reward" | "staking" | "airdrop" | "fee" | "adjustment"
  date: integer("date").notNull(), // timestamp ms
  externalId: text("external_id"),
  notes: text("notes"),
  // Explicit override only — when null, the owning cycle is resolved at read
  // time from the cycle's [startDate, endDate ?? now] range so editing or
  // adding cycles later never rewrites historical transactions.
  cycleId: text("cycle_id").references(() => investmentCycles.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxTransactionsCycle: index("idx_transactions_cycle").on(table.cycleId)
  };
});

export const transactionLegs = sqliteTable("transaction_legs", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  accountId: text("account_id").references(() => accounts.id),
  amount: real("amount").notNull(), // Positivo = entrada, Negativo = salida
  legType: text("leg_type").notNull(), // "source" | "destination" | "fee"
  valuationEur: real("valuation_eur"), // @deprecated: use acquisitionValueEur. Migration path (Fase 3/4): write only to acquisitionValueEur in new transactions; add NOT NULL constraint; drop column once all rows have acquisitionValueEur populated.
  acquisitionValueEur: real("acquisition_value_eur"),
  unitAcquisitionPriceEur: real("unit_acquisition_price_eur"),
  valuationSource: text("valuation_source"),
  valuationTimestamp: integer("valuation_timestamp"),
  valuationStatus: text("valuation_status").default("valued") // "valued" | "pending" | "estimated"
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

export const realizedGains = sqliteTable("realized_gains", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  amountSold: real("amount_sold").notNull(),
  saleValueEur: real("sale_value_eur").notNull(),
  costBasisEur: real("cost_basis_eur").notNull(),
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

// @deprecated: Legacy table created in migration 0000. No active reads or writes.
// Portfolio history is stored in coinbasePortfolioSnapshots (migration 0005).
// Cannot be dropped without a new migration — leave in place to avoid breaking existing DBs.
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

export const investmentPlans = sqliteTable("investment_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // "active" | "inactive" | "archived"
  baseCurrency: text("base_currency").notNull().default("EUR"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxInvestmentPlansStatus: index("idx_investment_plans_status").on(table.status)
  };
});

export const investmentCycles = sqliteTable("investment_cycles", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => investmentPlans.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: integer("start_date").notNull(),
  endDate: integer("end_date"),
  monthlyAmountEur: real("monthly_amount_eur").notNull(),
  contributionCurrency: text("contribution_currency").notNull().default("EUR"),
  status: text("status").notNull().default("planned"), // "planned" | "active" | "closed" | "paused"
  priority: integer("priority").notNull().default(0),
  objetivo: text("objetivo"),               // "acumulacion" | "crecimiento" | "preservacion" | "renta"
  riesgo: text("riesgo"),                   // "bajo" | "moderado" | "alto" | "muy_alto"
  allowExtraContributions: integer("allow_extra_contributions").notNull().default(1), // boolean
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxInvestmentCyclesPlan: index("idx_investment_cycles_plan").on(table.planId),
    idxInvestmentCyclesStatus: index("idx_investment_cycles_status").on(table.status),
    idxInvestmentCyclesDates: index("idx_investment_cycles_dates").on(table.startDate, table.endDate)
  };
});

export const investmentAssets = sqliteTable("investment_assets", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  allocationType: text("allocation_type").notNull().default("percentage"), // "percentage" | "amount"
  allocationValue: real("allocation_value").notNull(),
  allocationPercentage: real("allocation_percentage"),
  fixedAmountEur: real("fixed_amount_eur"),
  priority: integer("priority").notNull().default(0),
  targetAmount: real("target_amount"),
  targetValueEur: real("target_value_eur"),
  targetPortfolioPercentage: real("target_portfolio_percentage"),
  startDate: integer("start_date").notNull(),
  endDate: integer("end_date"),
  status: text("status").notNull().default("active"), // "active" | "paused" | "closed" | "goal_reached"
  isActive: integer("is_active").notNull().default(1),
  notes: text("notes"),
  goalReachedAt: integer("goal_reached_at"),
  goalReachedValue: real("goal_reached_value"),
  goalReachedType: text("goal_reached_type"), // "quantity" | "value" | "portfolio_percentage"
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxInvestmentAssetsCycle: index("idx_investment_assets_cycle").on(table.cycleId),
    idxInvestmentAssetsAsset: index("idx_investment_assets_asset").on(table.assetId),
    idxInvestmentAssetsStatus: index("idx_investment_assets_status").on(table.status),
    idxInvestmentAssetsDates: index("idx_investment_assets_dates").on(table.startDate, table.endDate)
  };
});

export const strategyRevisions = sqliteTable("strategy_revisions", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  effectiveDate: integer("effective_date").notNull(),
  title: text("title").notNull(),
  notes: text("notes"),
  changesJson: text("changes_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull()
}, (table) => {
  return {
    idxStrategyRevisionsCycle: index("idx_strategy_revisions_cycle").on(table.cycleId),
    idxStrategyRevisionsDate: index("idx_strategy_revisions_date").on(table.effectiveDate)
  };
});

export const treasuryAccounts = sqliteTable("treasury_accounts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "cash" | "eurc" | "fiscal_reserve"
  name: text("name").notNull(),
  currency: text("currency").notNull().default("EUR"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxTreasuryAccountsType: uniqueIndex("idx_treasury_accounts_type").on(table.type)
  };
});

export const treasuryMovements = sqliteTable("treasury_movements", {
  id: text("id").primaryKey(),
  date: integer("date").notNull(),
  type: text("type").notNull(),
  sourceAccountType: text("source_account_type"),
  destinationAccountType: text("destination_account_type"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxTreasuryMovementsDate: index("idx_treasury_movements_date").on(table.date),
    idxTreasuryMovementsType: index("idx_treasury_movements_type").on(table.type),
    idxTreasuryMovementsReference: index("idx_treasury_movements_reference").on(table.referenceType, table.referenceId)
  };
});

export const fiscalReserveMovements = sqliteTable("fiscal_reserve_movements", {
  id: text("id").primaryKey(),
  treasuryMovementId: text("treasury_movement_id").references(() => treasuryMovements.id, { onDelete: "set null" }),
  realizedGainId: text("realized_gain_id").references(() => realizedGains.id, { onDelete: "set null" }),
  date: integer("date").notNull(),
  amountEur: real("amount_eur").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull()
}, (table) => {
  return {
    idxFiscalReserveDate: index("idx_fiscal_reserve_date").on(table.date),
    idxFiscalReserveGain: index("idx_fiscal_reserve_gain").on(table.realizedGainId)
  };
});

export const cycleLiquidityAllocations = sqliteTable("cycle_liquidity_allocations", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").references(() => investmentCycles.id, { onDelete: "set null" }),
  amountEur: real("amount_eur").notNull(),
  sourceType: text("source_type").notNull().default("eurc"), // "eurc" | "cash"
  targetAssetId: text("target_asset_id").references(() => assets.id), // objetivo de recompra, opcional
  status: text("status").notNull().default("reserved"), // "reserved" | "used" | "released"
  reason: text("reason").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  usedAt: integer("used_at")
}, (table) => {
  return {
    idxCycleLiquidityCycle: index("idx_cycle_liquidity_cycle").on(table.cycleId),
    idxCycleLiquidityStatus: index("idx_cycle_liquidity_status").on(table.status),
    idxCycleLiquidityReference: index("idx_cycle_liquidity_reference").on(table.referenceType, table.referenceId)
  };
});

// Metadato puramente aditivo sobre una venta real ya registrada en
// `transactions` (type "sell"): qué porcentaje de la posición representaba
// en el momento de venderla. Nunca se borra ni recalcula — es histórico.
export const cyclePartialSales = sqliteTable("cycle_partial_sales", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  percentageOfHolding: real("percentage_of_holding").notNull(),
  proceedsEur: real("proceeds_eur").notNull(),
  date: integer("date").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull()
}, (table) => {
  return {
    idxCyclePartialSalesCycle: index("idx_cycle_partial_sales_cycle").on(table.cycleId),
    idxCyclePartialSalesTransaction: uniqueIndex("idx_cycle_partial_sales_transaction").on(table.transactionId)
  };
});

// Plan de aportaciones: registro de contribuciones planificadas (periódicas y
// extraordinarias). Solo planificación — no ejecuta compras automáticamente.
export const contributionSchedule = sqliteTable("contribution_schedule", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("periodica"), // "periodica" | "extraordinaria"
  plannedDate: integer("planned_date").notNull(),
  amountEur: real("amount_eur").notNull(),
  currency: text("currency").notNull().default("EUR"),
  destination: text("destination"),                   // assetId objetivo, null = distribuir según ciclo
  status: text("status").notNull().default("pendiente"), // "pendiente" | "ejecutada" | "cancelada"
  executedAt: integer("executed_at"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxContributionScheduleCycle:  index("idx_contribution_schedule_cycle").on(table.cycleId),
    idxContributionScheduleDate:   index("idx_contribution_schedule_date").on(table.plannedDate),
    idxContributionScheduleStatus: index("idx_contribution_schedule_status").on(table.status)
  };
});

// Historial de sustituciones de activos dentro de un ciclo.
// Mantiene trazabilidad completa: qué se cerró, qué lo sustituyó y por qué.
export const assetSubstitutions = sqliteTable("asset_substitutions", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  fromAssetId: text("from_asset_id").notNull().references(() => assets.id),
  toAssetId: text("to_asset_id").references(() => assets.id), // null = retirada sin sustitución
  fromInvestmentAssetId: text("from_investment_asset_id").references(() => investmentAssets.id, { onDelete: "set null" }),
  toInvestmentAssetId: text("to_investment_asset_id").references(() => investmentAssets.id, { onDelete: "set null" }),
  effectiveDate: integer("effective_date").notNull(),
  status: text("status").notNull().default("aplicada"), // "borrador" | "programada" | "aplicada" | "cancelada"
  allocationTransferMode: text("allocation_transfer_mode"),   // "full" | "custom" | "pending"
  allocationTransferPercentage: real("allocation_transfer_percentage"),
  allocationTransferAmount: real("allocation_transfer_amount"),
  appliedAt: integer("applied_at"),
  revisionId: text("revision_id"),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull()
}, (table) => {
  return {
    idxAssetSubstitutionsCycle: index("idx_asset_substitutions_cycle").on(table.cycleId),
    idxAssetSubstitutionsFrom:  index("idx_asset_substitutions_from").on(table.fromAssetId),
    idxAssetSubstitutionsTo:    index("idx_asset_substitutions_to").on(table.toAssetId),
    idxAssetSubstitutionsDate:  index("idx_asset_substitutions_date").on(table.effectiveDate)
  };
});

// Configurable, never executed automatically — only feeds evaluateRebuyTiers
// to suggest an amount of already-reserved liquidity to deploy after a
// correction. Per cycle so different strategies can use different tiers.
export const cycleRebuyTiers = sqliteTable("cycle_rebuy_tiers", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  assetId: text("asset_id").references(() => assets.id),
  name: text("name"),
  drawdownPercentage: real("drawdown_percentage").notNull(),
  usagePercentage: real("usage_percentage").notNull(),
  priority: integer("priority").default(0),
  status: text("status").default("activa"),
  effectiveDate: integer("effective_date"),
  notes: text("notes"),
  referenceType: text("reference_type").default("max_since_sale"),
  referenceValue: real("reference_value"),
  referenceDate: integer("reference_date"),
  lastTriggeredAt: integer("last_triggered_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxCycleRebuyTiersCycle: index("idx_cycle_rebuy_tiers_cycle").on(table.cycleId)
  };
});

// Configurable partial-sale rules. NOT executed sales — see cycle_partial_sales
// for actual executed sale records linked to real transactions.
export const partialSaleRules = sqliteTable("partial_sale_rules", {
  id: text("id").primaryKey(),
  planId: text("plan_id").references(() => investmentPlans.id),
  cycleId: text("cycle_id").notNull().references(() => investmentCycles.id, { onDelete: "cascade" }),
  investmentAssetId: text("investment_asset_id").references(() => investmentAssets.id, { onDelete: "set null" }),
  assetId: text("asset_id").notNull().references(() => assets.id),
  name: text("name").notNull(),
  conditionType: text("condition_type").notNull(),
  conditionValue: real("condition_value"),
  conditionValue2: real("condition_value2"),
  sellPercentage: real("sell_percentage").notNull(),
  priority: integer("priority").default(0).notNull(),
  status: text("status").default("activa").notNull(),
  effectiveDate: integer("effective_date"),
  notes: text("notes"),
  lastTriggeredAt: integer("last_triggered_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => {
  return {
    idxPartialSaleRulesCycle: index("idx_partial_sale_rules_cycle").on(table.cycleId),
    idxPartialSaleRulesAsset: index("idx_partial_sale_rules_asset").on(table.assetId),
    idxPartialSaleRulesStatus: index("idx_partial_sale_rules_status").on(table.status),
  };
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

// --- COINBASE V3 PURE CACHE TABLES ---

export const coinbasePortfolios = sqliteTable("coinbase_portfolios", {
  uuid: text("uuid").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  deleted: integer("deleted").notNull(), // boolean
  currency: text("currency").notNull(),
  capturedAt: integer("captured_at").notNull()
});

export const coinbasePortfolioSnapshots = sqliteTable("coinbase_portfolio_snapshots", {
  id: text("id").primaryKey(),
  portfolioUuid: text("portfolio_uuid").notNull().references(() => coinbasePortfolios.uuid, { onDelete: "cascade" }),
  currency: text("currency").notNull(),
  totalBalance: real("total_balance"),
  totalCryptoBalance: real("total_crypto_balance"),
  totalCashEquivalentBalance: real("total_cash_equivalent_balance"),
  capturedAt: integer("captured_at").notNull(),
  source: text("source").notNull().default("coinbase_portfolio_breakdown")
});

export const coinbaseSpotPositionSnapshots = sqliteTable("coinbase_spot_position_snapshots", {
  id: text("id").primaryKey(),
  portfolioUuid: text("portfolio_uuid").notNull().references(() => coinbasePortfolios.uuid, { onDelete: "cascade" }),
  asset: text("asset").notNull(),
  assetUuid: text("asset_uuid"),
  accountUuid: text("account_uuid").notNull(),
  totalBalanceFiat: real("total_balance_fiat"),
  totalBalanceCrypto: real("total_balance_crypto"),
  allocation: real("allocation"),
  costBasisValue: real("cost_basis_value"),
  costBasisCurrency: text("cost_basis_currency"),
  averageEntryPriceValue: real("average_entry_price_value"),
  averageEntryPriceCurrency: text("average_entry_price_currency"),
  unrealizedPnl: real("unrealized_pnl"),
  fundingPnl: real("funding_pnl"),
  availableToTradeFiat: real("available_to_trade_fiat"),
  availableToTradeCrypto: real("available_to_trade_crypto"),
  availableToTransferFiat: real("available_to_transfer_fiat"),
  availableToTransferCrypto: real("available_to_transfer_crypto"),
  availableToSendFiat: real("available_to_send_fiat"),
  availableToSendCrypto: real("available_to_send_crypto"),
  assetImageUrl: text("asset_img_url"),
  assetColor: text("asset_color"),
  isCash: integer("is_cash").notNull().default(0), // boolean
  accountType: text("account_type"),
  capturedAt: integer("captured_at").notNull()
});

export const coinbaseMarketSnapshots = sqliteTable("coinbase_market_snapshots", {
  productId: text("product_id").primaryKey(),
  price: real("price"),
  pricePercentageChange24h: real("price_percentage_change_24h"),
  volume24h: real("volume_24h"),
  volumePercentageChange24h: real("volume_percentage_change_24h"),
  marketCap: real("market_cap"),
  baseName: text("base_name"),
  baseDisplaySymbol: text("base_display_symbol"),
  quoteDisplaySymbol: text("quote_display_symbol"),
  iconUrl: text("icon_url"),
  status: text("status"),
  tradingDisabled: integer("trading_disabled").default(0),
  viewOnly: integer("view_only").default(0),
  capturedAt: integer("captured_at").notNull()
});

export const coinbaseCandleCache = sqliteTable("coinbase_candle_cache", {
  id: text("id").primaryKey(), // e.g. "BTC-EUR_3600_1680000000"
  productId: text("product_id").notNull(),
  granularity: text("granularity").notNull(),
  start: integer("start").notNull(),
  low: real("low").notNull(),
  high: real("high").notNull(),
  open: real("open").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull(),
  fetchedAt: integer("fetched_at").notNull()
}, (table) => {
  return {
    idxProductTime: index("idx_coinbase_candle_prod_time").on(table.productId, table.granularity, table.start)
  };
});

export const perspectivesGoals = sqliteTable("perspectives_goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("personalizado"),
  targetAmountEur: real("target_amount_eur").notNull(),
  targetDate: integer("target_date"),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const marketSentimentSnapshots = sqliteTable("market_sentiment_snapshots", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(), // "global" | "asset"
  assetId: text("asset_id"),
  timeframe: text("timeframe").notNull(), // "24h" | "7d" | "30d"
  score: real("score").notNull(),
  confidence: real("confidence").notNull(),
  direction: text("direction").notNull(),
  factorsJson: text("factors_json").notNull(),
  sourceSummaryJson: text("source_summary_json").notNull().default("[]"),
  state: text("state").notNull(),
  methodology: text("methodology"),
  calculatedAt: integer("calculated_at").notNull(),
  validUntil: integer("valid_until"),
  sourceVersion: text("source_version").notNull()
}, (table) => {
  return {
    idxSentimentQuery: index("idx_market_sentiment_query").on(table.scope, table.assetId, table.timeframe, table.calculatedAt),
    uniqSentimentSnapshot: uniqueIndex("uniq_market_sentiment_snapshot").on(table.id)
  };
});
