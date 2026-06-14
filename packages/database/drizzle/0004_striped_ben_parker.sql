ALTER TABLE `accounts` ADD `asset_id` text REFERENCES assets(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance` real DEFAULT 0 NOT NULL;