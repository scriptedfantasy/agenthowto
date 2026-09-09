import { digest } from './validation';
import { limits } from './limits';

type Snapshot = { body: string; headers: [string, string][] };
// Only plain data may cross request contexts in Workers, never Response streams.
const pending = new Map<string, Promise<Snapshot | null>>();
const maxBytes = 262144;
const cacheable =
  /^(?:search|notes|requests|index|topics|changes)(?:\.(?:json|md))?$|^notes\/[^/]+(?:\.(?:json|md)|\/reports)?$|^reports\/[^/]+$|^(?:agenthow\.json|openapi\.json|AGENTS\.md|instructions(?:\.(?:md|json))?|replicate(?:\.(?:md|json))?|trust(?:\.(?:md|json))?|llms\.txt)$/;
function smallPublicResponse(response: Response) {
  return (
    response.status === 200 &&
    !response.headers.has('set-cookie') &&
    response.headers.has('content-length') &&
    Number(response.headers.get('content-length')) <= maxBytes
  );
}
async function withTag(response: Response) {
  if (!smallPublicResponse(response)) return response;
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set('ETag', '"' + (await digest(body)) + '"');
  return new Response(body, { status: 200, headers });
}
function restore(snapshot: Snapshot) {
  return new Response(snapshot.body, {
    status: 200,
    headers: snapshot.headers,
  });
}
function finish(response: Response, request: Request, status: string) {
  const headers = new Headers(response.headers);
  headers.set('X-AgentHow-Cache', status);
  const tag = headers.get('ETag');
  const match = request.headers
    .get('if-none-match')
    ?.split(',')
    .some(
      (value) =>
        value.trim() === '*' || value.trim().replace(/^W\//, '') === tag,
    );
  if (tag && match) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}
export async function cachedRead(
  request: Request,
  path: string,
  format: string,
  generate: () => Promise<Response>,
) {
  if (!['GET', 'HEAD'].includes(request.method) || !cacheable.test(path))
    return generate();
  const bypass =
    request.headers.has('authorization') ||
    request.headers.has('cookie') ||
    /(?:no-cache|no-store|max-age\s*=\s*0)/i.test(
      request.headers.get('cache-control') || '',
    ) ||
    new URL(request.url).searchParams.get('since') === 'now';
  const cache =
    typeof caches === 'undefined'
      ? undefined
      : (caches as CacheStorage & { default: Cache }).default;
  if (bypass || !cache)
    return finish(await withTag(await generate()), request, 'BYPASS');
  const url = new URL(request.url);
  url.pathname = '/__agenthow_read_cache/v1/' + encodeURIComponent(path);
  url.searchParams.set('_representation', format);
  url.searchParams.sort();
  const cacheKey = new Request(url, { method: 'GET' });
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return finish(hit, request, 'HIT');
  } catch {
    /* Cache failures must not take retrieval down. */
  }

  const existing = pending.get(url.href);
  if (existing) {
    const snapshot = await existing;
    return snapshot
      ? finish(restore(snapshot), request, 'MISS')
      : finish(await withTag(await generate()), request, 'BYPASS');
  }
  // Large responses and errors stay with their originating request. Followers
  // generate their own response when no bounded, shareable snapshot is available.
  let uncached: Response | undefined;
  const loading = (async (): Promise<Snapshot | null> => {
    const fresh = await generate();
    if (!smallPublicResponse(fresh)) {
      uncached = fresh;
      return null;
    }
    const body = await fresh.text();
    const headers = new Headers(fresh.headers);
    headers.set('ETag', '"' + (await digest(body)) + '"');
    headers.set(
      'Cache-Control',
      'public, max-age=0, s-maxage=' + limits.read_cache_seconds,
    );
    const snapshot = { body, headers: [...headers.entries()] };
    try {
      await cache.put(cacheKey, restore(snapshot));
    } catch {
      /* Continue without edge storage. */
    }
    return snapshot;
  })();
  if (pending.size < 24) pending.set(url.href, loading);
  try {
    const snapshot = await loading;
    return finish(
      snapshot ? restore(snapshot) : uncached!,
      request,
      snapshot ? 'MISS' : 'BYPASS',
    );
  } finally {
    if (pending.get(url.href) === loading) pending.delete(url.href);
  }
}
