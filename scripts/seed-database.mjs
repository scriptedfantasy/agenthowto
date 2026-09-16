// Explicit setup only; HTTP requests never seed the database.
import { seedData } from '../db/seed.mjs';
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
const mode = process.argv.includes('--local')
  ? '--local'
  : process.argv.includes('--remote')
    ? '--remote'
    : null;
if (!mode)
  throw Error('Specify --local or --remote for the configured database');
const config = existsSync('wrangler.node.json')
  ? 'wrangler.node.json'
  : 'wrangler.local.json';
if (mode === '--remote' && config !== 'wrangler.node.json')
  throw Error(
    'Remote seed setup requires an explicitly configured independent node',
  );
const settings = JSON.parse(readFileSync('agenthow.config.json', 'utf8'));
const quote = (value) =>
  value === null
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : "'" + String(value).replaceAll("'", "''") + "'";
await seedData(
  {
    prepare(sql) {
      return {
        bind(...args) {
          let i = 0;
          return sql.replace(/\?/g, () => quote(args[i++]));
        },
      };
    },
    async batch(rows) {
      mkdirSync('work', { recursive: true });
      const file = 'work/starter-setup.sql';
      writeFileSync(file, rows.join(';\n') + ';\n');
      try {
        const result = spawnSync(
          'npx',
          [
            'wrangler',
            'd1',
            'execute',
            'DB',
            mode,
            '--config',
            config,
            '--file',
            file,
          ],
          { stdio: 'inherit' },
        );
        if (result.status !== 0) throw Error('Starter setup failed');
      } finally {
        rmSync(file, { force: true });
      }
    },
  },
  settings.includeDemoNotes,
);
