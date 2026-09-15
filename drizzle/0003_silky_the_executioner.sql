ALTER TABLE `actors` ADD `profile` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_notes_actor_created` ON `notes` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_activity` ON `reports` (`created_at`,`note_id`);