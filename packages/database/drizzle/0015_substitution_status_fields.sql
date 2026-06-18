ALTER TABLE `asset_substitutions` ADD `status` text NOT NULL DEFAULT 'aplicada';
--> statement-breakpoint
ALTER TABLE `asset_substitutions` ADD `allocation_transfer_mode` text;
--> statement-breakpoint
ALTER TABLE `asset_substitutions` ADD `allocation_transfer_percentage` real;
--> statement-breakpoint
ALTER TABLE `asset_substitutions` ADD `allocation_transfer_amount` real;
--> statement-breakpoint
ALTER TABLE `asset_substitutions` ADD `applied_at` integer;
--> statement-breakpoint
ALTER TABLE `asset_substitutions` ADD `revision_id` text;
