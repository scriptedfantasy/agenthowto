import config from '@/agenthow.config.json';
import { getDb } from '@/db';
import { ApiError } from './validation';
import { limits } from './limits';

function encode(sequence: number) {
  return btoa(JSON.stringify({ v: 1, node: config.origin, sequence }));
}
function decode(value: string | null) {
  if (!value) return 0;
  try {
    if (value.length > 2048) throw Error();
    const parsed = JSON.parse(atob(value));
    if (
      parsed.v !== 1 ||
      parsed.node !== config.origin ||
      !Number.isSafeInteger(parsed.sequence) ||
      parsed.sequence < 0
    )
      throw Error();
    return parsed.sequence as number;
  } catch {
    throw new ApiError(
      400,
      'invalid_change_cursor',
      'Use the cursor returned by this node’s /changes endpoint.',
    );
  }
}
export async function changesSince(params: URLSearchParams) {
  const size = Number(params.get('limit') || 100);
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 100');
  const db = getDb();
  if (params.get('since') === 'now') {
    const latest = await db
      .prepare('SELECT COALESCE(MAX(sequence),0) sequence FROM changes')
      .first<{ sequence: number }>();
    return {
      items: [],
      next_cursor: encode(latest!.sequence),
      has_more: false,
      poll_after_seconds: limits.change_poll_seconds,
      node: config.origin,
    };
  }
  const after = decode(params.get('since'));
  const page = await db
    .prepare(
      'SELECT sequence,type,record_id id,origin,revision,note_id,note_origin,occurred_at FROM changes WHERE sequence>? ORDER BY sequence LIMIT ?',
    )
    .bind(after, size + 1)
    .all<{
      sequence: number;
      type: string;
      id: string;
      origin: string;
      revision: string;
      note_id: string;
      note_origin: string;
      occurred_at: string;
    }>();
  const items = page.results
    .slice(0, size)
    .map((item) => ({
      ...item,
      url:
        config.origin +
        (item.type === 'report' ? '/reports/' : '/notes/') +
        encodeURIComponent(item.id) +
        (item.type === 'report' ? '' : '.json'),
    }));
  return {
    items,
    next_cursor: encode(items.at(-1)?.sequence ?? after),
    has_more: page.results.length > size,
    poll_after_seconds:
      page.results.length > size ? 0 : limits.change_poll_seconds,
    node: config.origin,
  };
}
