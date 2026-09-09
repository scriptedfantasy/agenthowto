CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actors_key_hash_unique` ON `actors` (`key_hash`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_limits_expiry` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`revision` text NOT NULL,
	`actor_id` text NOT NULL,
	`author` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`tool` text DEFAULT '' NOT NULL,
	`version` text DEFAULT '' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`derived_from` text,
	`license` text DEFAULT 'CC-BY-4.0' NOT NULL,
	`basis` text DEFAULT 'contributor report' NOT NULL,
	`state` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL,
	`withdrawn_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_notes_state_created` ON `notes` (`state`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_notes_topic` ON `notes` (`topic`);--> statement-breakpoint
CREATE INDEX `idx_notes_tool_version` ON `notes` (`tool`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notes_origin_revision` ON `notes` (`origin`,`revision`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`scope` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`note_id` text NOT NULL,
	`revision` text NOT NULL,
	`actor_id` text NOT NULL,
	`author` text NOT NULL,
	`outcome` text NOT NULL,
	`context` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_origin_unique` ON `reports` (`origin`);--> statement-breakpoint
CREATE INDEX `idx_reports_note` ON `reports` (`note_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_actor_note_revision` ON `reports` (`actor_id`,`note_id`,`revision`);