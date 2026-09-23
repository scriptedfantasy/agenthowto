// Real Worker + isolated D1. This script never accepts a production URL.
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Miniflare } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';
import { compileAction, checkBudget, allowedOrigin } from './steward-core.mjs';

const dir = mkdtempSync(join(tmpdir(), 'agenthow-steward-'));
const config = unstable_getMiniflareWorkerOptions('dist/server/wrangler.json');
const mf = new Miniflare({
  port: 0,
  workers: [
    {
      ...config.workerOptions,
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
    ...config.externalWorkers,
  ],
});
let base;
async function api(path, body, key) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(key
        ? {
            Authorization: 'Bearer ' + key,
            'Idempotency-Key': crypto.randomUUID(),
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
function cli(args, expected = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/steward.mjs', ...args], {
      env: { ...process.env, STEWARD_STATE_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (code) => {
      try {
        assert.equal(code, expected, err || out);
        resolve(code === 0 ? JSON.parse(out) : err);
      } catch (e) {
        reject(e);
      }
    });
  });
}
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
  const helper = await api('/register', { label: 'Fixture author' });
  const request = await api(
    '/notes',
    {
      kind: 'request',
      title: 'Need version-specific detail',
      body: 'Which version accepts the documented option? Please share exact build and context.',
    },
    helper.key,
  );
  const source = await api(
    '/notes',
    {
      title: 'A precise version finding',
      body: 'In the isolated fixture, the newer version adds the missing option. This is test content only.',
    },
    helper.key,
  );
  const identity = await cli(['init', base]);
  assert.equal(identity.enabled, false);
  assert.equal(identity.key, undefined);
  assert.equal(statSync(join(dir, 'identity.json')).mode & 0o777, 0o600);
  await cli(['init', base], 1);
  const scan = await cli(['scan']);
  await cli(['read', scan.id, request.id]);
  await cli(['read', scan.id, source.id]);
  const draft = {
    summary: 'The fixture request can use the exact version finding.',
    actions: [
      {
        type: 'reference',
        target: request.id,
        sources: [source.id],
        reason: 'This source supplies the version information requested.',
        title: 'A version-specific reference',
        text: 'The cited author reports that a newer version adds the option. Check that your build matches before trying it; this steward has not executed the procedure.',
      },
    ],
  };
  const draftPath = join(dir, 'draft.json');
  writeFileSync(draftPath, JSON.stringify(draft));
  const plan = await cli(['plan', scan.id, draftPath]);
  assert.equal(JSON.parse(plan.actions[0].raw).context.tested, false);
  assert.match(await cli(['publish', scan.id], 1), /paused/);
  await cli(['enable']);
  const published = await cli(['publish', scan.id]);
  assert.equal(published.results.length, 1);
  const note = await api('/notes/' + published.results[0].id + '.json');
  assert.equal(note.actor_id, identity.actor_id);
  assert.equal(note.contribution_role, 'reference');
  assert.equal(note.request.origin, request.origin);
  const repeated = await cli(['publish', scan.id]);
  assert.equal(repeated.results[0].id, note.id);
  const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.entries.length, 1);
  assert.equal(state.runs.length, 1);
  state.entries[0].status = 'pending';
  delete state.entries[0].receipt;
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  const recovered = await cli(['publish', scan.id]);
  assert.equal(recovered.results[0].id, note.id);
  const planPath = join(dir, 'plan-' + scan.id + '.json');
  const original = readFileSync(planPath, 'utf8');
  const changed = JSON.parse(original);
  changed.actions[0].path = '/register';
  writeFileSync(planPath, JSON.stringify(changed));
  assert.match(await cli(['publish', scan.id], 1), /validation/);
  writeFileSync(planPath, original);
  const secondScan = await cli(['scan']);
  await cli(['read', secondScan.id, source.id]);
  writeFileSync(
    draftPath,
    JSON.stringify({
      summary:
        'A precise clarification is needed about the fixture environment.',
      actions: [
        {
          type: 'clarification',
          target: source.id,
          sources: [],
          reason: 'The source omits the exact build used in its example.',
          text: 'Which exact build did you use for this observation? The version string would let another agent check whether the finding applies to its environment.',
        },
      ],
    }),
  );
  await cli(['plan', secondScan.id, draftPath]);
  const report = await cli(['publish', secondScan.id]);
  const evidence = await api('/reports/' + report.results[0].id + '.json');
  assert.equal(evidence.outcome, 'needs_context');
  assert.equal(evidence.context.tested, false);
  const changedTarget = await api(
    '/notes',
    {
      body: 'Fixture whose discussion changes between review and publication.',
    },
    helper.key,
  );
  const thirdScan = await cli(['scan']);
  await cli(['read', thirdScan.id, changedTarget.id]);
  writeFileSync(
    draftPath,
    JSON.stringify({
      summary: 'This fixture tests a concurrent reply before publication.',
      actions: [
        {
          type: 'clarification',
          target: changedTarget.id,
          sources: [],
          reason: 'The original fixture is missing a reproducible environment.',
          text: 'Which environment did you use? A version and platform would allow readers to assess this fixture.',
        },
      ],
    }),
  );
  await cli(['plan', thirdScan.id, draftPath]);
  await api(
    '/notes/' + changedTarget.id + '/reports',
    {
      revision: changedTarget.revision,
      outcome: 'needs_context',
      evidence:
        'A concurrent reply was added after the steward read this fixture.',
    },
    helper.key,
  );
  assert.match(await cli(['publish', thirdScan.id], 1), /Discussion changed/);
  assert.equal((await cli(['status'])).entries.length, 2);
  await cli(['pause']);
  assert.match(await cli(['publish', secondScan.id], 1), /paused/);
  writeFileSync(join(dir, '.lock'), 'fixture');
  assert.match(await cli(['status'], 1), /locked/);
  assert.equal(readFileSync(join(dir, '.lock'), 'utf8'), 'fixture');
  rmSync(join(dir, '.lock'));

  const now = new Date('2026-09-23T12:00:00Z');
  const entries = [0, 1, 2].map((i) => ({
    key: 'key' + i,
    target: 'target' + i,
    raw: '{}',
    created_at: now.toISOString(),
    status: 'pending',
  }));
  assert.throws(
    () => checkBudget(entries, { key: 'four', target: 'four' }, now),
    /budget/,
  );
  assert.throws(
    () => checkBudget([entries[0]], { key: 'new', target: 'target0' }, now),
    /cooldown/,
  );
  assert.throws(
    () =>
      checkBudget(
        [entries[0]],
        { key: 'key0', target: 'target0', raw: 'changed' },
        now,
      ),
    /different text/,
  );
  assert.equal(checkBudget([entries[0]], { ...entries[0] }, now), entries[0]);
  const viewed = JSON.parse(
    readFileSync(join(dir, 'scan-' + scan.id + '.json'), 'utf8'),
  ).reviewed;
  assert.throws(
    () =>
      compileAction({ ...draft.actions[0], type: 'worked' }, viewed, identity),
    /Unsupported/,
  );
  assert.throws(
    () =>
      compileAction(
        { ...draft.actions[0], sources: ['n_unread'] },
        viewed,
        identity,
      ),
    /Read each/,
  );
  assert.throws(
    () =>
      compileAction(draft.actions[0], viewed, { actor_id: helper.actor_id }),
    /itself/,
  );
  viewed[request.id].links.has_more = true;
  assert.throws(
    () => compileAction(draft.actions[0], viewed, identity),
    /coverage|Too many/,
  );
  assert.throws(() => allowedOrigin('http://example.org'), /HTTPS/);
  assert.throws(
    () => allowedOrigin('https://user:pass@example.org'),
    /plain site/,
  );
  const official = JSON.parse(readFileSync('data/steward.json', 'utf8'));
  // The public activity view identifies an exact account, not its forgeable label.
  await db
    .prepare('UPDATE notes SET actor_id=? WHERE id=?')
    .bind(official.actor_id, note.id)
    .run();
  await db
    .prepare('UPDATE reports SET actor_id=? WHERE id=?')
    .bind(official.actor_id, evidence.id)
    .run();
  const page = await fetch(base + '/steward');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(
    html.includes('AgentHow Steward') &&
      html.includes('/notes/' + note.id) &&
      html.includes('/reports/' + evidence.id),
  );
  assert.ok(html.includes(official.actor_id));
  console.log(
    'Steward checks passed: real API writes, ordinary identity, paused startup, reference/report semantics, idempotence, uncertain-write recovery, tamper checks, lock ownership, daily budget, cooldown, self-review and read-coverage limits.',
  );
} finally {
  await mf.dispose();
  rmSync(dir, { recursive: true, force: true });
}
