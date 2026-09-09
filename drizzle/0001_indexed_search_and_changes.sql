CREATE TABLE `changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`type` text NOT NULL,
	`record_id` text NOT NULL,
	`origin` text NOT NULL,
	`revision` text NOT NULL,
	`note_id` text NOT NULL,
	`note_origin` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_event_key_unique` ON `changes` (`event_key`);--> statement-breakpoint
CREATE TABLE `maintenance` (
	`job` text PRIMARY KEY NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DROP INDEX `idx_notes_state_created`;--> statement-breakpoint
CREATE INDEX `idx_notes_feed` ON `notes` (`state`,"created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `idx_notes_kind_feed` ON `notes` (`state`,`kind`,"created_at" desc,`id`);--> statement-breakpoint
CREATE INDEX `idx_notes_state_topic` ON `notes` (`state`,`topic`);--> statement-breakpoint
-- FTS5 is managed by these triggers; Drizzle has no virtual-table declaration.
-- Existing rows are indexed separately in bounded, restartable batches.
CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED,title,body,topic,tool,context,tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER notes_search_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid,note_id,title,body,topic,tool,context) VALUES (new.rowid,new.id,new.title,new.body,new.topic,new.tool,new.context);
END;
--> statement-breakpoint
CREATE TRIGGER notes_search_update AFTER UPDATE OF title,body,topic,tool,context ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid=old.rowid;
  INSERT INTO notes_fts(rowid,note_id,title,body,topic,tool,context) VALUES (new.rowid,new.id,new.title,new.body,new.topic,new.tool,new.context);
END;
--> statement-breakpoint
CREATE TRIGGER notes_search_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid=old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER notes_change_insert AFTER INSERT ON notes BEGIN
  INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
  VALUES (CASE WHEN new.state='withdrawn' THEN 'withdrawal:' ELSE 'note:' END || new.id,
    CASE WHEN new.state='withdrawn' THEN 'withdrawal' ELSE 'note' END,new.id,new.origin,new.revision,new.id,new.origin,COALESCE(new.withdrawn_at,new.created_at));
END;
--> statement-breakpoint
CREATE TRIGGER notes_change_withdraw AFTER UPDATE OF state ON notes WHEN old.state<>'withdrawn' AND new.state='withdrawn' BEGIN
  INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
  VALUES ('withdrawal:'||new.id,'withdrawal',new.id,new.origin,new.revision,new.id,new.origin,COALESCE(new.withdrawn_at,new.created_at));
END;
--> statement-breakpoint
CREATE TRIGGER reports_change_insert AFTER INSERT ON reports BEGIN
  INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
  SELECT 'report:'||new.id,'report',new.id,new.origin,new.revision,new.note_id,n.origin,new.created_at
  FROM notes n WHERE n.id=new.note_id AND n.state='published';
END;
