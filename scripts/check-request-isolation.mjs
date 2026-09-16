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
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Another request blocked this request')),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const dir = await mkdtemp(join(tmpdir(), 'agenthow-request-isolation-'));
try {
  for (const name of [
    'initialization',
    'read-cache',
    'home-cache',
    'snapshot-cache',
    'monitoring-cache',
  ]) {
    await build({
      entryPoints: ['lib/' + name + '.ts'],
      outfile: join(dir, name + '.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
  }
  const { completedInitialization } = await import(
    pathToFileURL(join(dir, 'initialization.mjs'))
  );
  const { cachedRead } = await import(
    pathToFileURL(join(dir, 'read-cache.mjs'))
  );

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
  assert.equal(
    attempts,
    2,
    'Late cancellation must not invalidate completed initialization',
  );

  const pendingRead = deferred();
  const entered = deferred();
  const request = () =>
    new Request('https://test.invalid/search?q=request-isolation&format=json');
  const response = () =>
    new Response('{"ok":true}', {
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
    const independent = await within(
      cachedRead(request(), 'search', 'json', async () => response()),
    );
    assert.equal(independent.status, 200);
    assert.equal(await independent.text(), '{"ok":true}');
    assert.equal(independent.headers.get('X-AgentHow-Cache'), 'MISS');
  } finally {
    pendingRead.reject(Error('request canceled'));
    await abandonedReadResult;
  }
  const hit = await cachedRead(request(), 'search', 'json', async () => {
    throw Error('Completed cache entry was lost');
  });
  assert.equal(hit.headers.get('X-AgentHow-Cache'), 'HIT');
  const conditional = new Request(request(), {
    headers: { 'If-None-Match': hit.headers.get('ETag') },
  });
  assert.equal(
    (await cachedRead(conditional, 'search', 'json', async () => response()))
      .status,
    304,
  );

  const { cachedHome } = await import(
    pathToFileURL(join(dir, 'home-cache.mjs'))
  );
  const { snapshotCache } = await import(
    pathToFileURL(join(dir, 'snapshot-cache.mjs'))
  );
  const { monitoringSnapshot } = await import(
    pathToFileURL(join(dir, 'monitoring-cache.mjs'))
  );
  const background = [];
  const waitUntil = (promise) => background.push(promise);
  const htmlResponse = (text = 'public') =>
    new Response('<html><body>' + text + '</body></html>', {
      headers: {
        'Content-Type': 'text/html',
        Vary: 'RSC, Next-Router-State-Tree, Accept-Encoding',
      },
    });
  const homeRequest = (options) => new Request('https://home.test/', options);
  const blocked = deferred();
  const firstHome = cachedHome(
    homeRequest(),
    async () => {
      await blocked.promise;
      return htmlResponse();
    },
    waitUntil,
  );
  const firstResult = assert.rejects(firstHome, /canceled/);
  const otherHome = await within(
    cachedHome(homeRequest(), async () => htmlResponse(), waitUntil),
  );
  assert.equal(otherHome.headers.get('x-agenthow-page-cache'), 'MISS');
  blocked.reject(Error('canceled'));
  await firstResult;
  await Promise.all(background.splice(0));
  const noRender = async () => {
    throw Error('A complete snapshot should bypass rendering');
  };
  const homeHit = await cachedHome(homeRequest(), noRender, waitUntil);
  assert.equal(homeHit.headers.get('x-agenthow-page-cache'), 'HIT');
  assert.equal(await homeHit.text(), '<html><body>public</body></html>');
  const head = await cachedHome(
    homeRequest({ method: 'HEAD' }),
    noRender,
    waitUntil,
  );
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('x-agenthow-page-cache'), 'HIT');
  const variants = [
    { headers: { Cookie: 'session=private' } },
    { headers: { Authorization: 'Bearer private' } },
    { headers: { 'Cache-Control': 'no-cache' } },
    { headers: { 'Cache-Control': 'no-store' } },
    { headers: { 'Cache-Control': 'max-age=0' } },
    { headers: { Pragma: 'no-cache' } },
    { headers: { RSC: '1' } },
    { headers: { 'X-Vinext-Rsc-Render-Mode': 'navigation' } },
    { headers: { 'Next-Router-Prefetch': '1' } },
    { headers: { Accept: 'text/markdown' } },
    { headers: { Accept: 'application/json' } },
    { headers: { Range: 'bytes=0-100' } },
    { method: 'POST' },
  ];
  for (const options of variants) {
    const result = await cachedHome(
      homeRequest(options),
      async () => new Response('uncached variant'),
      waitUntil,
    );
    assert.equal(await result.text(), 'uncached variant');
    assert.equal(result.headers.get('x-agenthow-page-cache'), null);
  }
  for (const url of [
    'https://home.test/?q=private',
    'https://home.test/notes/one',
  ])
    assert.equal(
      await (
        await cachedHome(
          new Request(url),
          async () => new Response('variant'),
          waitUntil,
        )
      ).text(),
      'variant',
    );
  assert.equal(
    (
      await cachedHome(
        new Request('https://other-home.test/'),
        async () => htmlResponse('other'),
        waitUntil,
      )
    ).headers.get('x-agenthow-page-cache'),
    'MISS',
  );
  for (const [label, make] of [
    [
      'cookie',
      () =>
        new Response('<html>secret</html>', {
          headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'secret=yes' },
        }),
    ],
    [
      'private',
      () =>
        new Response('<html>secret</html>', {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private' },
        }),
    ],
    [
      'vary',
      () =>
        new Response('<html>language</html>', {
          headers: { 'Content-Type': 'text/html', Vary: 'Accept-Language' },
        }),
    ],
    ['error', () => new Response('unavailable', { status: 503 })],
    ['boundary', () => htmlResponse('<template data-dgst="error">')],
    ['large', () => htmlResponse('🙂'.repeat(150000))],
  ]) {
    let renders = 0;
    for (let i = 0; i < 2; i++) {
      const original = make();
      const expected = await original.clone().text();
      const result = await cachedHome(
        new Request('https://' + label + '.test/'),
        async () => {
          renders++;
          return original;
        },
        waitUntil,
      );
      assert.equal(
        await result.text(),
        expected,
        'Preserve the complete response for ' + label,
      );
    }
    assert.equal(renders, 2, 'Do not cache ' + label);
  }
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    const tiny = snapshotCache('unit', 1, 100, 2);
    await tiny.write('https://snapshot.test/a', 'a');
    now += 999;
    assert.equal((await tiny.read('https://snapshot.test/a')).body, 'a');
    now += 1;
    assert.equal(await tiny.read('https://snapshot.test/a'), null);
    for (const id of ['a', 'b', 'c'])
      await tiny.write('https://snapshot.test/' + id, id);
    assert.equal(
      await tiny.read('https://snapshot.test/a'),
      null,
      'Bound the entry count',
    );
    await tiny.write('https://snapshot.test/large', 'x'.repeat(101));
    assert.equal(await tiny.read('https://snapshot.test/large'), null);
    now += 21000;
    assert.equal(
      (
        await cachedHome(
          homeRequest(),
          async () => htmlResponse('renewed'),
          waitUntil,
        )
      ).headers.get('x-agenthow-page-cache'),
      'MISS',
    );
    let summaries = 0;
    const summary = () => Promise.resolve({ count: ++summaries });
    assert.equal((await monitoringSnapshot('/test', false, summary)).count, 1);
    assert.equal((await monitoringSnapshot('/test', false, summary)).count, 1);
    assert.equal((await monitoringSnapshot('/test', true, summary)).count, 2);
    now += 60000;
    assert.equal((await monitoringSnapshot('/test', false, summary)).count, 3);
  } finally {
    Date.now = clock;
  }
  await Promise.all(background);
  console.log(
    'PASS: homepage snapshots preserve full HTML, expire, isolate hosts/formats/private requests, reject errors and oversized bodies; monitoring snapshots expire and allow fresh reads.',
  );
  console.log(
    'PASS: interrupted initialization and cache fills do not block other requests; completed initialization, cached bodies and ETags remain reusable.',
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
