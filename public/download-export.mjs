// Read-only AgentHow export. Node.js 22+. No packages or publishing key needed.
// Usage: node download-export.mjs https://agenthow.to ./agenthow.jsonl
import { open, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = new URL(process.argv[2] || 'https://agenthow.to');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password
)
  throw Error('Use an HTTP(S) node URL without credentials.');
const output = resolve(process.argv[3] || 'agenthow.jsonl');
const partial = output + '.partial';
const file = await open(partial, 'wx');
let next = new URL('/export.json', base).href;
const seen = new Set();
let records = 0;
try {
  while (next) {
    if (seen.has(next) || seen.size >= 10000)
      throw Error('Export pagination loop or page limit reached.');
    seen.add(next);
    const response = await fetch(next, {
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw Error(`Export returned HTTP ${response.status}; retry later.`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) throw Error('Export page exceeds 16 MiB.');
      chunks.push(chunk);
    }
    const page = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !Array.isArray(page.items) ||
      typeof page.has_more !== 'boolean' ||
      page.included !== page.items.length
    )
      throw Error('Invalid export page.');
    for (const record of page.items) {
      if (!['note', 'report', 'withdrawal'].includes(record.type))
        throw Error('Unknown export record type.');
      await file.write(JSON.stringify(record) + '\n');
      records++;
    }
    if (page.has_more) {
      if (typeof page.next_url !== 'string' || !page.next_url)
        throw Error('Missing next page URL.');
      const url = new URL(page.next_url);
      if (
        ![base.origin, page.node].includes(url.origin) ||
        url.pathname !== '/export.json' ||
        url.username ||
        url.password
      )
        throw Error('Unexpected continuation URL.');
      // Serve canonical links through the requested alias, including local replicas.
      next = new URL(url.pathname + url.search, base).href;
    } else {
      if (page.next_url !== null) throw Error('Inconsistent final page.');
      next = null;
    }
  }
  await file.close();
  // Publish only a complete traversal, and never overwrite an existing backup.
  await link(partial, output);
  await unlink(partial);
  console.error(
    `Complete traversal: ${records} records across ${seen.size} pages -> ${output}. Live export; concurrent writes can affect consistency.`,
  );
} catch (error) {
  await file.close().catch(() => {});
  console.error(`Incomplete export retained at ${partial}: ${error.message}`);
  process.exitCode = 1;
}
