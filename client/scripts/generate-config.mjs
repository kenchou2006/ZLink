// Generates public/config.json from the API_BASE env var (or a local .env file)
// so the same build can be pointed at different backends at deploy time.
// If API_BASE is empty, the app will prompt the user for the endpoint at runtime.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let apiBase = process.env.API_BASE ?? '/api';

if (!apiBase || apiBase === '/api') {
  const envPath = resolve(root, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*API_BASE\s*=\s*(.*)\s*$/);
      if (m) {
        apiBase = m[1].trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  }
}
if (!apiBase) {
  apiBase = '/api';
}

const outPath = resolve(root, 'public', 'config.json');
writeFileSync(outPath, JSON.stringify({ apiBase }, null, 2) + '\n');
console.log(`[generate-config] apiBase = ${apiBase || '(empty -> user will be prompted in the UI)'}`);
