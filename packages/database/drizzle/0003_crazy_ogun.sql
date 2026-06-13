-- lots and lot_consumptions were created in 0002 but Drizzle snapshot missed them.
-- Skipping their creation here.
CREATE TABLE `realized_gains` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`amount_sold` real NOT NULL,
	`sale_value_eur` real NOT NULL,
	`cost_basis_eur` real NOT NULL,
	`realized_gain_eur` real NOT NULL,
	`date` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_price_history` (
	`asset_id` text NOT NULL,
	`quote_currency` text DEFAULT 'EUR' NOT NULL,
	`timestamp` integer NOT NULL,
	`price` real NOT NULL,
	`provider` text NOT NULL,
	`interval` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `quote_currency`, `timestamp`, `provider`, `interval`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_price_history`("asset_id", "quote_currency", "timestamp", "price", "provider", "interval", "fetched_at") SELECT "asset_id", "quote_currency", "timestamp", "price", "provider", "interval", "fetched_at" FROM `price_history`;--> statement-breakpoint
DROP TABLE `price_history`;--> statement-breakpoint
ALTER TABLE `__new_price_history` RENAME TO `price_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_price_history_query` ON `price_history` (`asset_id`,`quote_currency`,`interval`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_price_history_fetched` ON `price_history` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `idx_price_history_provider` ON `price_history` (`provider`);--> statement-breakpoint
ALTER TABLE `transaction_legs` ADD `acquisition_value_eur` real;--> statement-breakpoint
ALTER TABLE `transaction_legs` ADD `unit_acquisition_price_eur` real;--> statement-breakpoint
ALTER TABLE `transaction_legs` ADD `valuation_source` text;--> statement-breakpoint
ALTER TABLE `transaction_legs` ADD `valuation_timestamp` integer;--> statement-breakpoint
ALTER TABLE `transaction_legs` ADD `valuation_status` text DEFAULT 'valued';