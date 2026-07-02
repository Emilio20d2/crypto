CREATE TABLE IF NOT EXISTS `market_series_cache_v2` (
  `asset_id` text NOT NULL,
  `quote_currency` text NOT NULL,
  `period` text NOT NULL,
  `provider` text NOT NULL,
  `data_json` text NOT NULL,
  `point_count` integer NOT NULL,
  `coverage_start` integer,
  `coverage_end` integer,
  `fetched_at` integer NOT NULL,
  PRIMARY KEY (`asset_id`, `quote_currency`, `period`, `provider`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_market_series_cache_lookup`
  ON `market_series_cache_v2` (`asset_id`, `quote_currency`, `period`, `fetched_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `portfolio_transaction_cache_v2` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `data_json` text NOT NULL,
  `generated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_transaction_insert`
AFTER INSERT ON `transactions` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_transaction_update`
AFTER UPDATE ON `transactions` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_transaction_delete`
AFTER DELETE ON `transactions` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_leg_insert`
AFTER INSERT ON `transaction_legs` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_leg_update`
AFTER UPDATE ON `transaction_legs` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_leg_delete`
AFTER DELETE ON `transaction_legs` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_fee_insert`
AFTER INSERT ON `fees` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_fee_update`
AFTER UPDATE ON `fees` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `invalidate_portfolio_tx_cache_v2_after_fee_delete`
AFTER DELETE ON `fees` BEGIN
  DELETE FROM `portfolio_transaction_cache_v2` WHERE `cache_key` = 'all-transactions';
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automated_operation_policies_v1` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `policy_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automated_policy_enabled`
  ON `automated_operation_policies_v1` (`enabled`, `updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automated_operation_runs_v1` (
  `id` text PRIMARY KEY NOT NULL,
  `policy_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `state` text NOT NULL,
  `proposal_json` text NOT NULL,
  `preview_token` text,
  `preview_id` text,
  `order_ids_json` text DEFAULT '[]' NOT NULL,
  `notional_eur` real DEFAULT 0 NOT NULL,
  `error_code` text,
  `error_message` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`policy_id`) REFERENCES `automated_operation_policies_v1`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_automated_runs_idempotency`
  ON `automated_operation_runs_v1` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automated_runs_policy`
  ON `automated_operation_runs_v1` (`policy_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automated_runs_state`
  ON `automated_operation_runs_v1` (`state`, `updated_at`);
