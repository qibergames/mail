CREATE TABLE `queue_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retried_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_failures_created_idx` ON `queue_failures` (`created_at`);