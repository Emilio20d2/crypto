CREATE TABLE `perspectives_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'personalizado' NOT NULL,
	`target_amount_eur` real NOT NULL,
	`target_date` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
