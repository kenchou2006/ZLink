import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppUrls } from '../../server/src/lib/urls.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(root, '..', 'server');

export function stripJsonComments(jsonString) {
  let isInsideString = false;
  let isInsideComment = false;
  let offset = 0;
  let ret = '';
  for (let i = 0; i < jsonString.length; i++) {
    const current = jsonString[i];
    const next = jsonString[i + 1];
    if (!isInsideComment && current === '"' && jsonString[i - 1] !== '\\') {
      isInsideString = !isInsideString;
    }
    if (isInsideString) continue;
    if (!isInsideComment && current === '/' && next === '/') {
      ret += jsonString.slice(offset, i);
      offset = jsonString.indexOf('\n', i);
      if (offset === -1) {
        offset = jsonString.length;
        break;
      }
      i = offset;
    } else if (!isInsideComment && current === '/' && next === '*') {
      ret += jsonString.slice(offset, i);
      offset = jsonString.indexOf('*/', i + 2);
      if (offset === -1) break;
      offset += 2;
      i = offset - 1;
    }
  }
  ret += jsonString.slice(offset);
  return ret.replace(/,(\s*[}\]])/g, '$1');
}

export function parseDotEnv(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      result[key] = val;
    }
  }
  return result;
}

export function resolveBuildUrls(options = {}) {
  const isLocal = Boolean(options.isLocal);

  // 1. Production wrangler.jsonc vars
  let wranglerVars = {};
  const wranglerPath = resolve(serverDir, 'wrangler.jsonc');
  if (existsSync(wranglerPath)) {
    try {
      const parsed = JSON.parse(stripJsonComments(readFileSync(wranglerPath, 'utf8')));
      wranglerVars = parsed.vars || {};
    } catch (e) {
      console.warn('[resolve-build-env] Warning: failed to parse wrangler.jsonc:', e.message);
    }
  }

  // 2. Local .dev.vars
  let devVars = {};
  if (isLocal) {
    const devVarsPath = resolve(serverDir, '.dev.vars');
    if (existsSync(devVarsPath)) {
      try {
        devVars = parseDotEnv(readFileSync(devVarsPath, 'utf8'));
      } catch (e) {
        console.warn('[resolve-build-env] Warning: failed to parse .dev.vars:', e.message);
      }
    }
  }

  // Priority: process.env > (if local: .dev.vars) > wrangler.jsonc vars
  const getVar = (key) => {
    if (process.env[key] !== undefined && process.env[key].trim() !== '') {
      return process.env[key].trim();
    }
    if (isLocal && devVars[key] !== undefined && devVars[key].trim() !== '') {
      return devVars[key].trim();
    }
    if (
      wranglerVars[key] !== undefined &&
      typeof wranglerVars[key] === 'string' &&
      wranglerVars[key].trim() !== ''
    ) {
      return wranglerVars[key].trim();
    }
    return undefined;
  };

  const envLike = {
    SHORT_LINK_URL: getVar('SHORT_LINK_URL'),
    ADMIN_URL: getVar('ADMIN_URL'),
    SITE_ORIGIN: getVar('SITE_ORIGIN'),
  };

  return resolveAppUrls(envLike);
}
