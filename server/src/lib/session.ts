import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { drfError, isAllowedOrigin } from "./http";
import { resolveAppUrls } from "./urls";

export const ACCESS_COOKIE = "__Host-zl_at";
export const REFRESH_COOKIE = "__Secure-zl_rt";
const ACCESS_MAX_AGE = 15 * 60; // 15 mins
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function setSessionCookies(
  c: Context<AppEnv>,
  pair: { access: string; refresh: string },
): void {
  const urls = resolveAppUrls(c.env, c.req.url);
  const refreshPath = `${urls.adminBase}/api/auth/`;

  setCookie(c, ACCESS_COOKIE, pair.access, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  setCookie(c, REFRESH_COOKIE, pair.refresh, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: refreshPath,
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearSessionCookies(c: Context<AppEnv>): void {
  const urls = resolveAppUrls(c.env, c.req.url);
  const refreshPath = `${urls.adminBase}/api/auth/`;

  deleteCookie(c, ACCESS_COOKIE, { path: "/", secure: true });
  deleteCookie(c, REFRESH_COOKIE, { path: refreshPath, secure: true });
}

export function accessTokenFrom(c: Context<AppEnv>): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return getCookie(c, ACCESS_COOKIE) ?? null;
}

export function refreshTokenFrom(
  c: Context<AppEnv>,
  body: Record<string, unknown>,
): string | null {
  if (typeof body.refresh === "string" && body.refresh) return body.refresh;
  return getCookie(c, REFRESH_COOKIE) ?? null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF guard for state-changing browser requests. */
export const sameOriginGuard =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    // If request has X-API-Key or Bearer token (non-browser API clients), bypass same-origin check
    if (
      c.req.header("X-API-Key") ||
      c.req.header("Authorization")?.startsWith("Bearer ")
    ) {
      return next();
    }

    const origin = c.req.header("Origin");
    if (origin) {
      if (!isAllowedOrigin(origin, c.env, c.req.url)) {
        drfError(403, "Cross-site request blocked by CSRF protection.");
      }
    }

    const site = c.req.header("Sec-Fetch-Site");
    if (site && site !== "same-origin" && site !== "none") {
      drfError(403, "Cross-site request blocked by Sec-Fetch-Site.");
    }

    return next();
  };
