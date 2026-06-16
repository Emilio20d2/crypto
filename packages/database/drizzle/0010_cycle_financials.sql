ALTER TABLE `transactions` ADD `cycle_id` text REFERENCES investment_cycles(id);
--> statement-breakpoint
CREATE INDEX `idx_transactions_cycle` ON `transactions` (`cycle_id`);
--> statement-breakpoint
ALTER TABLE `cycle_liquidity_allocations` ADD `source_type` text DEFAULT 'eurc' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cycle_liquidity_allocations` ADD `target_asset_id` text REFERENCES assets(id);
--> statement-breakpoint
CREATE TABLE `cycle_partial_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`percentage_of_holding` real NOT NULL,
	`proceeds_eur` real NOT NULL,
	`date` integer NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cycle_partial_sales_cycle` ON `cycle_partial_sales` (`cycle_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cycle_partial_sales_transaction` ON `cycle_partial_sales` (`transaction_id`);
