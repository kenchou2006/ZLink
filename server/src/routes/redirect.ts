import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { createDb, links } from "../db";
import {
  normalizeShortCode,
  isValidHttpUrl,
  linkCacheKey,
  getCacheKeyVariants,
  getReservedWords,
} from "../lib/utils";
import { resolveAppUrls } from "../lib/urls";
import { sendGA4Event } from "../lib/ga4";

export const redirectRoutes = new Hono<AppEnv>();

/**
 * Cache-Control for a successful redirect. Worker responses are not stored by Cloudflare's CDN, so a
 * shared-cache TTL buys nothing here and only lets browsers keep serving an edited or deleted link.
 * Default is `no-store` (edits apply immediately and every click reaches GA4); REDIRECT_CACHE_TTL > 0
 * opts into browser caching, never past the link's own expiry.
 */
export function redirectCacheControl(
  ttlSetting: string | undefined,
  expiresAtSec: number,
  nowSec: number,
): string {
  const ttl = Number.parseInt(ttlSetting ?? "", 10);
  if (!Number.isFinite(ttl) || ttl <= 0) return "no-store";
  const maxAge = expiresAtSec > 0 ? Math.min(ttl, expiresAtSec - nowSec) : ttl;
  return maxAge > 0 ? `private, max-age=${maxAge}` : "no-store";
}

interface CachedLink {
  url: string;
  id: number;
  cached_at: number;
  expires_at?: number;
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 | ZLink</title>
    <style>
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
            background-color: #ffffff;
            color: #111827;
        }
        @media (prefers-color-scheme: dark) {
            body { background-color: #111827; color: #f9fafb; }
            .desc { color: #9ca3af !important; }
            .code { background: linear-gradient(135deg, #818cf8, #6366f1) !important; -webkit-background-clip: text !important; -webkit-text-fill-color: transparent !important; }
        }
        .container { text-align: center; max-width: 28rem; width: 100%; }
        .code {
            font-size: 4.5rem;
            font-weight: 800;
            line-height: 1;
            background: linear-gradient(135deg, #4f46e5, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        h1 { font-size: 1.875rem; font-weight: 700; margin-top: 1rem; }
        .desc { font-size: 0.95rem; color: #4b5563; margin-top: 0.75rem; line-height: 1.5; }
    </style>
</head>
<body>
<div class="container">
    <div class="code">404</div>
    <h1>Page Not Found</h1>
    <p class="desc">Oops! The link or page you are looking for doesn't exist or has been moved.</p>
</div>
</body>
</html>`;

export const NOT_FOUND_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

export function render404(): Response {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": NOT_FOUND_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function fullShortURL(c: Context<AppEnv>, code: string): string {
  const urls = resolveAppUrls(c.env, c.req.url);
  return code === "@root"
    ? `${urls.shortLinkUrl}/`
    : `${urls.shortLinkUrl}/${code}`;
}

async function runWaitUntil(
  c: Context<AppEnv>,
  promise: Promise<unknown>,
): Promise<void> {
  if (c.env.ENVIRONMENT === "test") {
    await promise;
    return;
  }
  try {
    if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
      c.executionCtx.waitUntil(promise);
      return;
    }
  } catch {}
  await promise;
}

export async function handleRedirect(c: Context<AppEnv>, code: string) {
  const normalized = normalizeShortCode(code);
  const lower = normalized.toLowerCase();

  // Reserved aliases handling
  const { aliases } = getReservedWords(c.env);
  if (aliases.has(lower)) {
    return render404();
  }

  const kv = c.env.KV;
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Check KV Cache
  if (kv && typeof kv.get === "function") {
    const variants = getCacheKeyVariants(normalized);
    for (const key of variants) {
      try {
        const val = await kv.get(key);
        if (val) {
          const cached = JSON.parse(val) as CachedLink;
          if (cached && cached.url) {
            // Check expiration
            if (
              cached.expires_at &&
              cached.expires_at > 0 &&
              nowSec >= cached.expires_at
            ) {
              await kv.delete(key).catch(() => {});
              break;
            }

            // Security check on cached URL
            if (!isValidHttpUrl(cached.url)) {
              return render404();
            }

            // Report GA4 asynchronously via waitUntil
            runWaitUntil(
              c,
              sendGA4Event(
                c.env,
                c.req.raw,
                cached.url,
                fullShortURL(c, normalized),
                "cache",
              ),
            );

            return new Response(null, {
              status: 302,
              headers: {
                Location: cached.url,
                "Cache-Control": redirectCacheControl(
                  c.env.REDIRECT_CACHE_TTL,
                  cached.expires_at ?? 0,
                  nowSec,
                ),
              },
            });
          }
        }
      } catch {
        // Continue to D1
      }
    }
  }

  // 2. Query D1 on cache miss
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(links)
    .where(eq(links.shortCode, normalized))
    .limit(1);

  const link = rows[0];
  if (!link) {
    return render404();
  }

  // Check expiration in DB
  if (link.expiresAt) {
    const expTime = new Date(link.expiresAt).getTime();
    if (expTime <= Date.now()) {
      return render404();
    }
  }

  // Security check on target URL
  if (!isValidHttpUrl(link.originalUrl)) {
    return render404();
  }

  // Backfill KV Cache
  if (kv && typeof kv.put === "function") {
    const cached: CachedLink = {
      url: link.originalUrl,
      id: link.id,
      cached_at: nowSec,
      expires_at: link.expiresAt
        ? Math.floor(new Date(link.expiresAt).getTime() / 1000)
        : 0,
    };
    const options: KVNamespacePutOptions = {};
    if (cached.expires_at && cached.expires_at > nowSec) {
      options.expiration = cached.expires_at;
    }
    const primaryKey = linkCacheKey(normalized);
    const putPromise =
      Object.keys(options).length > 0
        ? kv.put(primaryKey, JSON.stringify(cached), options)
        : kv.put(primaryKey, JSON.stringify(cached));
    await runWaitUntil(
      c,
      putPromise.catch(() => {}),
    );
  }

  // Report GA4 asynchronously via waitUntil
  runWaitUntil(
    c,
    sendGA4Event(
      c.env,
      c.req.raw,
      link.originalUrl,
      fullShortURL(c, normalized),
      "db",
    ),
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: link.originalUrl,
      "Cache-Control": redirectCacheControl(
        c.env.REDIRECT_CACHE_TTL,
        link.expiresAt
          ? Math.floor(new Date(link.expiresAt).getTime() / 1000)
          : 0,
        nowSec,
      ),
    },
  });
}

// Root path -> '@root'
redirectRoutes.get("/", (c) => handleRedirect(c, "@root"));

// Single segment code
redirectRoutes.get("/:code", (c) => handleRedirect(c, c.req.param("code")));
