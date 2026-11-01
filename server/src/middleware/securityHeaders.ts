import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { isAllowedOrigin } from "../lib/http";

export const securityHeaders =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const origin = c.req.header("Origin");
    const isAllowed = isAllowedOrigin(origin, c.env, c.req.url);

    // If OPTIONS preflight
    if (c.req.method === "OPTIONS") {
      const headers = new Headers();
      if (isAllowed && origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
      }
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Key",
      );
      headers.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers });
    }

    await next();

    // Set standard security headers on response
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!c.res.headers.has("Content-Security-Policy")) {
      c.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:;",
      );
    }
    if (c.req.url.startsWith("https://")) {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }

    if (isAllowed && origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
    }
  };
