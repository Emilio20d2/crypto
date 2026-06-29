CREATE TABLE IF NOT EXISTS `profit_harvest_cycles` (
  `id` text PRIMARY KEY NOT NULL,
  `asset_id` text NOT NULL,
  `cycle_id` text,
  `plan_id` text,
  `opened_at` integer NOT NULL,
  `closed_at` integer,
  `status` text DEFAULT 'proposed' NOT NULL,
  `strategy_mode` text NOT NULL,
  `strategy_source` text NOT NULL,
  `simulation_only` integer DEFAULT 1 NOT NULL,
  `requires_user_confirmation` integer DEFAULT 1 NOT NULL,
  `lots_affected_json` text DEFAULT '[]' NOT NULL,
  `units_sold` real NOT NULL,
  `sell_price_eur` real NOT NULL,
  `gross_sale_eur` real NOT NULL,
  `acquisition_cost_eur` real NOT NULL,
  `realized_gain_eur` real NOT NULL,
  `tax_eur` real NOT NULL,
  `costs_eur` real NOT NULL,
  `eurc_fiscal_reserve_eur` real NOT NULL,
  `eurc_operational_eur` real NOT NULL,
  `reason` text NOT NULL,
  `positive_signals_json` text DEFAULT '[]' NOT NULL,
  `negative_signals_json` text DEFAULT '[]' NOT NULL,
  `break_even_rebuy_price_eur` real NOT NULL,
  `minimum_drop_pct` real NOT NULL,
  `target_zone_json` text NOT NULL,
  `rebuys_json` text DEFAULT '[]' NOT NULL,
  `units_rebought` real DEFAULT 0 NOT NULL,
  `additional_units` real DEFAULT 0 NOT NULL,
  `result_vs_hold_eur` real DEFAULT 0 NOT NULL,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`plan_id`) REFERENCES `investment_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_profit_harvest_asset` ON `profit_harvest_cycles` (`asset_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_profit_harvest_cycle` ON `profit_harvest_cycles` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_profit_harvest_status` ON `profit_harvest_cycles` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_profit_harvest_opened` ON `profit_harvest_cycles` (`opened_at`);
