#!/usr/bin/env node
// Reads ALLOWED_HOSTS from environment or .env and writes it into angular.json serve configs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvVar(key) {
  if (process.env[key]) return process.env[key];

  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) return undefined;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
    if (m) return m[1].trim().replace(/^['\"]|['\"]$/g, '');
  }
  return undefined;
}

const allowedHostsStr = readEnvVar('ALLOWED_HOSTS') ?? '';
const allowedHosts = allowedHostsStr
  .split(',')
  .map(h => h.trim())
  .filter(h => h);

const angularPath = resolve(root, 'angular.json');
if (!existsSync(angularPath)) {
  console.log('[apply-env-to-angular] angular.json not found; nothing to do');
  process.exit(0);
}

try {
  const angularRaw = readFileSync(angularPath, 'utf8');
  const angularJson = JSON.parse(angularRaw);

  if (angularJson.projects && typeof angularJson.projects === 'object') {
    for (const [projName, proj] of Object.entries(angularJson.projects)) {
      const serve = proj?.architect?.serve;
      if (serve && serve.configurations) {
        for (const [cfgName, cfg] of Object.entries(serve.configurations)) {
          cfg.allowedHosts = allowedHosts.length ? allowedHosts : [];
        }
      }
    }

    writeFileSync(angularPath, JSON.stringify(angularJson, null, 2) + '\n');
    console.log(`[apply-env-to-angular] angular.json updated allowedHosts = ${JSON.stringify(allowedHosts)}`);
  }
} catch (e) {
  console.error('[apply-env-to-angular] Failed to update angular.json:', e);
  process.exit(1);
}
