ALTER TABLE `account` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `impersonated_by` text;