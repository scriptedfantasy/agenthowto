import { getDb } from '@/db';
import { ApiError } from './validation';

// Migrations install the schema and triggers. Existing data is copied in bounded,
// restartable batches; new writes maintain their own index and events atomically.
export async function ensureDerivedData() {
  const db = getDb();
  const states = await db
    .prepare(
      "SELECT job,position,complete FROM maintenance WHERE job IN ('notes','reports')",
    )
    .all<{ job: string; position: number; complete: number }>();
  for (const job of ['notes', 'reports'] as const) {
    let state = states.results.find((row) => row.job === job);
    if (state?.complete) continue;
    if (!state) {
      await db
        .prepare('INSERT OR IGNORE INTO maintenance(job) VALUES (?)')
        .bind(job)
        .run();
    }
    let done = false;
    for (let batch = 0; batch < 2; batch++) {
      if (!state || batch > 0) {
        state = (await db
          .prepare('SELECT job,position,complete FROM maintenance WHERE job=?')
          .bind(job)
          .first<{ job: string; position: number; complete: number }>())!;
      }
      if (state!.complete) {
        done = true;
        break;
      }
      const ids = await db
        .prepare(
          `SELECT rowid AS id FROM ${job} WHERE rowid>? ORDER BY rowid LIMIT 50`,
        )
        .bind(state!.position)
        .all<{ id: number }>();
      const end = ids.results.at(-1)?.id || state!.position;
      const complete = ids.results.length < 50 ? 1 : 0;
      const statements =
        job === 'notes'
          ? [
              db
                .prepare(
                  'INSERT OR REPLACE INTO notes_fts(rowid,note_id,title,body,topic,tool,context) SELECT rowid,id,title,body,topic,tool,context FROM notes WHERE rowid>? AND rowid<=?',
                )
                .bind(state!.position, end),
              db
                .prepare(`INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
          SELECT CASE WHEN state='withdrawn' THEN 'withdrawal:' ELSE 'note:' END || id,
          CASE WHEN state='withdrawn' THEN 'withdrawal' ELSE 'note' END,id,origin,revision,id,origin,COALESCE(withdrawn_at,created_at)
          FROM notes WHERE rowid>? AND rowid<=? ORDER BY rowid`)
                .bind(state!.position, end),
            ]
          : [
              db
                .prepare(`INSERT OR IGNORE INTO changes(event_key,type,record_id,origin,revision,note_id,note_origin,occurred_at)
          SELECT 'report:'||r.id,'report',r.id,r.origin,r.revision,r.note_id,n.origin,r.created_at
          FROM reports r JOIN notes n ON n.id=r.note_id WHERE r.rowid>? AND r.rowid<=? AND n.state='published' ORDER BY r.rowid`)
                .bind(state!.position, end),
            ];
      statements.push(
        db
          .prepare(
            'UPDATE maintenance SET position=MAX(position,?),complete=MAX(complete,?) WHERE job=?',
          )
          .bind(end, complete, job),
      );
      await db.batch(statements);
      if (complete) {
        done = true;
        break;
      }
    }
    if (!done)
      throw new ApiError(
        503,
        'index_warming',
        'Existing records are being indexed. Retry shortly; no records have been removed.',
        1,
      );
  }
}
