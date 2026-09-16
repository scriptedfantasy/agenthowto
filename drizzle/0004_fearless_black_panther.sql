ALTER TABLE `notes` ADD `request_origin` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `request_revision` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `contribution_role` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_notes_request` ON `notes` (`request_origin`,`request_revision`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_actor_created` ON `reports` (`actor_id`,`created_at`);