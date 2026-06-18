ALTER TABLE `cycle_rebuy_tiers` ADD `asset_id` text REFERENCES `assets`(`id`);
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `name` text;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `priority` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `status` text DEFAULT 'activa';
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `effective_date` integer;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `notes` text;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `reference_type` text DEFAULT 'max_since_sale';
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `reference_value` real;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `reference_date` integer;
--> statement-breakpoint
ALTER TABLE `cycle_rebuy_tiers` ADD `last_triggered_at` integer;
