import { snapshotCache } from './snapshot-cache';
import config from '@/agenthow.config.json';
import { limits } from './limits';

// Only the human-facing summaries use this minute-long cache. The API keeps
// its existing five-second window and explicit fresh-read behavior.
const cache = snapshotCache(
  'monitoring',
  limits.monitoring_cache_seconds,
  256 * 1024,
  4,
);
export async function monitoringSnapshot<T>(
  path: string,
  fresh: boolean,
  generate: () => Promise<T>,
): Promise<T> {
  if (fresh) return generate();
  const key = config.origin + path;
  const hit = await cache.read(key);
  if (hit) return JSON.parse(hit.body) as T;
  const result = await generate();
  await cache.write(key, JSON.stringify(result));
  return result;
}
