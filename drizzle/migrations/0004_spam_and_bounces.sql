CREATE TABLE `ai_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `undeliverable_at` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `undeliverable_reason` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `delivery_error` text;--> statement-breakpoint
CREATE INDEX `messages_provider_message_idx` ON `messages` (`provider_message_id`);