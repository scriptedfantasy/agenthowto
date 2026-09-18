import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/observations-data.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const {
  originGroupsSql,
  discoveryGroupsSql,
  reuseTotalsSql,
  reuseChainsSql,
  reuseEventsSql,
  relationshipsTotalsSql,
  relationshipsPairsSql,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE actors(id TEXT PRIMARY KEY,profile TEXT DEFAULT '{}');
CREATE TABLE notes(id TEXT PRIMARY KEY,actor_id TEXT,author TEXT,title TEXT,body TEXT,
  origin TEXT,revision TEXT,created_at TEXT,state TEXT,context TEXT,derived_from TEXT);
CREATE INDEX idx_notes_activity ON notes(created_at,actor_id);
CREATE INDEX idx_notes_actor_created ON notes(actor_id,created_at);
CREATE UNIQUE INDEX idx_notes_origin_revision ON notes(origin,revision);
CREATE TABLE reports(id TEXT PRIMARY KEY,note_id TEXT,revision TEXT,actor_id TEXT,author TEXT,outcome TEXT,evidence TEXT,created_at TEXT);
CREATE INDEX idx_reports_activity ON reports(created_at,note_id);`);
const start = '2026-09-01T00:00:00.000Z',
  end = '2026-09-15T11:30:00.000Z';
const add = (
  id,
  actor,
  day,
  {
    author = actor,
    platform,
    derived,
    state = 'published',
    body = 'An observation.',
  } = {},
) =>
  db
    .prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      actor,
      author,
      id,
      body,
      'https://example.test/notes/' + id,
      'r1',
      '2026-09-' + day + 'T10:00:00.000Z',
      state,
      JSON.stringify(platform ? { platform } : {}),
      derived ? JSON.stringify(derived) : null,
    );
const parent = { origin: 'https://example.test/notes/parent', revision: 'r1' };
add('parent', 'a', '12', { author: 'a-ilands' });
add('derived', 'b', '13', { platform: 'Task platform', derived: parent });
add('mention', 'c', '14', {
  platform: 'Another platform',
  body: 'I read https://example.test/notes/parent',
});
add('self', 'a', '13', { author: 'a-ilands', derived: parent });
add('withdrawn', 'b', '14', { state: 'withdrawn', derived: parent });
add('wrong-revision', 'd', '14', { derived: { ...parent, revision: 'wrong' } });
add('seed', 'seed-codex', '09', { platform: 'Starter' });
db.prepare('INSERT INTO actors VALUES (?,?)').run(
  'b',
  JSON.stringify({
    platform: 'iLands',
    discovery: { method: 'agent', url: 'https://example.test/source' },
  }),
);
const groups = db.prepare(originGroupsSql).all(start, end, end);
assert.equal(
  groups.reduce((n, g) => n + g.entities, 0),
  4,
);
assert.equal(groups.find((g) => g.basis === 'profile').platform, 'ilands');
assert.equal(groups.find((g) => g.basis === 'profile').example_actor, 'b');
assert.equal(
  groups.find((g) => g.basis === 'post_metadata').platform,
  'another platform',
);
assert.equal(groups.find((g) => g.basis === 'author_label').example_actor, 'a');
assert.equal(groups.find((g) => g.basis === 'unknown').entities, 1);
assert.equal(groups.find((g) => g.basis === 'unknown').example_actor, 'd');
const discovery = db.prepare(discoveryGroupsSql).all(start, end);
assert.equal(discovery.find((g) => g.method === 'agent').entities, 1);
assert.equal(discovery.find((g) => g.method === 'unknown').entities, 3);
const report = (
  id,
  actor,
  outcome,
  note = 'parent',
  revision = 'r1',
  date = '2026-09-14T10:00:00.000Z',
) =>
  db
    .prepare('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?)')
    .run(id, note, revision, actor, actor, outcome, 'Evidence ' + id, date);
report('r1', 'b', 'worked');
report('r2', 'a', 'worked');
report('r3', 'c', 'flag');
report('r4', 'd', 'needs_context');
report('r5', 'e', 'failed');
report('r6', 'c', 'worked', 'withdrawn');
report('r7', 'c', 'worked', 'parent', 'wrong');
report('r8', 'c', 'worked', 'parent', 'r1', '2026-08-31T23:59:59.999Z');
const args = [start, end, start, end];
assert.deepEqual(
  { ...db.prepare(reuseTotalsSql).get(...args) },
  { posts: 1, entities: 3, reports: 3, derivations: 1 },
);
const chains = db.prepare(reuseChainsSql).all(...args);
assert.equal(chains.length, 1);
assert.equal(chains[0].parent_id, 'parent');
assert.equal(chains[0].responses, 4);
const events = db.prepare(reuseEventsSql).all(...args, 'parent');
assert.equal(events.length, 3);
assert.ok(events.every((e) => e.actor_id !== 'a' && e.type !== 'flag'));
assert.deepEqual(
  { ...db.prepare(relationshipsTotalsSql).get(start, end) },
  {
    reports: 3,
    pairs: 3,
    repeated_pairs: 0,
    largest_pair_reports: 1,
  },
);
add('another-parent', 'a', '13');
report('repeat', 'b', 'failed', 'another-parent');
report('reverse', 'a', 'worked', 'derived');
report('starter-author', 'b', 'worked', 'seed');
report('starter-reporter', 'seed-codex', 'worked');
assert.deepEqual(
  { ...db.prepare(relationshipsTotalsSql).get(start, end) },
  {
    reports: 5,
    pairs: 4,
    repeated_pairs: 1,
    largest_pair_reports: 2,
  },
);
const pairs = db.prepare(relationshipsPairsSql).all(start, end);
assert.equal(pairs[0].reporter_id, 'b');
assert.equal(pairs[0].author_id, 'a');
assert.equal(pairs[0].worked, 1);
assert.equal(pairs[0].failed, 1);
assert.equal(pairs[0].posts, 2);
assert.equal(pairs[0].reverse_reports, 1);
db.prepare(
  "DELETE FROM reports WHERE id IN ('repeat','reverse','starter-author','starter-reporter')",
).run();
// Withdrawals remove the entire public chain without exposing its prior text.
db.prepare(
  "UPDATE notes SET state='withdrawn',body='' WHERE id='parent'",
).run();
assert.deepEqual(
  { ...db.prepare(reuseTotalsSql).get(...args) },
  { posts: 0, entities: 0, reports: 0, derivations: 0 },
);
assert.equal(db.prepare(reuseChainsSql).all(...args).length, 0);
assert.equal(
  db.prepare(originGroupsSql).all('2026-07-01', '2026-08-01', '2026-08-01')
    .length,
  0,
);
db.close();
console.log(
  'Observation checks passed: origin precedence, evidence, unknowns, distinct accounts, discovery, cross-account reuse, exact revisions, self-reports, flags, withdrawal and bounds.',
);
