// Exercises the built Worker against an isolated local database. Never accepts a site URL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
let base;
const local = (url) => {
  const parsed = new URL(url, base);
  return base + parsed.pathname + parsed.search;
};
async function request(
  path,
  expected = 200,
  headers = { 'Cache-Control': 'no-cache' },
) {
  const response = await fetch(local(path), { headers });
  assert.equal(
    response.status,
    expected,
    path + ': unexpected response status',
  );
  return response;
}
const json = async (path, expected = 200, headers) =>
  (await request(path, expected, headers)).json();
try {
  base = (await mf.ready).origin;
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle')
    .filter((p) => p.endsWith('.sql'))
    .sort()) {
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql).run();
  }
  await json('/agenthow.json');
  const quickstart = await (await request('/quickstart.md')).text();
  assert.ok(
    quickstart.includes('view=compact') &&
      quickstart.includes('Idempotency-Key:'),
  );
  const html = await (await request('/')).text();
  assert.ok(
    html.includes('Start here') &&
      html.indexOf('Start here') < html.indexOf('id="knowledge"'),
  );
  assert.ok(!/D1_ERROR|SQLITE_ERROR|SERVER ERROR/.test(html));
  assert.ok(
    html.includes('<ol start="4">'),
    'Quickstart numbering continues after request examples',
  );

  const body =
    '🙂🌱 '.repeat(800) +
    'latefailure --flag literal "quoted" observation ' +
    'Observed result. '.repeat(600);
  for (let i = 0; i < 3; i++)
    await db
      .prepare(`INSERT INTO notes
    (id,origin,revision,actor_id,author,title,body,topic,kind,tool,version,context,sources,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        'compact-' + i,
        'https://fixture.test/notes/compact-' + i,
        'r1',
        'fixture',
        'Agent fixture',
        'metadataonly marker ' + i,
        body,
        'bounded-test',
        i === 2 ? 'request' : 'note',
        'fixture-tool',
        '1.0',
        '{"os":"linux"}',
        '[]',
        '2026-09-01T00:00:00.000Z',
      )
      .run();
  await db
    .prepare(`WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i<204)
    INSERT INTO reports(id,origin,note_id,revision,actor_id,author,outcome,context,evidence,created_at)
    SELECT printf('report-%03d',i),'https://fixture.test/reports/'||i,'compact-0','r1','actor-'||i,
      'Fixture reporter','worked','{}','evidence-'||i,'2026-09-02T00:00:00.000Z' FROM seq`)
    .run();

  // Batched homepage previews must stay per-record and preserve server-rendered
  // content for readers that never run JavaScript.
  const home = (
    await (await request('/?topic=bounded-test&month=2026-09')).text()
  ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const article = (id) =>
    home.match(
      new RegExp('<article id="note-' + id + '"[\\s\\S]*?</article>'),
    )?.[0];
  assert.ok(article('compact-0')?.includes('evidence-204'));
  assert.ok(article('compact-0')?.includes('evidence-203'));
  assert.ok(article('compact-0')?.includes('evidence-202'));
  assert.ok(!article('compact-0')?.includes('evidence-201'));
  assert.ok(!article('compact-1')?.includes('evidence-204'));
  assert.ok(article('compact-2')?.includes('Help wanted'));
  for (const id of [
    'instructions',
    'replicate',
    'rules',
    'collaborations',
    'activity',
  ])
    assert.ok(
      home.includes('id="' + id + '"'),
      'Server-rendered section ' + id,
    );
  const stats = await json('/stats.json?month=2026-09');
  assert.equal(stats.totals.posts, 3);
  assert.equal(stats.totals.entities, 1);
  assert.equal(
    stats.observations.other_origin_entities +
      stats.observations.origins.reduce(
        (sum, group) => sum + group.entities,
        0,
      ),
    1,
  );
  assert.ok(!/D1_ERROR|SQLITE_ERROR|SERVER ERROR/.test(home));

  const fullResponse = await request('/search.json?topic=bounded-test');
  const fullText = await fullResponse.text();
  assert.equal(JSON.parse(fullText).items[0].body, body);
  const compactResponse = await request(
    '/search.json?topic=bounded-test&view=compact',
  );
  const compactText = await compactResponse.text();
  const compact = JSON.parse(compactText);
  assert.equal(compact.items.length, 3);
  for (const item of compact.items) {
    assert.ok(
      !('body' in item) && !('context' in item) && !('sources' in item),
    );
    assert.ok(item.excerpt_truncated && Array.from(item.excerpt).length <= 600);
    assert.equal(item.body_characters, Array.from(body).length);
    assert.equal(
      item.excerpt,
      Array.from(body)
        .slice(item.excerpt_start, item.excerpt_start + 600)
        .join(''),
    );
    assert.equal((await json(item.fetch_url)).body, body);
  }
  assert.ok(compactText.length < fullText.length / 4);
  for (const q of [
    'latefailure',
    'metadataonly latefailure',
    '--flag',
    '"quoted"',
    'metadataonly',
    '',
  ]) {
    const result = await json(
      '/search.json?view=compact&topic=bounded-test&q=' + encodeURIComponent(q),
    );
    assert.equal(result.items.length, 3, 'Query ' + q);
    if (q.includes('latefailure')) {
      assert.ok(result.items[0].excerpt.includes('latefailure'));
      assert.ok(result.items[0].excerpt_start > 0);
    }
  }
  assert.equal(
    (await json('/search.json?view=compact&q=doesnotexist')).items.length,
    0,
  );
  const md = await (
    await request('/search.md?view=compact&q=latefailure&limit=1')
  ).text();
  assert.ok(
    md.includes('excerpt_truncated: true') &&
      md.includes('origin:') &&
      md.includes('fetch_url:'),
  );
  assert.ok(md.includes('.md?reports_limit=0'));
  for (const endpoint of [
    '/search.json',
    '/notes.json',
    '/index.json',
    '/requests.json',
  ]) {
    const response = await request(
      endpoint + '?view=compact&limit=1&topic=bounded-test',
    );
    const page = await response.json();
    if (page.next_url) {
      assert.equal(
        response.headers.get('link'),
        '<' + page.next_url + '>; rel="next"',
      );
      const next = await json(page.next_url);
      assert.equal(next.view, 'compact');
      assert.notEqual(next.items[0].id, page.items[0].id);
    } else assert.equal(endpoint, '/requests.json');
  }

  const omitted = await json('/notes/compact-0.json?reports_limit=0');
  assert.equal(omitted.body, body);
  assert.equal(omitted.reports.length, 0);
  assert.equal(omitted.reports_page.has_more, true);
  assert.equal((await json(omitted.reports_page.next_url)).items.length, 20);
  assert.equal(
    (await json('/notes/compact-1.json?reports_limit=0')).reports_page.has_more,
    false,
  );
  const omittedMd = await (
    await request('/notes/compact-0.md?reports_limit=0')
  ).text();
  assert.ok(
    omittedMd.includes('Outcome reports omitted') &&
      !omittedMd.includes('No outcome reports.'),
  );
  assert.ok(omittedMd.includes('format=md'));
  const legacy = await json('/notes/compact-0.json');
  assert.equal(legacy.reports.length, 200);
  assert.equal((await json(legacy.reports_page.next_url)).items.length, 5);
  assert.equal((await json('/notes/compact-0/reports')).items.length, 200);
  const initialResponse = await request(
    '/notes/compact-0.json?reports_limit=3',
  );
  const initial = await initialResponse.json();
  assert.equal(initial.reports.length, 3);
  assert.equal(
    initialResponse.headers.get('link'),
    '<' + initial.reports_page.next_url + '>; rel="next"',
  );
  const all = initial.reports.map((r) => r.id);
  // A newly inserted head record must not displace records on subsequent pages.
  await db
    .prepare(`INSERT INTO reports(id,origin,note_id,revision,actor_id,author,outcome,context,evidence,created_at)
    VALUES ('newest','https://fixture.test/newest','compact-0','r1','newest','New reporter','failed','{}','New evidence','2026-09-03T00:00:00.000Z')`)
    .run();
  let next = initial.reports_page.next_url;
  while (next) {
    const page = await json(next);
    all.push(...page.items.map((r) => r.id));
    next = page.next_url;
  }
  assert.equal(all.length, 205);
  assert.equal(new Set(all).size, 205);
  assert.ok(!all.includes('newest'));
  assert.equal(
    (await json('/notes/compact-0/reports?limit=1')).items[0].id,
    'newest',
  );
  const reportsMd = await (
    await request('/notes/compact-0/reports.md?limit=1')
  ).text();
  assert.ok(
    reportsMd.includes('New evidence') &&
      reportsMd.includes('next_url:') &&
      reportsMd.includes('format=md'),
  );
  const markdownNext = reportsMd
    .split('\n')
    .find((line) => line.startsWith('next_url: '))
    .slice('next_url: '.length);
  assert.match(
    (await request(markdownNext)).headers.get('content-type'),
    /text\/markdown/,
  );

  const badCursor = encodeURIComponent(initial.reports_page.next_cursor);
  await json('/notes/compact-1/reports?cursor=' + badCursor, 400);
  const decoded = JSON.parse(
    Buffer.from(initial.reports_page.next_cursor, 'base64').toString('utf8'),
  );
  const foreign = Buffer.from(
    JSON.stringify({ ...decoded, node: 'https://other.test' }),
  ).toString('base64');
  await json(
    '/notes/compact-0/reports?cursor=' + encodeURIComponent(foreign),
    400,
  );
  for (const path of [
    '/search.json?view=unknown',
    '/notes/compact-0.json?reports_limit=-1',
    '/notes/compact-0.json?reports_limit=201',
    '/notes/compact-0.json?reports_limit=1.5',
    '/notes/compact-0.json?reports_limit=',
    '/notes/compact-0/reports?limit=0',
    '/notes/compact-0/reports?cursor=broken',
  ])
    await json(path, 400);
  const cached = await request(
    '/search.json?view=compact&topic=bounded-test',
    200,
    {},
  );
  const etag = cached.headers.get('etag');
  assert.ok(etag);
  await request('/search.json?view=compact&topic=bounded-test', 304, {
    'If-None-Match': etag,
  });
  assert.ok(
    'body' in (await json('/search.json?topic=bounded-test', 200, {})).items[0],
  );
  assert.equal(
    (await json('/notes/compact-0.json?reports_limit=0', 200, {})).reports
      .length,
    0,
  );
  assert.equal(
    (await json('/notes/compact-0.json?reports_limit=1', 200, {})).reports
      .length,
    1,
  );
  await db
    .prepare("UPDATE notes SET state='withdrawn' WHERE id='compact-0'")
    .run();
  await json('/notes/compact-0.json?reports_limit=0', 410);
  await json('/notes/compact-0/reports?limit=1', 404);
  assert.equal(
    (await json('/search.json?view=compact&topic=bounded-test')).items.length,
    2,
  );
  console.log(
    `PASS: compact retrieval, Unicode excerpts, matching context, concrete continuation links, Markdown, 205-report pagination with concurrent insertion, scoped cursors, omitted vs empty reports, limits, cache separation and withdrawals. Fixture search response reduced ${Math.round((1 - Buffer.byteLength(compactText) / Buffer.byteLength(fullText)) * 100)}%.`,
  );
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/check-node.mjs', base], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error('Existing API conformance checks failed')),
    );
  });
} finally {
  await mf.dispose();
}
