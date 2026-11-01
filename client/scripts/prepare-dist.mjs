import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildUrls } from './resolve-build-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function prepareDist(urls, options = {}) {
  const customRoot = options.rootDir || root;
  if (!urls) {
    const isLocal = process.argv.includes('--local') || process.env.NODE_ENV === 'development';
    urls = resolveBuildUrls({ isLocal });
  }

  const possibleSources = [
    resolve(customRoot, 'dist', 'ZLinkFE', 'browser'),
    resolve(customRoot, 'dist', 'browser'),
  ];

  let source = null;
  for (const p of possibleSources) {
    if (existsSync(resolve(p, 'index.html')) || existsSync(resolve(p, '__admin', 'index.html'))) {
      source = p;
      break;
    }
  }

  if (!source) {
    console.error('[prepare-dist] Could not find built Angular bundle in expected paths.');
    process.exit(1);
  }

  const targetRoot = resolve(customRoot, 'dist', 'browser');
  const targetAdmin = resolve(targetRoot, '__admin');
  const adminBase = urls.adminBase || '';
  const targetAssets = adminBase ? resolve(targetRoot, adminBase.replace(/^\/+/, '')) : targetRoot;

  // If source is dist/ZLinkFE/browser, copy to targetAssets
  if (source !== targetRoot) {
    rmSync(targetRoot, { recursive: true, force: true });
    mkdirSync(targetAssets, { recursive: true });
    cpSync(source, targetAssets, { recursive: true });
  } else if (targetAssets !== targetRoot) {
    // If source was already targetRoot, ensure assets are under targetAssets
    const tempDir = resolve(customRoot, 'dist', '.temp-reorganize');
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    cpSync(targetRoot, tempDir, { recursive: true });
    rmSync(targetRoot, { recursive: true, force: true });
    mkdirSync(targetAssets, { recursive: true });
    cpSync(tempDir, targetAssets, { recursive: true });
    rmSync(tempDir, { recursive: true, force: true });
  }

  // 1. Ensure __admin exists
  mkdirSync(targetAdmin, { recursive: true });

  // 2. Locate and move index.html ONLY to __admin/index.html
  const possibleIndexPaths = [
    resolve(targetAssets, 'index.html'),
    resolve(targetRoot, 'index.html'),
    resolve(targetAdmin, 'index.html'),
  ];
  let foundIndex = null;
  for (const idxPath of possibleIndexPaths) {
    if (existsSync(idxPath)) {
      foundIndex = idxPath;
      break;
    }
  }

  if (!foundIndex) {
    console.error('[prepare-dist] index.html not found in build output!');
    process.exit(1);
  }

  if (foundIndex !== resolve(targetAdmin, 'index.html')) {
    cpSync(foundIndex, resolve(targetAdmin, 'index.html'));
  }

  // Clean index.html from any public asset path!
  // It MUST NOT exist at <admin base>/index.html or /index.html
  if (existsSync(resolve(targetAssets, 'index.html'))) {
    rmSync(resolve(targetAssets, 'index.html'), { force: true });
  }
  if (existsSync(resolve(targetRoot, 'index.html'))) {
    rmSync(resolve(targetRoot, 'index.html'), { force: true });
  }

  // 3. Remove static config.json so Worker handles dynamic config.json with Cache-Control: no-store
  for (const dir of [targetAssets, targetRoot, targetAdmin]) {
    const cfg = resolve(dir, 'config.json');
    if (existsSync(cfg)) {
      rmSync(cfg, { force: true });
    }
  }

  // 4. Ensure favicon.ico exists at asset root (and targetAssets if different)
  const favicon = resolve(targetAssets, 'favicon.ico');
  if (existsSync(favicon) && targetAssets !== targetRoot) {
    cpSync(favicon, resolve(targetRoot, 'favicon.ico'));
  }

  // 5. Clean stale files
  for (const stale of ['_redirects']) {
    rmSync(resolve(targetRoot, stale), { recursive: true, force: true });
    if (targetAssets !== targetRoot) {
      rmSync(resolve(targetAssets, stale), { recursive: true, force: true });
    }
  }

  // 6. Collect rootReservedNames
  const rootEntries = readdirSync(targetRoot).filter(
    (name) => name !== '__admin' && name !== '_headers',
  );
  const rootReservedNames = Array.from(new Set(rootEntries)).sort();

  // 7. Write build-meta.json to __admin/build-meta.json
  const buildMeta = {
    basePath: adminBase,
    builtAt: new Date().toISOString(),
    rootReservedNames,
  };
  writeFileSync(
    resolve(targetAdmin, 'build-meta.json'),
    JSON.stringify(buildMeta, null, 2) + '\n',
    'utf8',
  );

  // 8. Generate _headers at root of dist/browser
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'";
  const securityBlock = [
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
  ].join('\n');

  const baseHeaderPath = adminBase ? `${adminBase}/*` : '/*';
  const configHeaderPath = `${adminBase}/config.json`;

  const headersContent = [
    '/__admin/*',
    securityBlock,
    '',
    baseHeaderPath,
    securityBlock,
    '',
    configHeaderPath,
    '  Cache-Control: no-cache, no-store, must-revalidate',
    '',
  ].join('\n');

  writeFileSync(resolve(targetRoot, '_headers'), headersContent, 'utf8');
  if (targetAssets !== targetRoot && existsSync(resolve(targetAssets, '_headers'))) {
    rmSync(resolve(targetAssets, '_headers'), { force: true });
  }

  // 9. Clean temporary build directory
  rmSync(resolve(customRoot, 'dist', 'ZLinkFE'), { recursive: true, force: true });

  console.log(`[prepare-dist] Distribution ready at dist/browser for base "${adminBase}"`);
  console.log(`[prepare-dist] rootReservedNames: ${JSON.stringify(rootReservedNames)}`);
}

// Direct invocation
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  prepareDist();
}
