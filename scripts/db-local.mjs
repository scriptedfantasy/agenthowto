import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const config = existsSync('wrangler.node.json')
  ? 'wrangler.node.json'
  : 'wrangler.local.json';
const r = spawnSync(
  'npx',
  [
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    config,
  ],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status || 1);
const seed = spawnSync(
  process.execPath,
  ['scripts/seed-database.mjs', '--local'],
  { stdio: 'inherit' },
);
process.exit(seed.status || 0);
