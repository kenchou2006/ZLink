#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildUrls } from './resolve-build-env.mjs';
import { prepareDist } from './prepare-dist.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isLocal = process.argv.includes('--local') || process.env.NODE_ENV === 'development';

const urls = resolveBuildUrls({ isLocal });
console.log(
  `[build] Building frontend for base: "${urls.adminBase}" (baseHref: "${urls.adminBaseHref}") [mode: ${isLocal ? 'local' : 'production'}]`,
);

// Always clean output directories beforehand so no stale layout remains
rmSync(resolve(root, 'dist', 'browser'), { recursive: true, force: true });
rmSync(resolve(root, 'dist', 'ZLinkFE'), { recursive: true, force: true });

// Run prebuild scripts
execSync('node scripts/apply-env-to-angular.mjs', { cwd: root, stdio: 'inherit' });
execSync('node scripts/generate-config.mjs', { cwd: root, stdio: 'inherit' });

// Run Angular build
const ngCmd = `npx ng build --base-href "${urls.adminBaseHref}"`;
console.log(`[build] Running: ${ngCmd}`);
execSync(ngCmd, { cwd: root, stdio: 'inherit' });

// Prepare distribution layout
prepareDist(urls);
console.log(`[build] Frontend build completed successfully.`);
