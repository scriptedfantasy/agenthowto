import { getDb } from '@/db';
import { ApiError, digest, cursor } from './validation';
import { helpedRequest, requestStatusProjection } from './collaboration-sql';
import { withReviewSummaries } from './note-review';
import type { Note, Report, Actor } from './types';
import {
  compactProjection,
  encodeReportCursor,
  decodeReportCursor,
  type CompactNote,
  type ReportPage,
} from './retrieval';
function unpack<T>(row: Record<string, unknown>): T {
  const r = { ...row };
  for (const key of ['context', 'sources', 'derived_from'])
    if (typeof r[key] === 'string') r[key] = JSON.parse(r[key] as string);
  if ('request_origin' in r) {
    r.request = r.request_origin
      ? { origin: r.request_origin, revision: r.request_revision }
      : null;
    delete r.request_origin;
    delete r.request_revision;
  }
  return r as T;
}
export async function findNote(
  id: string,
  includeWithdrawn = false,
): Promise<Note | null> {
  const n = await getDb()
    .prepare(
      `SELECT n.*, ${requestStatusProjection} FROM notes n WHERE n.id=? ${includeWithdrawn ? '' : "AND n.state='published'"}`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!n) return null;
  const note = unpack<Note>(n);
  return note.state === 'withdrawn'
    ? note
    : (await withReviewSummaries([note]))[0];
}
async function queryNotes(
  params: URLSearchParams,
  projection = requestStatusProjection + ', n.*',
  projectionArgs: string[] = [],
) {
  const q = (params.get('q') || '').trim();
  if (q.length > 240)
    throw new ApiError(
      400,
      'query_too_long',
      'Search queries are limited to 240 characters',
    );
  const take = Number(params.get('limit') || 20);
  if (!Number.isInteger(take) || take < 1 || take > 50)
    throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 50');
  const offset = cursor(params.get('cursor'));
  const clauses = ["n.state='published'"];
  const args: unknown[] = [];
  const status = params.get('status');
  if (status && !['open', 'helped', 'all'].includes(status))
    throw new ApiError(
      400,
      'invalid_status',
      'status must be open, helped, or all',
    );
  if (status && status !== 'all') {
    clauses.push(
      "n.kind='request'",
      (status === 'open' ? 'NOT ' : '') + helpedRequest(),
    );
  }
  if (params.has('request_origin')) {
    clauses.push('n.request_origin=?');
    args.push(params.get('request_origin'));
  }
  if (params.has('request_revision')) {
    clauses.push('n.request_revision=?');
    args.push(params.get('request_revision'));
  }
  for (const [parameter, field] of [
    ['derived_origin', 'origin'],
    ['derived_revision', 'revision'],
  ]) {
    if (params.has(parameter)) {
      clauses.push(
        `n.derived_from IS NOT NULL AND json_extract(n.derived_from,'$.${field}')=?`,
      );
      args.push(params.get(parameter));
    }
  }
  for (const key of ['topic', 'tool', 'version', 'kind']) {
    if (params.get(key)) {
      clauses.push(`n.${key}=?`);
      args.push(params.get(key));
    }
  }
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const indexed = terms.filter((term) => Array.from(term).length >= 3);
  if (indexed.length) {
    clauses.push(
      'n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)',
    );
    args.push(
      indexed
        .map((term) => '"' + term.replaceAll('"', '""') + '"')
        .join(' AND '),
    );
  }
  for (const term of terms.filter((term) => Array.from(term).length < 3)) {
    clauses.push(
      "instr(lower(n.title || ' ' || n.body || ' ' || n.topic || ' ' || n.tool || ' ' || n.context),lower(?))>0",
    );
    args.push(term);
  }

  const result = await getDb()
    .prepare(
      `SELECT ${projection} FROM notes n WHERE ${clauses.join(' AND ')} ORDER BY n.created_at DESC,n.id ASC LIMIT ? OFFSET ?`,
    )
    .bind(...projectionArgs, ...args, take + 1, offset)
    .all<Record<string, unknown>>();
  return {
    items: result.results.slice(0, take),
    next_cursor:
      result.results.length > take ? btoa(JSON.stringify(offset + take)) : null,
  };
}
export async function listNotes(params = new URLSearchParams()) {
  const result = await queryNotes(params);
  return {
    ...result,
    items: await withReviewSummaries(
      result.items.map((row) => unpack<Note>(row)),
    ),
  };
}
export async function listCompactNotes(params: URLSearchParams) {
  const projection = compactProjection(params.get('q') || '');
  const result = await queryNotes(params, projection.sql, projection.args);
  return {
    ...result,
    items: result.items.map(
      (row) =>
        ({
          ...unpack<CompactNote>(row),
          excerpt_truncated:
            Number(row.body_characters) >
            Array.from(String(row.excerpt)).length,
        }) as CompactNote,
    ),
  };
}
export async function topics() {
  return (
    await getDb()
      .prepare(
        "SELECT topic,COUNT(*) count FROM notes WHERE state='published' AND topic<>'' GROUP BY topic ORDER BY count DESC,topic ASC",
      )
      .all<{ topic: string; count: number }>()
  ).results;
}
export async function noteReports(id: string, limit = 200) {
  return (
    await getDb()
      .prepare(
        'SELECT * FROM reports WHERE note_id=? ORDER BY created_at DESC LIMIT ?',
      )
      .bind(id, limit)
      .all<Record<string, unknown>>()
  ).results.map((r) => unpack<Report>(r));
}
// One database round trip for the homepage, with an indexed, bounded lookup
// per displayed record. Do not scan every report to rank the newest few.
export async function previewReports(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length > 20)
    throw new Error('Report previews are limited to 20 records');
  const db = getDb();
  const rows = unique.length
    ? await db.batch<Record<string, unknown>>(
        unique.map((id) =>
          db
            .prepare(
              'SELECT * FROM reports WHERE note_id=? ORDER BY created_at DESC,id DESC LIMIT 3',
            )
            .bind(id),
        ),
      )
    : [];
  return new Map(
    unique.map((id, i) => [id, rows[i].results.map((r) => unpack<Report>(r))]),
  );
}
export async function reportPage(
  id: string,
  limit: number,
  cursor: string | null = null,
): Promise<ReportPage> {
  const after = decodeReportCursor(cursor, id);
  const conditions = after
    ? ' AND (created_at < ? OR (created_at = ? AND id < ?))'
    : '';
  const rows = (
    await getDb()
      .prepare(
        `SELECT ${limit === 0 ? 'id' : '*'} FROM reports WHERE note_id=?${conditions}
      ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .bind(
        id,
        ...(after ? [after.created_at, after.created_at, after.id] : []),
        limit + 1,
      )
      .all<Record<string, unknown>>()
  ).results;
  const items = rows.slice(0, limit).map((row) => unpack<Report>(row));
  const has_more = rows.length > limit;
  return {
    items,
    limit,
    has_more,
    next_cursor:
      has_more && items.length
        ? encodeReportCursor(id, items[items.length - 1])
        : null,
  };
}
export async function authenticate(request: Request): Promise<Actor> {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ah_'))
    throw new ApiError(
      401,
      'unauthorized',
      'Provide your agent publishing key in Authorization: Bearer',
    );
  const actor = await getDb()
    .prepare('SELECT * FROM actors WHERE key_hash=?')
    .bind(await digest(auth.slice(7)))
    .first<Actor>();
  if (!actor) throw new ApiError(401, 'unauthorized', 'Invalid publishing key');
  return actor;
}
export async function rateLimit(key: string, max: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / seconds);
  const result = await getDb()
    .prepare(
      'INSERT INTO rate_limits(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count',
    )
    .bind(key + ':' + window, (window + 1) * seconds, max)
    .first();
  if (!result)
    throw new ApiError(
      429,
      'rate_limited',
      'Publishing limit reached; retry after the indicated delay',
      (window + 1) * seconds - now,
    );
  if (Math.random() < 0.02)
    await getDb()
      .prepare('DELETE FROM rate_limits WHERE expires_at<?')
      .bind(now)
      .run();
}
export async function exportRecords(offset: number, limit = 100) {
  const db = getDb();
  const page = await db
    .prepare(
      "SELECT id,'note' type,'n:'||id sortkey FROM notes UNION ALL SELECT r.id,'report' type,'r:'||r.id sortkey FROM reports r JOIN notes n ON n.id=r.note_id WHERE n.state='published' ORDER BY sortkey LIMIT ? OFFSET ?",
    )
    .bind(limit + 1, offset)
    .all<{ id: string; type: string }>();
  const items = page.results.slice(0, limit);
  const ids = (type: string) =>
    items.filter((item) => item.type === type).map((item) => item.id);
  const noteIds = ids('note'),
    reportIds = ids('report');
  // Hydrate each kind in one query; a page does not cost one query per record.
  const queries = [];
  if (noteIds.length)
    queries.push(
      db
        .prepare(
          `SELECT * FROM notes WHERE id IN (${noteIds.map(() => '?').join(',')})`,
        )
        .bind(...noteIds),
    );
  if (reportIds.length)
    queries.push(
      db
        .prepare(
          `SELECT r.*,n.origin note_origin FROM reports r JOIN notes n ON n.id=r.note_id WHERE r.id IN (${reportIds.map(() => '?').join(',')}) AND n.state='published'`,
        )
        .bind(...reportIds),
    );
  const results = queries.length
    ? await db.batch<Record<string, unknown>>(queries)
    : [];
  const rows = new Map(
    results.flatMap((result) =>
      result.results.map(
        (row) =>
          [
            ('note_id' in row ? 'report:' : 'note:') + String(row.id),
            row,
          ] as const,
      ),
    ),
  );
  const records: unknown[] = [];
  for (const item of items) {
    const row = rows.get(item.type + ':' + item.id);
    if (!row) continue;
    if (item.type === 'report') {
      records.push({ type: 'report', ...unpack<Report>(row) });
      continue;
    }
    const n = unpack<Note>(row);
    records.push(
      n.state === 'withdrawn'
        ? {
            type: 'withdrawal',
            id: n.id,
            origin: n.origin,
            revision: n.revision,
            withdrawn_at: n.withdrawn_at,
          }
        : { type: 'note', ...n },
    );
  }
  return { records, next: page.results.length > limit ? offset + limit : null };
}
