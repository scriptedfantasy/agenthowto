import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = readFileSync(
  new URL('../lib/activity-data.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { activityRange, fillActivityDays, dailyActivitySql, activityTotalsSql } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
const now = new Date('2026-09-15T11:30:00.000Z');
const current = activityRange(null, now);
assert.equal(current.month, '2026-09');
assert.equal(current.dates.length, 15);
assert.equal(current.end, now.toISOString());
assert.equal(activityRange('2024-02', now).dates.length, 29);
assert.equal(activityRange('2025-02', now).dates.length, 28);
assert.equal(activityRange('2025-12', now).end, '2026-01-01T00:00:00.000Z');
for (const bad of [
  '',
  '2026-13',
  '2026-00',
  '2026-9',
  '2026-09-01',
  '2026-10',
  '1969-12',
  "2026-09' OR 1=1",
])
  assert.throws(() => activityRange(bad, now));

const db = new DatabaseSync(':memory:');
db.exec(
  'CREATE TABLE notes (id TEXT PRIMARY KEY, actor_id TEXT, author TEXT, created_at TEXT, kind TEXT, state TEXT)',
);
db.exec(
  readFileSync(
    new URL('../drizzle/0002_fearless_phantom_reporter.sql', import.meta.url),
    'utf8',
  ),
);
const insert = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?)');
for (const row of [
  [
    'before',
    'a',
    'same label',
    '2026-08-31T23:59:59.999Z',
    'note',
    'published',
  ],
  ['one', 'a', 'same label', '2026-09-01T00:00:00.000Z', 'note', 'published'],
  ['two', 'a', 'new label', '2026-09-01T23:59:59.999Z', 'request', 'published'],
  ['three', 'b', 'same label', '2026-09-02T00:00:00.000Z', 'note', 'published'],
  ['four', 'a', 'new label', '2026-09-02T01:00:00.000Z', 'note', 'withdrawn'],
  [
    'seed',
    'seed-codex',
    'Codex',
    '2026-09-09T10:00:00.000Z',
    'note',
    'published',
  ],
  ['today', 'c', 'third', '2026-09-15T10:00:00.000Z', 'note', 'published'],
  ['future', 'd', 'fourth', '2026-09-15T12:00:00.000Z', 'note', 'published'],
  ['next', 'e', 'fifth', '2026-10-01T00:00:00.000Z', 'note', 'published'],
])
  insert.run(...row);
const rows = db.prepare(dailyActivitySql).all(current.start, current.end);
const days = fillActivityDays(current.dates, rows);
assert.deepEqual({ ...days[0] }, { date: '2026-09-01', posts: 2, entities: 1 });
assert.deepEqual({ ...days[1] }, { date: '2026-09-02', posts: 2, entities: 2 });
assert.deepEqual({ ...days[8] }, { date: '2026-09-09', posts: 0, entities: 0 });
assert.deepEqual(
  { ...days[14] },
  { date: '2026-09-15', posts: 1, entities: 1 },
);
assert.deepEqual(
  { ...db.prepare(activityTotalsSql).get(current.start, current.end) },
  { posts: 5, entities: 3 },
);
assert.equal(
  days.reduce((n, d) => n + d.posts, 0),
  5,
);
assert.equal(
  days.reduce((n, d) => n + d.entities, 0),
  4,
); // Monthly identities are not the daily sum.
const empty = activityRange('2026-07', now);
assert.equal(fillActivityDays(empty.dates, []).length, 31);
assert.deepEqual(
  { ...db.prepare(activityTotalsSql).get(empty.start, empty.end) },
  { posts: 0, entities: 0 },
);
for (const sql of [dailyActivitySql, activityTotalsSql]) {
  const plan = db
    .prepare('EXPLAIN QUERY PLAN ' + sql)
    .all(current.start, current.end);
  assert.ok(
    plan.some((r) =>
      r.detail.includes('USING COVERING INDEX idx_notes_activity'),
    ),
    JSON.stringify(plan),
  );
}
db.close();
console.log(
  'Activity checks passed: UTC boundaries, leap years, partial days, empty months, unique identities, seeds, withdrawals, and indexed queries.',
);
