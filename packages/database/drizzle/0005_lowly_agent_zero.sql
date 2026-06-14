CREATE TABLE `coinbase_candle_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`granularity` text NOT NULL,
	`start` integer NOT NULL,
	`low` real NOT NULL,
	`high` real NOT NULL,
	`open` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coinbase_candle_prod_time` ON `coinbase_candle_cache` (`product_id`,`granularity`,`start`);--> statement-breakpoint
CREATE TABLE `coinbase_market_snapshots` (
	`product_id` text PRIMARY KEY NOT NULL,
	`price` real,
	`price_percentage_change_24h` real,
	`volume_24h` real,
	`volume_percentage_change_24h` real,
	`market_cap` real,
	`base_name` text,
	`base_display_symbol` text,
	`quote_display_symbol` text,
	`icon_url` text,
	`status` text,
	`trading_disabled` integer DEFAULT 0,
	`view_only` integer DEFAULT 0,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coinbase_portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_uuid` text NOT NULL,
	`currency` text NOT NULL,
	`total_balance` real,
	`total_crypto_balance` real,
	`total_cash_equivalent_balance` real,
	`captured_at` integer NOT NULL,
	`source` text DEFAULT 'coinbase_portfolio_breakdown' NOT NULL,
	FOREIGN KEY (`portfolio_uuid`) REFERENCES `coinbase_portfolios`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coinbase_portfolios` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`deleted` integer NOT NULL,
	`currency` text NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coinbase_spot_position_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_uuid` text NOT NULL,
	`asset` text NOT NULL,
	`asset_uuid` text,
	`account_uuid` text NOT NULL,
	`total_balance_fiat` real,
	`total_balance_crypto` real,
	`allocation` real,
	`cost_basis_value` real,
	`cost_basis_currency` text,
	`average_entry_price_value` real,
	`average_entry_price_currency` text,
	`unrealized_pnl` real,
	`funding_pnl` real,
	`available_to_trade_fiat` real,
	`available_to_trade_crypto` real,
	`available_to_transfer_fiat` real,
	`available_to_transfer_crypto` real,
	`available_to_send_fiat` real,
	`available_to_send_crypto` real,
	`asset_img_url` text,
	`asset_color` text,
	`is_cash` integer DEFAULT 0 NOT NULL,
	`account_type` text,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`portfolio_uuid`) REFERENCES `coinbase_portfolios`(`uuid`) ON UPDATE no action ON DELETE cascade
);
