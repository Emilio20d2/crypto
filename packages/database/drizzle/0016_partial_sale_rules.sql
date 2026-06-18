CREATE TABLE `partial_sale_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text REFERENCES `investment_plans`(`id`),
	`cycle_id` text NOT NULL REFERENCES `investment_cycles`(`id`) ON DELETE CASCADE,
	`investment_asset_id` text REFERENCES `investment_assets`(`id`) ON DELETE SET NULL,
	`asset_id` text NOT NULL REFERENCES `assets`(`id`),
	`name` text NOT NULL,
	`condition_type` text NOT NULL,
	`condition_value` real,
	`condition_value2` real,
	`sell_percentage` real NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'activa' NOT NULL,
	`effective_date` integer,
	`notes` text,
	`last_triggered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_partial_sale_rules_cycle` ON `partial_sale_rules` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_partial_sale_rules_asset` ON `partial_sale_rules` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `idx_partial_sale_rules_status` ON `partial_sale_rules` (`status`);
