import { resolveAppUrls, type EnvUrlsLike } from "./urls";

export const RESERVED_ALIASES = new Set([
  "api",
  "admin",
  "__admin",
  "static",
  "healthz",
  "links",
  "login",
  "logout",
  "create",
  "delete",
  "settings",
  "cache",
  "users",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

export const RESERVED_PREFIXES = [
  "api/",
  "admin/",
  "__admin/",
  "static/",
  "settings/",
  "delete/",
  "users/",
  "cache/",
  "links/",
  "assets/",
];

export function getReservedWords(
  env?: EnvUrlsLike,
  extraReserved?: Iterable<string>,
): {
  aliases: Set<string>;
  prefixes: string[];
} {
  const aliases = new Set(RESERVED_ALIASES);
  const prefixes = [...RESERVED_PREFIXES];

  if (env) {
    const urls = resolveAppUrls(env);
    if (urls.adminHost === urls.shortHost) {
      if (urls.adminBase.startsWith(urls.shortBase)) {
        const rel = urls.adminBase.slice(urls.shortBase.length);
        const segment = rel.split("/").filter(Boolean)[0];
        if (segment) {
          const lower = segment.toLowerCase();
          aliases.add(lower);
          prefixes.push(`${lower}/`);
        }
      }
    }
  }

  if (extraReserved) {
    for (const name of extraReserved) {
      const lower = name.toLowerCase().trim();
      if (lower) {
        aliases.add(lower);
        prefixes.push(`${lower}/`);
        const baseName = lower.replace(/\.[a-z0-9]+$/i, "");
        if (baseName && baseName !== lower) {
          aliases.add(baseName);
          prefixes.push(`${baseName}/`);
        }
      }
    }
  }

  return { aliases, prefixes };
}

export function normalizeShortCode(shortCode: string): string {
  if (shortCode === "/" || shortCode === "@root") {
    return "@root";
  }
  return shortCode;
}

export function validateShortCodeFormat(
  shortCode: string,
  env?: EnvUrlsLike,
  extraReserved?: Iterable<string>,
): string | null {
  if (!shortCode) {
    return "Alias is required.";
  }

  const normalized = normalizeShortCode(shortCode);
  const lower = normalized.toLowerCase();
  const { aliases, prefixes } = getReservedWords(env, extraReserved);

  if (aliases.has(lower)) {
    return `Alias '${normalized}' is reserved and cannot be used.`;
  }

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return `Alias '${normalized}' is reserved and cannot be used.`;
    }
  }

  if (normalized.length > 50) {
    return "Alias cannot exceed 50 characters.";
  }

  return null;
}

export function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function linkCacheKey(shortCode: string): string {
  return `:0:shortener:url:${shortCode}`;
}

export function getCacheKeyVariants(shortCode: string): string[] {
  const keys = [
    linkCacheKey(shortCode),
    linkCacheKey(encodeURIComponent(shortCode)),
    `shortener:url:${shortCode}`,
    `link:${shortCode}`,
  ];
  return Array.from(new Set(keys));
}
