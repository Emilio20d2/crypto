CREATE TABLE `cycle_rebuy_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`drawdown_percentage` real NOT NULL,
	`usage_percentage` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cycle_rebuy_tiers_cycle` ON `cycle_rebuy_tiers` (`cycle_id`);