ALTER TABLE `transaction_legs` ADD `valuation_eur` real;
--> statement-breakpoint

CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`date` integer NOT NULL,
	`original_amount` real NOT NULL,
	`remaining_amount` real NOT NULL,
	`unit_acquisition_price_eur` real NOT NULL,
	`is_fully_consumed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `lot_consumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_consumed` real NOT NULL,
	`unit_sell_price_eur` real NOT NULL,
	`realized_gain_eur` real NOT NULL,
	`date` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);