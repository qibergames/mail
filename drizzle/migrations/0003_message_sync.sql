CREATE TABLE `message_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_tombstones_user_deleted_idx` ON `message_tombstones` (`user_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `updated_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_mailbox_updated_idx` ON `messages` (`mailbox_id`,`updated_at`);