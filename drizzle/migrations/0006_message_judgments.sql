ALTER TABLE `messages` ADD `category` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `importance` real;--> statement-breakpoint
ALTER TABLE `messages` ADD `insight` text;--> statement-breakpoint
CREATE INDEX `messages_mailbox_category_idx` ON `messages` (`mailbox_id`,`category`);