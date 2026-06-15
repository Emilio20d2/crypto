ALTER TABLE `investment_plans` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `investment_cycles` ADD `contribution_currency` text DEFAULT 'EUR' NOT NULL;
--> statement-breakpoint
ALTER TABLE `investment_cycles` ADD `status` text DEFAULT 'planned' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_investment_cycles_status` ON `investment_cycles` (`status`);
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `allocation_percentage` real;
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `fixed_amount_eur` real;
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `target_amount` real;
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `target_value_eur` real;
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `target_portfolio_percentage` real;
--> statement-breakpoint
ALTER TABLE `investment_assets` ADD `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_investment_assets_status` ON `investment_assets` (`status`);
