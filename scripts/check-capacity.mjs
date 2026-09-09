// Runs only an ephemeral local Worker and D1 database. Never accepts a site URL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

const compiled = unstable_getMiniflareWorkerOptions(
  'dist/server/wrangler.json',
);
const mf = new Miniflare({
  port: 0,
  workers: [
    {
      ...compiled.workerOptions,
      modules: [
        'index.js',
        ...readdirSync('dist/server', { recursive: true }).filter(
          (p) => p.endsWith('.js') && p !== 'index.js',
        ),
      ].map((p) => ({
        type: 'ESModule',
        path: process.cwd() + '/dist/server/' + p,
      })),
      modulesRoot: process.cwd() + '/dist/server',
    },
    ...compiled.externalWorkers,
  ],
});
const run = (script, base) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, base], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Check failed: ' + script)),
    );
  });
const stats = {
  environment: 'isolated local Miniflare Worker and D1; not hosted capacity',
  checks: [],
};
let base, db;
function check(name) {
  stats.checks.push(name);
  console.log('PASS: ' + name);
}
async function request(
  path,
  {
    expected = 200,
    method = 'GET',
    body,
    key,
    idempotency,
    fresh = true,
    headers = {},
  } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(fresh ? { 'Cache-Control': 'no-cache' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    response.status,
    expected,
    path +
      ': ' +
      response.status +
      (response.status !== expected ? ' ' + (await response.text()) : ''),
  );
  return response;
}
async function json(path, options) {
  return (await request(path, options)).json();
}
const register = (label) =>
  json('/register', { method: 'POST', expected: 201, body: { label } });
const publish = (key, idempotency, body) =>
  json('/notes', { method: 'POST', expected: 201, key, idempotency, body });
const changes = (cursor) =>
  json(
    '/changes?limit=100' +
      (cursor ? '&since=' + encodeURIComponent(cursor) : ''),
  );
async function apply(file) {
  for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
    '--> statement-breakpoint',
  ))
    if (sql.trim()) await db.prepare(sql).run();
}
try {
  base = (await mf.ready).origin;
  db = await mf.getD1Database('DB');
  const migrations = readdirSync('drizzle')
    .filter((p) => p.endsWith('.sql'))
    .sort();
  await apply(migrations[0]);
  // Install the new schema over an existing corpus, including a withdrawal and report.
  await db
    .prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i<250)
    INSERT INTO notes(id,origin,revision,actor_id,author,title,body,topic,created_at)
    SELECT 'legacy-'||i,'https://fixture.test/notes/legacy-'||i,'legacy-r1','legacy-actor','Original author',
      'Legacy '||i,'historicalmarker body '||i,'legacy','2026-06-18T10:00:00.000Z' FROM seq`)
    .run();
  await db
    .prepare(
      "UPDATE notes SET state='withdrawn',body='',title='Withdrawn note',withdrawn_at='2026-06-19T00:00:00Z' WHERE id='legacy-0'",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO reports(id,origin,note_id,revision,actor_id,author,outcome,context,evidence,created_at) VALUES ('legacy-report','https://fixture.test/reports/legacy','legacy-1','legacy-r1','reporter','Original reporter','worked','{}','Prior observation','2026-06-18T11:00:00Z')",
    )
    .run();
  for (const file of migrations.slice(1)) await apply(file);
  let warmups = 0;
  for (; warmups < 20; warmups++) {
    const response = await fetch(base + '/search?format=json', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status === 200) {
      await response.arrayBuffer();
      break;
    }
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal((await response.json()).error.code, 'index_warming');
  }
  assert.ok(warmups > 0 && warmups < 20);
  const old = await json('/notes/legacy-1.json');
  assert.equal(old.body, 'historicalmarker body 1');
  assert.equal(old.revision, 'legacy-r1');
  assert.equal(old.origin, 'https://fixture.test/notes/legacy-1');
  assert.equal(old.author, 'Original author');
  const initial = [];
  let cursor, hasMore;
  do {
    const page = await changes(cursor);
    initial.push(...page.items);
    cursor = page.next_cursor;
    hasMore = page.has_more;
  } while (hasMore);
  assert.equal(initial.filter((x) => x.id === 'legacy-report').length, 1);
  assert.equal(
    initial.filter((x) => x.id === 'legacy-0')[0].type,
    'withdrawal',
  );
  assert.equal(initial.filter((x) => x.id === 'legacy-1').length, 1);
  assert.equal(
    (await json('/search?q=historicalmarker&format=json&limit=1')).items.length,
    1,
  );
  check(
    'Existing records backfill in bounded retries without changing bodies, authorship, origins, or revisions',
  );
  await run('scripts/check-node.mjs', base);
  check('Existing HTTP conformance checks');

  const agents = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      register('Shared-IP local test ' + i),
    ),
  );
  assert.equal(new Set(agents.map((x) => x.actor_id)).size, 100);
  check('100 concurrent registrations from one network address');
  const key = agents[0].key;
  const body = {
    body:
      'unique-cache-marker ERESOLVE gh Punctuation: a"b and --flag ' +
      'longquery'.repeat(8),
    topic: 'capacity-test',
    tool: 'test-gh',
  };
  const checkpoint = await json('/changes?since=now');
  const receipts = await Promise.all(
    Array.from({ length: 20 }, () => publish(key, 'concurrent-note', body)),
  );
  const note = receipts[0];
  assert.ok(receipts.every((x) => x.id === note.id));
  await request('/notes', {
    expected: 409,
    method: 'POST',
    key,
    idempotency: 'concurrent-note',
    body: { body: 'different' },
  });
  const reportBody = {
    revision: note.revision,
    outcome: 'worked',
    evidence: 'Local test assertion',
  };
  const reports = await Promise.all(
    Array.from({ length: 20 }, () =>
      json('/notes/' + note.id + '/reports', {
        expected: 201,
        method: 'POST',
        key,
        idempotency: 'concurrent-report',
        body: reportBody,
      }),
    ),
  );
  assert.ok(reports.every((x) => x.id === reports[0].id));
  const liveChanges = await changes(checkpoint.next_cursor);
  assert.deepEqual(
    liveChanges.items.map((x) => x.type),
    ['note', 'report'],
  );
  assert.equal(new Set(liveChanges.items.map((x) => x.sequence)).size, 2);
  check(
    'Concurrent idempotent notes and reports create exactly one record and change event each',
  );

  const coalesced = await Promise.all(
    Array.from({ length: 100 }, async () => {
      const response = await request(
        '/search?q=cold-concurrent-cache-probe&format=json',
        { fresh: false },
      );
      assert.equal((await response.json()).items.length, 0);
      return response.headers.get('etag');
    }),
  );
  assert.equal(new Set(coalesced).size, 1);
  assert.ok(coalesced[0]);
  check(
    '100 simultaneous cold-cache reads share plain data without crossing Worker response streams',
  );

  const notePath = '/notes/' + note.id + '.json';
  const first = await request(notePath, { fresh: false });
  const tag = first.headers.get('etag');
  assert.ok(tag);
  assert.match(first.headers.get('cache-control'), /s-maxage=5/);
  await first.arrayBuffer();
  const hit = await request(notePath, { fresh: false });
  assert.equal(hit.headers.get('x-agenthow-cache'), 'HIT');
  await hit.arrayBuffer();
  const unchanged = await request(notePath, {
    fresh: false,
    expected: 304,
    headers: { 'If-None-Match': tag },
  });
  assert.equal(await unchanged.text(), '');
  const head = await request(notePath, { fresh: false, method: 'HEAD' });
  assert.equal(head.headers.get('etag'), tag);
  assert.equal(await head.text(), '');
  for (const headers of [
    { Authorization: 'Bearer ' + key },
    { Cookie: 'reader=local' },
    { 'Cache-Control': 'no-cache' },
  ]) {
    const bypass = await request(notePath, { fresh: false, headers });
    assert.equal(bypass.headers.get('x-agenthow-cache'), 'BYPASS');
    await bypass.arrayBuffer();
  }
  const checkpointResponse = await request('/changes?since=now', {
    fresh: false,
  });
  assert.equal(checkpointResponse.headers.get('x-agenthow-cache'), 'BYPASS');
  await checkpointResponse.arrayBuffer();
  for (const accept of ['application/json', 'text/markdown']) {
    const response = await request('/search?q=unique-cache-marker', {
      fresh: false,
      headers: { Accept: accept },
    });
    assert.ok(response.headers.get('content-type').startsWith(accept));
    await response.arrayBuffer();
  }
  const error = await request('/search?limit=999&format=json', {
    fresh: false,
    expected: 400,
  });
  assert.equal(error.headers.get('cache-control'), 'no-store');
  await error.arrayBuffer();
  const exported = await request('/export.jsonl', { fresh: false });
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  await exported.arrayBuffer();
  check(
    'Anonymous API caching, ETags, 304, HEAD, format separation, and fresh/authenticated bypass',
  );

  for (const query of [
    'unique-cache-marker',
    'ERESOLVE',
    '--flag',
    'a"b',
    'longquery'.repeat(8),
    'gh unique-cache-marker',
  ]) {
    const found = await json(
      '/search?format=json&q=' + encodeURIComponent(query),
    );
    assert.ok(
      found.items.some((x) => x.id === note.id),
      query,
    );
  }
  const literal = await json(
    '/search?format=json&q=' +
      encodeURIComponent('unique-cache-marker OR not-a-search-operator'),
  );
  assert.equal(literal.items.length, 0);
  await json('/notes/' + note.id + '/withdraw', { method: 'POST', key });
  await json('/notes/' + note.id + '/withdraw', { method: 'POST', key });
  await request(notePath, { expected: 410 });
  await request('/reports/' + reports[0].id, { expected: 404 });
  assert.equal(
    (await json('/search?q=unique-cache-marker&format=json')).items.length,
    0,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) count FROM notes_fts WHERE notes_fts MATCH ?')
        .bind('"unique-cache-marker"')
        .first()
    ).count,
    0,
  );
  const withdrawal = await changes(liveChanges.next_cursor);
  assert.deepEqual(
    withdrawal.items.map((x) => x.type),
    ['withdrawal'],
  );
  assert.ok(withdrawal.items.every((x) => !('body' in x) && !('context' in x)));
  await new Promise((resolve) => setTimeout(resolve, 5200));
  await request(notePath, { fresh: false, expected: 410 });
  check(
    'Literal substring search and withdrawal remove indexed text, emit one tombstone, and expire cached bodies',
  );

  await request('/changes?since=bad-cursor', { expected: 400 });
  await request('/changes?limit=101', { expected: 400 });
  const wrongNode = Buffer.from(
    JSON.stringify({ v: 1, node: 'https://other.test', sequence: 0 }),
  ).toString('base64');
  await request('/changes?since=' + encodeURIComponent(wrongNode), {
    expected: 400,
  });
  const pageStart = await json('/changes?since=now');
  const sameTime = '2026-06-18T12:00:00Z';
  async function insertFixture(id) {
    await db
      .prepare(
        'INSERT INTO notes(id,origin,revision,actor_id,author,title,body,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        'https://fixture.test/notes/' + id,
        'r1',
        'fixture',
        'Fixture',
        id,
        'Same timestamp fixture',
        sameTime,
      )
      .run();
  }
  for (let i = 0; i < 3; i++) await insertFixture('page-fixture-' + i);
  const firstPage = await json(
    '/changes?limit=2&since=' + encodeURIComponent(pageStart.next_cursor),
  );
  assert.equal(firstPage.has_more, true);
  await insertFixture('page-fixture-3');
  const nextPage = await changes(firstPage.next_cursor);
  assert.deepEqual(
    [...firstPage.items, ...nextPage.items].map((x) => x.id),
    [0, 1, 2, 3].map((i) => 'page-fixture-' + i),
  );
  const empty = await changes(nextPage.next_cursor);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.next_cursor, nextPage.next_cursor);
  check(
    'Change cursors survive inserts during pagination and identical timestamps without gaps or duplicates',
  );

  // Exercise the limit branch atomically without generating hundreds of extra writes.
  const now = Math.floor(Date.now() / 1000),
    window = Math.floor(now / 60);
  await db
    .prepare(
      'INSERT INTO rate_limits(bucket,count,expires_at) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count',
    )
    .bind(
      'notes-minute:' + agents[99].actor_id + ':' + window,
      60,
      (window + 1) * 60,
    )
    .run();
  const limited = await request('/notes', {
    method: 'POST',
    body: { body: 'Must be rejected' },
    key: agents[99].key,
    idempotency: 'over-limit',
    expected: 429,
  });
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await limited.json()).error.code, 'rate_limited');
  check('Rate limits remain enforced with actionable Retry-After');

  console.log(
    'Loading 50,000 synthetic notes with approximately 2 KiB bodies and 15,000 outcome reports into isolated D1…',
  );
  const syntheticBody =
    'Observed dependency resolution result; retry with the matching tool version. Failed attempts and environment details remain useful. '.repeat(
      16,
    );
  const loadStart = performance.now();
  for (let start = 0; start < 50000; start += 1000) {
    await db
      .prepare(`WITH RECURSIVE seq(i) AS (SELECT CAST(? AS INTEGER) UNION ALL SELECT i+1 FROM seq WHERE i<?)
      INSERT INTO notes(id,origin,revision,actor_id,author,title,body,topic,tool,created_at)
      SELECT 'load-'||i,'https://fixture.test/notes/load-'||i,'r1','load-actor','Synthetic agent','Observation '||i,
        ?||' Unique marker loadmarker'||i,'tool-'||(i%20),'tool-'||(i%20),strftime('%Y-%m-%dT%H:%M:%fZ','2026-06-01','+'||i||' seconds') FROM seq`)
      .bind(start, start + 999, syntheticBody)
      .run();
    if ((start + 1000) % 10000 === 0)
      console.log('Indexed ' + (start + 1000) + ' notes');
  }
  for (let start = 0; start < 15000; start += 1000) {
    await db
      .prepare(`WITH RECURSIVE seq(i) AS (SELECT CAST(? AS INTEGER) UNION ALL SELECT i+1 FROM seq WHERE i<?)
      INSERT INTO reports(id,origin,note_id,revision,actor_id,author,outcome,context,evidence,created_at)
      SELECT 'load-report-'||i,'https://fixture.test/reports/load-'||i,'load-'||i,'r1','load-reporter','Synthetic reporter','worked','{}','Synthetic observation','2026-06-18T12:00:00Z' FROM seq`)
      .bind(start, start + 999)
      .run();
  }
  stats.fixture_load_ms = Math.round(performance.now() - loadStart);
  stats.synthetic_body_bytes = Buffer.byteLength(syntheticBody);
  const plan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?',
    )
    .bind('"loadmarker49999"')
    .all();
  assert.ok(plan.results.some((x) => /VIRTUAL TABLE INDEX/.test(x.detail)));
  assert.equal(
    (await json('/search?q=loadmarker49999&format=json')).items[0].id,
    'load-49999',
  );
  assert.equal(
    (await json('/search?q=notpresentanywherezzzzz&format=json')).items.length,
    0,
  );
  check(
    '50,000 imported notes and 15,000 reports update search and changes through the same triggers',
  );

  const before = (
    await db.prepare('SELECT COUNT(*) count FROM changes').first()
  ).count;
  const burstStart = await json('/changes?since=now');
  const samples = [],
    writeIds = [],
    statuses = {};
  for (let wave = 0; wave < 5; wave++) {
    await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const start = performance.now();
        let response, category;
        if (i < 20) {
          category = 'write';
          response = await request('/notes', {
            method: 'POST',
            expected: 201,
            key: agents[1 + i].key,
            idempotency: 'load-write-' + wave + '-' + i,
            body: {
              body: 'Burst observation ' + wave + '-' + i + ' ' + syntheticBody,
              topic: 'burst-test',
            },
          });
          writeIds.push((await response.json()).id);
        } else {
          const paths = [
            '/search?format=json&limit=10',
            '/search?q=loadmarker49999&format=json',
            '/search?q=notpresentanywherezzzzz&format=json',
            '/notes/load-25000.json',
            '/topics.json',
            '/changes?since=' + encodeURIComponent(burstStart.next_cursor),
          ];
          category = i % 2 ? 'fresh_read' : 'cacheable_read';
          response = await request(paths[i % paths.length], {
            fresh: category === 'fresh_read',
          });
          await response.arrayBuffer();
        }
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        samples.push({ category, ms: performance.now() - start });
      }),
    );
  }
  assert.equal(new Set(writeIds).size, 100);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) count FROM changes').first()).count -
      before,
    100,
  );
  const burstChanges = await changes(burstStart.next_cursor);
  assert.deepEqual(
    new Set(burstChanges.items.map((x) => x.id)),
    new Set(writeIds),
  );
  const percentile = (values, p) =>
    Math.round(
      values.sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
      ],
    );
  stats.load = {
    concurrency: 100,
    waves: 5,
    requests: samples.length,
    statuses,
    p50_ms: percentile(
      samples.map((x) => x.ms),
      0.5,
    ),
    p95_ms: percentile(
      samples.map((x) => x.ms),
      0.95,
    ),
    categories: {},
  };
  for (const category of ['write', 'fresh_read', 'cacheable_read']) {
    const values = samples
      .filter((x) => x.category === category)
      .map((x) => x.ms);
    stats.load.categories[category] = {
      requests: values.length,
      p50_ms: percentile([...values], 0.5),
      p95_ms: percentile([...values], 0.95),
    };
  }
  stats.counts = {
    notes: (await db.prepare('SELECT COUNT(*) count FROM notes').first()).count,
    reports: (await db.prepare('SELECT COUNT(*) count FROM reports').first())
      .count,
    changes: (await db.prepare('SELECT COUNT(*) count FROM changes').first())
      .count,
  };
  check(
    'Five waves of 100 concurrent mixed HTTP requests retain all 100 new notes and change notifications',
  );
  mkdirSync('work', { recursive: true });
  writeFileSync(
    'work/capacity-results.json',
    JSON.stringify(stats, null, 2) + '\n',
  );
  console.log(JSON.stringify(stats.load, null, 2));
  console.log(
    'Results: work/capacity-results.json. Local timings do not establish production quotas or latency.',
  );
} finally {
  await mf.dispose();
}
