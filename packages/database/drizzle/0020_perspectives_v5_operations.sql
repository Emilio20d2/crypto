CREATE TABLE IF NOT EXISTS `perspectives_v5_trading_settings` (
  `id` text PRIMARY KEY NOT NULL DEFAULT 'global',
  `trading_mode` text NOT NULL DEFAULT 'REVIEW_ONLY',
  `updated_at` integer NOT NULL,
  `updated_by` text
);
--> statement-breakpoint
INSERT OR IGNORE INTO `perspectives_v5_trading_settings` (`id`, `trading_mode`, `updated_at`, `updated_by`)
VALUES ('global', 'REVIEW_ONLY', 0, 'migration');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_programmed_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `simulation_operation_id` text NOT NULL,
  `simulation_id` text NOT NULL,
  `scenario_id` text NOT NULL,
  `path_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `operation_type` text NOT NULL,
  `target_price_eur` real NOT NULL,
  `trigger_operator` text NOT NULL,
  `percentage` real NOT NULL,
  `percentage_basis` text NOT NULL,
  `frozen_units` real,
  `frozen_amount_eur` real,
  `available_units_at_freeze` real,
  `operating_reserve_at_freeze_eur` real,
  `fiscal_reserve_excluded_eur` real NOT NULL DEFAULT 0,
  `execution_mode` text NOT NULL,
  `product_id` text,
  `cycle_id` text,
  `plan_id` text,
  `goal_id` text,
  `source_sale_operation_id` text,
  `source_reserve_bucket_id` text,
  `depends_on_operation_id` text,
  `state` text NOT NULL DEFAULT 'DRAFT',
  `local_error_code` text,
  `local_error_message` text,
  `reason` text NOT NULL,
  `confidence` real NOT NULL,
  `sources_json` text NOT NULL DEFAULT '[]',
  `planned_json` text NOT NULL,
  `actual_json` text NOT NULL DEFAULT '{}',
  `simulated_at` integer NOT NULL,
  `frozen_at` integer,
  `expected_from` integer,
  `expected_to` integer,
  `expires_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_perspectives_v5_programmed_sim_op`
  ON `perspectives_v5_programmed_operations` (`simulation_operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_perspectives_v5_programmed_state`
  ON `perspectives_v5_programmed_operations` (`state`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_perspectives_v5_programmed_dependency`
  ON `perspectives_v5_programmed_operations` (`depends_on_operation_id`, `state`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_operation_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `programmed_operation_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `reserve_type` text NOT NULL,
  `reserved_units` real,
  `reserved_amount_eur` real,
  `released_units` real NOT NULL DEFAULT 0,
  `released_amount_eur` real NOT NULL DEFAULT 0,
  `filled_units` real NOT NULL DEFAULT 0,
  `filled_amount_eur` real NOT NULL DEFAULT 0,
  `source_reserve_bucket_id` text,
  `state` text NOT NULL DEFAULT 'RESERVED',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`programmed_operation_id`) REFERENCES `perspectives_v5_programmed_operations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_perspectives_v5_reservations_asset`
  ON `perspectives_v5_operation_reservations` (`asset_id`, `reserve_type`, `state`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_coinbase_previews` (
  `id` text PRIMARY KEY NOT NULL,
  `programmed_operation_id` text NOT NULL,
  `client_order_id` text NOT NULL,
  `product_id` text NOT NULL,
  `side` text NOT NULL,
  `limit_price_eur` real NOT NULL,
  `units` real,
  `amount_eur` real,
  `fee_eur` real,
  `preview_id` text,
  `preview_token` text,
  `preview_json` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`programmed_operation_id`) REFERENCES `perspectives_v5_programmed_operations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_perspectives_v5_previews_client`
  ON `perspectives_v5_coinbase_previews` (`client_order_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_coinbase_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `programmed_operation_id` text NOT NULL,
  `preview_id` text,
  `client_order_id` text NOT NULL,
  `coinbase_order_id` text,
  `product_id` text NOT NULL,
  `side` text NOT NULL,
  `state` text NOT NULL,
  `coinbase_state` text,
  `submitted_at` integer,
  `last_checked_at` integer,
  `order_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`programmed_operation_id`) REFERENCES `perspectives_v5_programmed_operations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_perspectives_v5_orders_client`
  ON `perspectives_v5_coinbase_orders` (`client_order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_perspectives_v5_orders_coinbase`
  ON `perspectives_v5_coinbase_orders` (`coinbase_order_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_coinbase_fills` (
  `fill_id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL,
  `client_order_id` text NOT NULL,
  `programmed_operation_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `product_id` text NOT NULL,
  `side` text NOT NULL,
  `units` real NOT NULL,
  `price_eur` real NOT NULL,
  `gross_value_eur` real NOT NULL,
  `fee_eur` real NOT NULL,
  `net_value_eur` real NOT NULL,
  `executed_at` integer NOT NULL,
  `synchronized_at` integer,
  `fill_json` text NOT NULL DEFAULT '{}',
  FOREIGN KEY (`programmed_operation_id`) REFERENCES `perspectives_v5_programmed_operations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_perspectives_v5_fills_order`
  ON `perspectives_v5_coinbase_fills` (`order_id`, `executed_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `perspectives_v5_live_authorizations` (
  `id` text PRIMARY KEY NOT NULL,
  `programmed_operation_id` text,
  `user_label` text NOT NULL,
  `asset_id` text NOT NULL,
  `operation_type` text NOT NULL,
  `product_id` text NOT NULL,
  `max_single_operation_eur` real NOT NULL,
  `max_daily_notional_eur` real NOT NULL,
  `max_daily_operations` integer NOT NULL,
  `max_fee_eur` real NOT NULL,
  `minimum_residual_units` real,
  `expires_at` integer NOT NULL,
  `revoked_at` integer,
  `authorization_text` text NOT NULL,
  `created_at` integer NOT NULL
);
