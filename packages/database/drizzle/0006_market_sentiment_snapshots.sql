CREATE TABLE `market_sentiment_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `asset_id` text,
  `timeframe` text NOT NULL,
  `score` real NOT NULL,
  `confidence` real NOT NULL,
  `direction` text NOT NULL,
  `factors_json` text NOT NULL,
  `source_summary_json` text DEFAULT '[]' NOT NULL,
  `state` text NOT NULL,
  `methodology` text,
  `calculated_at` integer NOT NULL,
  `valid_until` integer,
  `source_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_sentiment_query` ON `market_sentiment_snapshots` (`scope`,`asset_id`,`timeframe`,`calculated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_market_sentiment_snapshot` ON `market_sentiment_snapshots` (`id`);
