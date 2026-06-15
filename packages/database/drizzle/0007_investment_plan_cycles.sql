CREATE TABLE `investment_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `base_currency` text DEFAULT 'EUR' NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_investment_plans_status` ON `investment_plans` (`status`);
--> statement-breakpoint
CREATE TABLE `investment_cycles` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `name` text NOT NULL,
  `start_date` integer NOT NULL,
  `end_date` integer,
  `monthly_amount_eur` real NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`plan_id`) REFERENCES `investment_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_investment_cycles_plan` ON `investment_cycles` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_investment_cycles_dates` ON `investment_cycles` (`start_date`,`end_date`);
--> statement-breakpoint
CREATE TABLE `investment_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `cycle_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `allocation_type` text DEFAULT 'percentage' NOT NULL,
  `allocation_value` real NOT NULL,
  `priority` integer DEFAULT 0 NOT NULL,
  `start_date` integer NOT NULL,
  `end_date` integer,
  `is_active` integer DEFAULT 1 NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_investment_assets_cycle` ON `investment_assets` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_investment_assets_asset` ON `investment_assets` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `idx_investment_assets_dates` ON `investment_assets` (`start_date`,`end_date`);
--> statement-breakpoint
CREATE TABLE `strategy_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `cycle_id` text NOT NULL,
  `effective_date` integer NOT NULL,
  `title` text NOT NULL,
  `notes` text,
  `changes_json` text DEFAULT '{}' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_revisions_cycle` ON `strategy_revisions` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_strategy_revisions_date` ON `strategy_revisions` (`effective_date`);
