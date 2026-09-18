import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/observer-data.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const q = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const now = new Date('2026-09-18T12:00:35.123Z');
const day = q.observerRange(undefined, now);
const week = q.observerRange('week', now);
assert.equal(day.from, '2026-09-17T12:00:00.000Z');
assert.equal(day.through, '2026-09-18T12:00:00.000Z');
assert.equal(day.bins.length, 24);
assert.equal(week.bins.length, 7);
assert.equal(week.from, '2026-09-11T12:00:00.000Z');
assert.throws(() => q.observerRange('all', now), /Choose/);
assert.equal(day.bins.at(-1).through, day.through);
const db = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((p) => p.endsWith('.sql'))
  .sort())
  db.exec(readFileSync('drizzle/' + file, 'utf8'));
const run = (sql, args = [day.from, day.through]) =>
  db
    .prepare(sql)
    .all(...args)
    .map((row) => ({ ...row }));
assert.deepEqual(run(q.observerTotalsSql), [
  { posts: 0, accounts: 0, withdrawals: 0 },
]);
assert.deepEqual(run(q.observerReportsSql), [
  { reports: 0, worked: 0, failed: 0, needs_context: 0 },
]);
function post(id, actor, date, options = {}) {
  const row = {
    id,
    origin: 'https://fixture.test/notes/' + id,
    revision: 'r1',
    actor_id: actor,
    author: actor,
    title: id,
    body: '🙂'.repeat(500),
    created_at: date,
    topic: 'tools',
    ...options,
  };
  db.prepare(
    `INSERT INTO notes (${Object.keys(row).join(',')}) VALUES (${Object.keys(
      row,
    )
      .map(() => '?')
      .join(',')})`,
  ).run(...Object.values(row));
}
function report(id, note, actor, outcome, options = {}) {
  const row = {
    id,
    origin: 'https://fixture.test/reports/' + id,
    note_id: note,
    revision: 'r1',
    actor_id: actor,
    author: actor,
    outcome,
    context: '{}',
    evidence: id,
    created_at: '2026-09-18T11:00:00.000Z',
    ...options,
  };
  db.prepare(
    `INSERT INTO reports (${Object.keys(row).join(',')}) VALUES (${Object.keys(
      row,
    )
      .map(() => '?')
      .join(',')})`,
  ).run(...Object.values(row));
}
post('start', 'a', day.from);
post('later', 'a', '2026-09-18T01:00:00.000Z');
post('withdrawn', 'b', '2026-09-18T02:00:00.000Z', { state: 'withdrawn' });
post('at-end', 'c', day.through);
post('before', 'c', '2026-09-17T11:59:59.999Z');
post('seed', 'seed-codex', day.from);
assert.deepEqual(run(q.observerTotalsSql), [
  { posts: 3, accounts: 2, withdrawals: 1 },
]);
const bins = run(q.observerBinsSql, [
  day.from,
  day.step_seconds,
  day.from,
  day.through,
]);
assert.deepEqual(
  bins.map((b) => b.bucket),
  [0, 13, 14],
);
assert.equal(
  bins.reduce((s, b) => s + b.accounts, 0),
  3,
);
assert.deepEqual(
  run(q.observerRecentSql).map((r) => r.id),
  ['later', 'start'],
);
assert.equal([...run(q.observerRecentSql)[0].excerpt].length, 280);
assert.equal(run(q.observerRecentSql)[0].excerpt_truncated, 1);
assert.equal(run(q.observerTopicsSql)[0].posts, 2);
assert.equal(run(q.observerTopicsSql)[0].id, 'later');
assert.equal(run(q.observerTotalsSql, [week.from, week.through])[0].posts, 4);
report('success', 'start', 'b', 'worked');
report('self', 'start', 'a', 'failed');
report('context', 'later', 'b', 'needs_context');
report('wrong-revision', 'later', 'c', 'worked', { revision: 'r0' });
report('flag', 'later', 'd', 'flag');
report('withdrawn-report', 'withdrawn', 'c', 'worked');
report('end-report', 'start', 'e', 'worked', { created_at: day.through });
report('seed-report', 'start', 'seed-codex', 'worked');
assert.deepEqual(run(q.observerReportsSql), [
  { reports: 3, worked: 1, failed: 1, needs_context: 1 },
]);
assert.deepEqual(
  run(q.observerMovementSql, [
    day.from,
    day.through,
    day.from,
    day.through,
  ]).map((r) => r.id),
  ['context', 'success'],
);
const derived = { origin: 'https://fixture.test/notes/start', revision: 'r1' };
post('correction', 'a', '2026-09-18T11:30:00.000Z', {
  derived_from: JSON.stringify(derived),
  contribution_role: 'correction',
});
post('bad-derivation', 'b', '2026-09-18T11:31:00.000Z', {
  derived_from: JSON.stringify({ ...derived, revision: 'r0' }),
});
const movement = run(q.observerMovementSql, [
  day.from,
  day.through,
  day.from,
  day.through,
]);
assert.equal(movement[0].type, 'correction');
assert.equal(movement[0].author, 'a'); // Authors can correct their own work.
assert.ok(!movement.some((r) => r.id === 'bad-derivation'));
post('old-question', 'requester', '2026-01-01T00:00:00.000Z', {
  kind: 'request',
});
post('helped-question', 'requester', '2026-01-02T00:00:00.000Z', {
  kind: 'request',
});
post('answer', 'helper', day.from, {
  request_origin: 'https://fixture.test/notes/helped-question',
  request_revision: 'r1',
});
report('helped', 'answer', 'requester', 'worked');
assert.deepEqual(
  run(q.observerRequestsSql, [day.through]).map((r) => r.id),
  ['old-question'],
);
for (let i = 0; i < 10; i++)
  post('topic-' + i, 't', day.from, { topic: i ? 'topic-' + i : '' });
assert.equal(run(q.observerTopicsSql).length, 6);
assert.equal(run(q.observerRecentSql).length, 4);
assert.ok(run(q.observerTopicsSql).some((r) => r.topic === ''));
assert.ok(
  db
    .prepare('EXPLAIN QUERY PLAN ' + q.observerTotalsSql)
    .all(day.from, day.through)
    .some((r) => r.detail.includes('idx_notes_activity')),
);
db.close();
console.log(
  'PASS: Observer windows, empty states, distinct accounts, withdrawals, seeds, bounded Unicode previews, topics, exact revisions, self reports, corrections, and open requests.',
);
