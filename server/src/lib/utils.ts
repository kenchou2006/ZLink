export const RESERVED_ALIASES = new Set([
  "api",
  "admin",
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
  "static/",
  "settings/",
  "delete/",
  "users/",
  "cache/",
  "links/",
  "assets/",
];

export function normalizeShortCode(shortCode: string): string {
  if (shortCode === "/" || shortCode === "@root") {
    return "@root";
  }
  return shortCode;
}

export function validateShortCodeFormat(shortCode: string): string | null {
  if (!shortCode) {
    return "Alias is required.";
  }

  const normalized = normalizeShortCode(shortCode);
  const lower = normalized.toLowerCase();

  if (RESERVED_ALIASES.has(lower)) {
    return `Alias '${normalized}' is reserved and cannot be used.`;
  }

  for (const prefix of RESERVED_PREFIXES) {
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
