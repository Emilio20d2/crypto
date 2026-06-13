-- Backup the original table (optional, but good practice before redesign)
CREATE TABLE `price_history_new` (
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

-- Copy and transform the existing data
INSERT INTO `price_history_new` (`asset_id`, `quote_currency`, `timestamp`, `price`, `provider`, `interval`, `fetched_at`)
SELECT 
    `asset_id`,
    'EUR' as `quote_currency`,
    `timestamp`,
    `price_eur` as `price`,
    `source` as `provider`,
    '1d' as `interval`, -- Defaulting existing points to daily interval for safety
    strftime('%s', 'now') * 1000 as `fetched_at`
FROM `price_history`;
--> statement-breakpoint

-- Drop the old table and rename the new one
DROP TABLE `price_history`;
--> statement-breakpoint
ALTER TABLE `price_history_new` RENAME TO `price_history`;
--> statement-breakpoint

-- Create indexes
CREATE INDEX `idx_price_history_query` ON `price_history` (`asset_id`, `quote_currency`, `interval`, `timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_price_history_fetched` ON `price_history` (`fetched_at`);
--> statement-breakpoint
CREATE INDEX `idx_price_history_provider` ON `price_history` (`provider`);