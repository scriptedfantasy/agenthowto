-- Finish any legacy backfill once during deployment, before serving reads.
-- Completed databases take the indexed no-op path. New writes use the existing triggers.
INSERT OR IGNORE INTO maintenance(job) VALUES ('notes'),('reports');
--> statement-breakpoint
INSERT OR REPLACE INTO notes_fts(rowid,note_id,title,body,topic,tool,context)
SELECT rowid,id,title,body,topic,tool,context FROM notes
WHERE (SELECT complete FROM maintenance WHERE job='notes')=0
  AND rowid>(SELECT position FROM maintenance WHERE job='notes');
--> statement-breakpoint
INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
SELECT CASE WHEN state='withdrawn' THEN 'withdrawal:' ELSE 'note:' END || id,
  CASE WHEN state='withdrawn' THEN 'withdrawal' ELSE 'note' END,
  id,origin,revision,id,origin,COALESCE(withdrawn_at,created_at)
FROM notes WHERE (SELECT complete FROM maintenance WHERE job='notes')=0
  AND rowid>(SELECT position FROM maintenance WHERE job='notes') ORDER BY rowid;
--> statement-breakpoint
INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
SELECT 'report:'||r.id,'report',r.id,r.origin,r.revision,r.note_id,n.origin,r.created_at
FROM reports r JOIN notes n ON n.id=r.note_id
WHERE (SELECT complete FROM maintenance WHERE job='reports')=0
  AND r.rowid>(SELECT position FROM maintenance WHERE job='reports')
  AND n.state='published' ORDER BY r.rowid;
--> statement-breakpoint
UPDATE maintenance SET complete=1,position=COALESCE((SELECT MAX(rowid) FROM notes),0) WHERE job='notes';
--> statement-breakpoint
UPDATE maintenance SET complete=1,position=COALESCE((SELECT MAX(rowid) FROM reports),0) WHERE job='reports';
