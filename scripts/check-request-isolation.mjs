import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Model an originating request whose I/O remains pending until it is canceled.
// A second request must finish independently, before the first one settles.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Another request blocked this request')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const dir = await mkdtemp(join(tmpdir(), 'agenthow-request-isolation-'));
try {
  for (const name of ['initialization', 'read-cache']) {
    await build({ entryPoints: ['lib/' + name + '.ts'], outfile: join(dir, name + '.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  }
  const { completedInitialization } = await import(pathToFileURL(join(dir, 'initialization.mjs')));
  const { cachedRead } = await import(pathToFileURL(join(dir, 'read-cache.mjs')));

  const held = deferred();
  let attempts = 0;
  const initialize = completedInitialization(async () => {
    if (++attempts === 1) await held.promise;
  });
  const abandoned = initialize();
  const abandonedResult = assert.rejects(abandoned, /request canceled/);
  try {
    await within(initialize());
    assert.equal(attempts, 2);
  } finally {
    held.reject(Error('request canceled'));
    await abandonedResult;
  }
  await initialize();
  assert.equal(attempts, 2, 'Late cancellation must not invalidate completed initialization');

  const pendingRead = deferred();
  const entered = deferred();
  const request = () => new Request('https://test.invalid/search?q=request-isolation&format=json');
  const response = () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '11' },
  });
  const abandonedRead = cachedRead(request(), 'search', 'json', async () => {
    entered.resolve();
    await pendingRead.promise;
    return response();
  });
  const abandonedReadResult = assert.rejects(abandonedRead, /request canceled/);
  await entered.promise;
  try {
    const independent = await within(cachedRead(request(), 'search', 'json', async () => response()));
    assert.equal(independent.status, 200);
    assert.equal(await independent.text(), '{"ok":true}');
    assert.equal(independent.headers.get('X-AgentHow-Cache'), 'MISS');
  } finally {
    pendingRead.reject(Error('request canceled'));
    await abandonedReadResult;
  }
  const hit = await cachedRead(request(), 'search', 'json', async () => { throw Error('Completed cache entry was lost'); });
  assert.equal(hit.headers.get('X-AgentHow-Cache'), 'HIT');
  const conditional = new Request(request(), { headers: { 'If-None-Match': hit.headers.get('ETag') } });
  assert.equal((await cachedRead(conditional, 'search', 'json', async () => response())).status, 304);
  console.log('PASS: interrupted initialization and cache fills do not block other requests; completed initialization, cached bodies and ETags remain reusable.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
