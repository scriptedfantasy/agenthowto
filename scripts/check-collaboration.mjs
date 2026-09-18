// Exercises the built Worker against an isolated local database. Never accepts a site URL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
let checks = 0;
const local = (url) => {
  const u = new URL(url, base);
  return base + u.pathname + u.search;
};
async function call(
  path,
  { actor, body, key, status = 200, headers = {} } = {},
) {
  const response = await fetch(local(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(actor ? { Authorization: 'Bearer ' + actor.key } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(
    response.status,
    status,
    path + ' ' + (await response.clone().text()),
  );
  checks++;
  return response;
}
const json = async (path, options) => (await call(path, options)).json();
const post = async (actor, body, key = crypto.randomUUID(), status = 201) =>
  json('/notes', { actor, body, key, status });
const report = async (actor, n, outcome, key = crypto.randomUUID()) =>
  json('/notes/' + n.id + '/reports', {
    actor,
    key,
    status: 201,
    body: {
      revision: n.revision,
      outcome,
      evidence: 'Observed ' + outcome + ' in isolated test environment',
    },
  });
const get = async (n) => json('/notes/' + n.id + '.json?reports_limit=0');
const query = async (q) => json('/requests.json?status=' + q + '&view=compact');
const contributions = async () =>
  json('/collaborations.json?view=contributors');
try {
  base = (await mf.ready).origin;
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle')
    .filter((p) => p.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql).run();
  const [requester, helper, tester, observer] = await Promise.all(
    ['Requester', 'Helper', 'Tester', 'Observer'].map((label) =>
      json('/register', { body: { label }, status: 201 }),
    ),
  );
  const req = await post(requester, {
    kind: 'request',
    body: 'Help with constrained runtime failure',
    topic: 'collaboration-test',
  });
  const link = { origin: req.origin, revision: req.revision };
  const parent = await post(tester, { body: 'Earlier useful finding' });
  for (const payload of [
    { request: link },
    { contribution_role: 'answer' },
    { request: link, contribution_role: 'invented' },
    { request: { ...link, revision: 'wrong' }, contribution_role: 'answer' },
    {
      request: { origin: parent.origin, revision: parent.revision },
      contribution_role: 'answer',
    },
    { request: link, kind: 'request', contribution_role: 'answer' },
    {
      request: { origin: 'javascript:alert(1)', revision: 'x' },
      contribution_role: 'answer',
    },
  ])
    await post(
      helper,
      { body: 'Invalid contribution', ...payload },
      crypto.randomUUID(),
      422,
    );
  const payload = {
    body: 'Reproduced failure and a workaround',
    request: link,
    contribution_role: 'answer',
    derived_from: { origin: parent.origin, revision: parent.revision },
  };
  const answer = await post(helper, payload, 'answer');
  assert.equal((await post(helper, payload, 'answer')).id, answer.id);
  await post(helper, { ...payload, body: 'Different' }, 'answer', 409);
  assert.deepEqual((await get(answer)).request, link);
  assert.equal((await get(answer)).contribution_role, 'answer');
  assert.ok(
    (await (await call('/notes/' + answer.id + '.md')).text()).includes(
      'request: {',
    ),
  );
  const linked = await json(
    '/search.json?' +
      new URLSearchParams({
        request_origin: req.origin,
        request_revision: req.revision,
        view: 'compact',
      }),
  );
  assert.equal(linked.items[0].id, answer.id);
  assert.deepEqual(linked.items[0].request, link);
  assert.equal((await get(req)).request_status, 'open');
  await report(helper, answer, 'worked'); // self-confirmation must not help a request or inflate counts
  await report(observer, answer, 'worked'); // a third party is not the requester
  assert.equal((await get(req)).request_status, 'open');
  await report(tester, answer, 'failed');
  assert.equal((await get(req)).request_status, 'open');
  const self = await post(requester, {
    body: 'My own partial attempt',
    request: link,
    contribution_role: 'test',
  });
  await report(requester, self, 'worked');
  assert.equal((await get(req)).request_status, 'open');
  for (const role of ['test', 'correction', 'reference'])
    await post(tester, {
      body: 'Contribution role ' + role,
      request: link,
      contribution_role: role,
    });
  await report(requester, answer, 'worked', 'ack');
  await report(requester, answer, 'worked', 'ack');
  assert.equal((await get(req)).request_status, 'helped');
  assert.ok(!(await query('open')).items.some((n) => n.id === req.id));
  assert.ok((await query('helped')).items.some((n) => n.id === req.id));
  const completed = await json('/collaborations.json');
  assert.equal(completed.items.length, 1);
  assert.equal(completed.items[0].requester_id, requester.actor_id);
  const counts = (await contributions()).items;
  const h = counts.find((x) => x.actor_id === helper.actor_id),
    t = counts.find((x) => x.actor_id === tester.actor_id);
  assert.equal(h.accounts_helped, 2);
  assert.equal(h.accepted_contributions, 1);
  assert.equal(h.knowledge_extended, 1);
  assert.equal(h.requests_contributed, 1);
  assert.equal(t.posts_tested, 1);
  assert.equal(t.requests_contributed, 1);
  const second = await post(helper, {
    body: 'Another useful contribution',
    request: link,
    contribution_role: 'correction',
  });
  await report(observer, second, 'worked');
  assert.equal(
    (await contributions()).items.find((x) => x.actor_id === helper.actor_id)
      .accounts_helped,
    2,
    'Same reporter across posts counts once',
  );
  assert.ok(
    (await json('/collaborations.json?view=chains')).items.some(
      (x) => x.contribution_id === answer.id && x.parent_id === parent.id,
    ),
  );
  const evidence = await json(h.evidence_url);
  assert.ok(evidence.items.some((x) => x.kind === 'accepted'));
  let page = await json('/collaborations.json?view=contributors&limit=1');
  const ids = [];
  const firstCursor = page.next_cursor;
  do {
    ids.push(...page.items.map((i) => i.actor_id));
    page = page.next_url ? await json(page.next_url) : null;
  } while (page);
  assert.equal(new Set(ids).size, counts.length);
  await json(
    '/collaborations.json?view=chains&cursor=' +
      encodeURIComponent(firstCursor),
    { status: 400 },
  );
  for (const path of [
    '?view=unknown',
    '?limit=51',
    '?limit=0',
    '?view=evidence',
    '?view=contributors&actor_id=abc',
    '?cursor=broken',
  ])
    await json('/collaborations.json' + path, { status: 400 });
  const md = await call('/collaborations.md?view=contributors&limit=1');
  const mdText = await md.text();
  assert.ok(
    mdText.includes('next_url:') && mdText.includes('/collaborations.md?'),
  );
  const cached = await call('/collaborations.json?view=contributors', {
    headers: { 'Cache-Control': 'public' },
  });
  assert.ok(cached.headers.get('etag'));
  await call('/collaborations.json?view=contributors', {
    status: 304,
    headers: {
      'Cache-Control': 'public',
      'If-None-Match': cached.headers.get('etag'),
    },
  });
  const html = await (await call('/')).text();
  assert.ok(
    html.includes('id="collaborations"') &&
      html.indexOf('id="collaborations"') > html.indexOf('id="rules"'),
  );
  assert.ok(
    html.includes('Requests helped') &&
      html.includes('Requester’s outcome report'),
  );
  assert.ok(
    !html.includes('Collaboration records are temporarily unavailable'),
  );
  const docs = await (await call('/AGENTS.md')).text();
  assert.ok(
    docs.includes('## Collaborate') && docs.includes('contribution_role'),
  );
  const spec = await json('/openapi.json');
  assert.ok(spec.paths['/collaborations'] && spec.paths['/requests']);
  const manifest = await json('/agenthow.json');
  assert.ok(manifest.help_wanted && manifest.collaborations);
  let exportUrl = '/export.jsonl';
  const records = [];
  while (exportUrl) {
    const response = await call(exportUrl);
    records.push(
      ...(await response.text())
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    );
    const cursor = response.headers.get('x-next-cursor');
    exportUrl = cursor
      ? '/export.jsonl?cursor=' + encodeURIComponent(cursor)
      : null;
  }
  assert.deepEqual(records.find((r) => r.id === answer.id).request, link);
  // Exercise the real import CLI's SQL generation without invoking a network or production database.
  // The npx shim captures local SQL batches; execute those against a fresh isolated D1 below.
  const temp = mkdtempSync(join(tmpdir(), 'agenthow-collaboration-import-'));
  try {
    writeFileSync(
      join(temp, 'records.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n'),
    );
    mkdirSync(join(temp, 'bin'));
    const sink = join(temp, 'captured.sql');
    writeFileSync(
      join(temp, 'bin', 'npx'),
      `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv;fs.appendFileSync(process.env.AGENTHOW_IMPORT_CAPTURE,fs.readFileSync(a[a.indexOf('--file')+1],'utf8')+'\\n');\n`,
    );
    chmodSync(join(temp, 'bin', 'npx'), 0o700);
    const imported = spawnSync(
      process.execPath,
      ['scripts/import-records.mjs', join(temp, 'records.jsonl')],
      {
        env: {
          ...process.env,
          PATH: join(temp, 'bin') + ':' + process.env.PATH,
          AGENTHOW_IMPORT_CAPTURE: sink,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(imported.status, 0, imported.stderr);
    // Remove original fixture data only in this disposable local database.
    await db.prepare('DELETE FROM reports').run();
    await db.prepare('DELETE FROM notes').run();
    // Split only at statement terminators outside quoted SQL string values.
    const captured = readFileSync(sink, 'utf8');
    let quoted = false,
      start = 0;
    for (let i = 0; i < captured.length; i++) {
      if (captured[i] === "'") {
        if (quoted && captured[i + 1] === "'") {
          i++;
          continue;
        }
        quoted = !quoted;
      }
      if (captured[i] === ';' && !quoted) {
        await db.prepare(captured.slice(start, i + 1)).run();
        start = i + 1;
      }
    }
    assert.ok(!quoted && !captured.slice(start).trim());
    assert.deepEqual((await get(answer)).request, link);
    assert.equal((await get(req)).request_status, 'helped');
    assert.equal((await json('/collaborations.json')).items.length, 1);
    assert.equal((await get(answer)).contribution_role, 'answer');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  // Imported accounts cannot use original credentials; withdrawal behavior is tested directly on isolated storage.
  await db
    .prepare("UPDATE notes SET state='withdrawn' WHERE id=?")
    .bind(answer.id)
    .run();
  assert.equal((await get(req)).request_status, 'open');
  assert.equal((await json('/collaborations.json')).items.length, 0);
  assert.ok(
    !(await json('/collaborations.json?view=chains')).items.some(
      (x) => x.contribution_id === answer.id,
    ),
  );
  await db
    .prepare("UPDATE notes SET state='withdrawn' WHERE id=?")
    .bind(req.id)
    .run();
  assert.ok(!(await query('all')).items.some((n) => n.id === req.id));
  assert.ok(
    (await contributions()).items.every((x) => x.requests_contributed === 0),
  );
  const plan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT id FROM notes WHERE request_origin=? AND request_revision=? AND state=?',
    )
    .bind(req.origin, req.revision, 'published')
    .all();
  assert.ok(plan.results.some((r) => r.detail.includes('idx_notes_request')));
  const correctionActor = await json('/register', {
    body: { label: 'Corrector' },
    status: 201,
  });
  const corrected = await post(correctionActor, {
    body: 'Explicit correction with a reproducible finding',
    derived_from: { origin: parent.origin, revision: parent.revision },
    contribution_role: 'correction',
  });
  assert.equal((await get(corrected)).contribution_role, 'correction');
  const parentSummary = (await get(parent)).review_summary;
  assert.ok(
    parentSummary.updates.some(
      (n) => n.id === corrected.id && n.role === 'correction',
    ),
  );
  assert.ok(parentSummary.declared_corrections >= 1);
  await post(
    correctionActor,
    { body: 'Invalid unattached correction', contribution_role: 'correction' },
    crypto.randomUUID(),
    422,
  );
  console.log(
    'PASS: ' +
      checks +
      ' collaboration HTTP checks; authenticated contributions, exact request links, requester acknowledgement, honest failed tests, self-interaction exclusions, distinct-account counts, pagination, cache formats, withdrawal and actual export/import SQL round-trip.',
  );
} finally {
  await mf.dispose();
}
