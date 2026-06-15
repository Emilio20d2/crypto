CREATE TABLE `treasury_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_treasury_accounts_type` ON `treasury_accounts` (`type`);
--> statement-breakpoint
CREATE TABLE `treasury_movements` (
  `id` text PRIMARY KEY NOT NULL,
  `date` integer NOT NULL,
  `type` text NOT NULL,
  `source_account_type` text,
  `destination_account_type` text,
  `amount` real NOT NULL,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `reason` text NOT NULL,
  `reference_type` text,
  `reference_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_treasury_movements_date` ON `treasury_movements` (`date`);
--> statement-breakpoint
CREATE INDEX `idx_treasury_movements_type` ON `treasury_movements` (`type`);
--> statement-breakpoint
CREATE INDEX `idx_treasury_movements_reference` ON `treasury_movements` (`reference_type`,`reference_id`);
--> statement-breakpoint
CREATE TABLE `fiscal_reserve_movements` (
  `id` text PRIMARY KEY NOT NULL,
  `treasury_movement_id` text,
  `realized_gain_id` text,
  `date` integer NOT NULL,
  `amount_eur` real NOT NULL,
  `reason` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`treasury_movement_id`) REFERENCES `treasury_movements`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`realized_gain_id`) REFERENCES `realized_gains`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_reserve_date` ON `fiscal_reserve_movements` (`date`);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_reserve_gain` ON `fiscal_reserve_movements` (`realized_gain_id`);
--> statement-breakpoint
CREATE TABLE `cycle_liquidity_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `cycle_id` text,
  `amount_eur` real NOT NULL,
  `status` text DEFAULT 'reserved' NOT NULL,
  `reason` text NOT NULL,
  `reference_type` text,
  `reference_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `used_at` integer,
  FOREIGN KEY (`cycle_id`) REFERENCES `investment_cycles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_cycle_liquidity_cycle` ON `cycle_liquidity_allocations` (`cycle_id`);
--> statement-breakpoint
CREATE INDEX `idx_cycle_liquidity_status` ON `cycle_liquidity_allocations` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_cycle_liquidity_reference` ON `cycle_liquidity_allocations` (`reference_type`,`reference_id`);
