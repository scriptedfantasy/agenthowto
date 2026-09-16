// Completed public data only: a canceled fill never owns another request's I/O.
// Each cache has a byte budget, an entry limit, and a deployment-specific key.
declare const __AGENTHOW_BUILD_ID__: string;
const build =
  typeof __AGENTHOW_BUILD_ID__ === 'undefined' ? 'test' : __AGENTHOW_BUILD_ID__;

export function bypassSharedCache(headers: Headers) {
  return (
    headers.has('authorization') ||
    headers.has('cookie') ||
    /(?:no-cache|no-store|max-age\s*=\s*0)/i.test(
      headers.get('cache-control') || '',
    ) ||
    /no-cache/i.test(headers.get('pragma') || '')
  );
}

export function snapshotCache(
  namespace: string,
  seconds: number,
  maxBytes: number,
  maxEntries: number,
) {
  const entries = new Map<string, { body: string; at: number }>();
  return {
    async read(key: string): Promise<{ body: string; age: number } | null> {
      const now = Date.now();
      for (const [id, entry] of entries)
        if (now - entry.at >= seconds * 1000) entries.delete(id);
      const local = entries.get(key);
      if (local)
        return { body: local.body, age: Math.floor((now - local.at) / 1000) };
      try {
        const response = await edge()?.match(cacheKey(key));
        if (!response) return null;
        const at = Number(response.headers.get('X-Snapshot-Time'));
        const age = Date.now() - at;
        if (!at || age < 0 || age >= seconds * 1000) return null;
        const body = await response.text();
        if (new TextEncoder().encode(body).length > maxBytes) return null;
        remember(key, body, at);
        return { body, age: Math.floor(age / 1000) };
      } catch {
        return null;
      }
    },
    async write(key: string, body: string) {
      if (new TextEncoder().encode(body).length > maxBytes) return;
      const at = Date.now();
      remember(key, body, at);
      try {
        await edge()?.put(
          cacheKey(key),
          new Response(body, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=' + seconds,
              'X-Snapshot-Time': String(at),
            },
          }),
        );
      } catch {
        /* Cache storage must not take public reads down. */
      }
    },
  };
  function remember(key: string, body: string, at: number) {
    entries.delete(key);
    while (entries.size >= maxEntries)
      entries.delete(entries.keys().next().value!);
    entries.set(key, { body, at });
  }
  function cacheKey(key: string) {
    const url = new URL(key);
    url.pathname =
      '/__agenthow_snapshot/' + build + '/' + namespace + url.pathname;
    return new Request(url, { method: 'GET' });
  }
  function edge() {
    return typeof caches === 'undefined'
      ? undefined
      : (caches as CacheStorage & { default: Cache }).default;
  }
}
