import { bypassSharedCache, snapshotCache } from './snapshot-cache';
import { limits } from './limits';

const maxBytes = 512 * 1024;
const cache = snapshotCache(
  'homepage',
  limits.homepage_cache_seconds,
  maxBytes,
  4,
);
type WaitUntil = (promise: Promise<unknown>) => void;

function eligible(request: Request) {
  const url = new URL(request.url);
  const accept = request.headers.get('accept') || '*/*';
  return (
    ['GET', 'HEAD'].includes(request.method) &&
    url.pathname === '/' &&
    !url.search &&
    !bypassSharedCache(request.headers) &&
    !/application\/json|text\/markdown|text\/x-component/i.test(accept) &&
    /text\/html|\*\/\*/i.test(accept) &&
    ![...request.headers.keys()].some(
      (key) =>
        key === 'rsc' ||
        key === 'range' ||
        key.startsWith('next-') ||
        key.startsWith('x-vinext-') ||
        key.startsWith('x-nextjs-') ||
        key.startsWith('x-middleware-'),
    )
  );
}

export async function cachedHome(
  request: Request,
  render: (request: Request) => Promise<Response>,
  waitUntil: WaitUntil,
) {
  if (!eligible(request)) return render(request);
  const key = new URL(request.url).origin + '/';
  const hit = await cache.read(key);
  if (hit) {
    const saved = JSON.parse(hit.body) as {
      html: string;
      headers: [string, string][];
    };
    return response(saved.html, saved.headers, request, 'HIT', hit.age);
  }
  const fresh = await render(
    request.method === 'HEAD'
      ? new Request(request, { method: 'GET' })
      : request,
  );
  if (
    fresh.status !== 200 ||
    fresh.headers.has('set-cookie') ||
    !fresh.headers.get('content-type')?.includes('text/html') ||
    /private/i.test(fresh.headers.get('cache-control') || '') ||
    fresh.headers
      .get('vary')
      ?.split(',')
      .some(
        (v) =>
          ![
            'accept-encoding',
            'rsc',
            'next-router-state-tree',
            'next-router-prefetch',
            'next-router-segment-prefetch',
            'next-url',
            'x-vinext-interception-context',
            'x-vinext-mounted-slots',
            'x-vinext-rsc-render-mode',
          ].includes(v.trim().toLowerCase()),
      ) ||
    !fresh.body
  )
    return fresh;
  const reader = fresh.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
    size += chunk.value.length;
    // Pass oversized pages through with bounded buffering; never truncate them.
    if (size > maxBytes) {
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const buffered = chunks.shift();
          if (buffered) {
            controller.enqueue(buffered);
            return;
          }
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      if (request.method === 'HEAD') waitUntil(reader.cancel());
      return new Response(request.method === 'HEAD' ? null : stream, fresh);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const html = new TextDecoder().decode(bytes);
  const headers = [...fresh.headers.entries()];
  // React can return an error boundary with HTTP 200; never retain a partial page.
  if (
    html.includes('</html>') &&
    !/data-dgst=|D1_ERROR|SQLITE_ERROR/.test(html)
  )
    waitUntil(cache.write(key, JSON.stringify({ html, headers })));
  return response(html, headers, request, 'MISS', 0);
}

function response(
  html: string,
  supplied: [string, string][],
  request: Request,
  status: string,
  age: number,
) {
  const headers = new Headers(supplied);
  // The internal cache owns freshness. Do not extend it in an outer CDN or browser.
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('X-AgentHow-Page-Cache', status);
  headers.set('Age', String(age));
  headers.set('Content-Length', String(new TextEncoder().encode(html).length));
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers,
  });
}
