ALTER TABLE `investment_cycles` ADD `objetivo` text;
--> statement-breakpoint
ALTER TABLE `investment_cycles` ADD `riesgo` text;
--> statement-breakpoint
ALTER TABLE `investment_cycles` ADD `allow_extra_contributions` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `contribution_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`type` text DEFAULT 'periodica' NOT NULL,
	`planned_date` integer NOT NULL,
	`amount_eur` real NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`destination` text,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`executed_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contribution_schedule_cycle` ON `contribution_schedule` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_contribution_schedule_date` ON `contribution_schedule` (`planned_date`);
--> statement-breakpoint
CREATE INDEX `idx_contribution_schedule_status` ON `contribution_schedule` (`status`);
--> statement-breakpoint
CREATE TABLE `asset_substitutions` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`from_asset_id` text NOT NULL,
	`to_asset_id` text,
	`from_investment_asset_id` text,
	`to_investment_asset_id` text,
	`effective_date` integer NOT NULL,
	`reason` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_investment_asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_investment_asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_asset_substitutions_cycle` ON `asset_substitutions` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_asset_substitutions_from` ON `asset_substitutions` (`from_asset_id`);
--> statement-breakpoint
CREATE INDEX `idx_asset_substitutions_to` ON `asset_substitutions` (`to_asset_id`);
--> statement-breakpoint
CREATE INDEX `idx_asset_substitutions_date` ON `asset_substitutions` (`effective_date`);
