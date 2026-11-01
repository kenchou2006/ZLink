import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const possibleSources = [
  resolve(root, 'dist', 'ZLinkFE', 'browser'),
  resolve(root, 'dist', 'browser', 'admin', 'browser'),
  resolve(root, 'dist', 'browser'),
];

let source = null;
for (const p of possibleSources) {
  if (existsSync(resolve(p, 'index.html'))) {
    source = p;
    break;
  }
}

if (!source) {
  console.error('[prepare-dist] Could not find built Angular bundle in expected paths.');
  process.exit(1);
}

const targetAdmin = resolve(root, 'dist', 'browser', 'admin');
const targetRoot = resolve(root, 'dist', 'browser');

if (source !== targetAdmin) {
  mkdirSync(targetAdmin, { recursive: true });
  cpSync(source, targetAdmin, { recursive: true });
  console.log(`[prepare-dist] Copied files from ${source} to ${targetAdmin}`);
}

// Ensure favicon.ico also exists at root of dist/browser
const favicon = resolve(targetAdmin, 'favicon.ico');
if (existsSync(favicon)) {
  cpSync(favicon, resolve(targetRoot, 'favicon.ico'));
}

// Ensure _headers exists at root of dist/browser (Worker assets directory root)
const headersFile = resolve(targetAdmin, '_headers');
if (existsSync(headersFile)) {
  cpSync(headersFile, resolve(targetRoot, '_headers'));
  console.log('[prepare-dist] Copied _headers to Worker assets root');
}

// Ensure _redirects also exists at root of dist/browser if present
const redirectsFile = resolve(targetAdmin, '_redirects');
if (existsSync(redirectsFile)) {
  cpSync(redirectsFile, resolve(targetRoot, '_redirects'));
}

console.log('[prepare-dist] Distribution ready at dist/browser/admin');
