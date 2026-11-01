import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { errorHandler } from "./middleware/error";
import { securityHeaders } from "./middleware/securityHeaders";
import { sameOriginGuard } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { linkRoutes } from "./routes/links";
import { userRoutes } from "./routes/users";
import { apiKeyRoutes } from "./routes/apikeys";
import { profileRoutes } from "./routes/profile";
import { cacheRoutes } from "./routes/cache";
import { healthzRoutes } from "./routes/healthz";
import { docsRoutes } from "./routes/docs";
import { redirectRoutes, render404 } from "./routes/redirect";
import { handleScheduled } from "./jobs/index";
import { resolveAppUrls, hostsMatch, type AppUrls } from "./lib/urls";
import {
  getBuildMeta,
  resetBuildMetaCache,
  setBuildMetaCache,
  type BuildMeta,
} from "./lib/meta";

export { RateLimiter } from "./durable-objects/RateLimiter";
export { getBuildMeta, resetBuildMetaCache, setBuildMetaCache, type BuildMeta };

export const app = new Hono<AppEnv>();

// Global middleware
app.use("*", securityHeaders());
app.use("/api/*", sameOriginGuard());
app.onError(errorHandler);

// Health check
app.route("/healthz", healthzRoutes);
app.route("/api/healthz", healthzRoutes);

// Management API
app.route("/api/auth", authRoutes);
app.route("/api/links", linkRoutes);
app.route("/api/users", userRoutes);
app.route("/api/api-keys", apiKeyRoutes);
app.route("/api/profile", profileRoutes);
app.route("/api/cache", cacheRoutes);
app.route("/api", docsRoutes); // /api/schema, /api/docs

// Short link redirect hot path (GET /{code} and GET /)
app.route("/", redirectRoutes);

// 404 handler
app.notFound((c) => {
  const path = c.req.path;
  if (path.startsWith("/api/") || path === "/api") {
    return c.json({ detail: "Not found." }, 404);
  }
  return render404();
});

export function normalizeRequest(req: Request): Request {
  const url = new URL(req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return new Request(url.toString(), req);
  }
  return req;
}

const originalFetch = app.fetch.bind(app);

export async function serveAdminIndex(
  req: Request,
  env: Env,
  urls: AppUrls,
): Promise<Response> {
  const meta = await getBuildMeta(env, req.url);
  if (meta && meta.basePath !== urls.adminBase) {
    console.error(
      `Frontend build base mismatch: built for '${meta.basePath}', but runtime configured with '${urls.adminBase}'. URL changed, rebuild frontend (改了 URL 要重新建置前端).`,
    );
    return new Response(
      "Frontend build base mismatch. Please rebuild frontend after changing URL.",
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  let indexRes: Response | null = null;
  if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
    indexRes = await env.ASSETS.fetch(
      new Request(new URL("/__admin/index.html", req.url)),
    );
  }

  if (!indexRes || indexRes.status === 404) {
    return render404();
  }

  let baseRewritten = false;
  const rewriter = new HTMLRewriter()
    .on("base", {
      element(e) {
        baseRewritten = true;
        e.setAttribute("href", urls.adminBaseHref);
      },
    })
    .on("head", {
      element(e) {
        if (!baseRewritten) {
          e.prepend(`<base href="${urls.adminBaseHref}">`, { html: true });
        }
      },
    });

  const transformed = rewriter.transform(indexRes);
  const headers = new Headers(transformed.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return new Response(transformed.body, {
    status: 200,
    headers,
  });
}

export async function dispatchRequest(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const reqUrl = new URL(req.url);
  const reqHost = reqUrl.host.toLowerCase();
  const reqPath = reqUrl.pathname;
  const urls = resolveAppUrls(env, req.url);

  // Health check: /healthz
  if (reqPath === "/healthz") {
    return originalFetch(normalizeRequest(req), env, ctx);
  }

  // 1. ADMIN_URL match (host match + admin base)
  if (hostsMatch(reqHost, urls.adminHost)) {
    if (urls.adminBase !== "" && reqPath === urls.adminBase) {
      // /otp without slash -> 301 to /otp/
      const target = new URL(
        `${urls.adminBase}/${reqUrl.search}`,
        req.url,
      ).toString();
      return new Response(null, {
        status: 301,
        headers: {
          Location: target,
        },
      });
    }

    if (urls.adminBase === "" || reqPath.startsWith(urls.adminBase + "/")) {
      const subPath = urls.adminBase
        ? reqPath.slice(urls.adminBase.length)
        : reqPath;

      // Disallow external access to internal /__admin path
      if (subPath === "/__admin" || subPath.startsWith("/__admin/")) {
        return render404();
      }

      // Dynamic config.json
      if (subPath === "/config.json") {
        return new Response(
          JSON.stringify({
            apiBase: `${urls.adminBase}/api`,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      }

      // API routes: subPath is "/api" or starts with "/api/"
      if (subPath === "/api" || subPath.startsWith("/api/")) {
        const apiReq = new Request(
          new URL(subPath + reqUrl.search, req.url).toString(),
          req,
        );
        return originalFetch(normalizeRequest(apiReq), env, ctx);
      }

      // Admin SPA fallback: only GET / HEAD
      if (req.method !== "GET" && req.method !== "HEAD") {
        return render404();
      }

      // Serve Admin SPA HTML (homepage and deep SPA routes)
      return serveAdminIndex(req, env, urls);
    }
  }

  // 2. SHORT_LINK_URL match
  if (hostsMatch(reqHost, urls.shortHost)) {
    if (urls.shortBase !== "" && reqPath === urls.shortBase) {
      // Short base without slash -> 301 to short base with slash
      const target = new URL(
        `${urls.shortBase}/${reqUrl.search}`,
        req.url,
      ).toString();
      return new Response(null, {
        status: 301,
        headers: {
          Location: target,
        },
      });
    }

    if (urls.shortBase === "" || reqPath.startsWith(urls.shortBase + "/")) {
      const shortSubPath = urls.shortBase
        ? reqPath.slice(urls.shortBase.length)
        : reqPath;

      // Disallow management functions on short link domain
      if (
        shortSubPath === "/api" ||
        shortSubPath.startsWith("/api/") ||
        shortSubPath === "/admin" ||
        shortSubPath.startsWith("/admin/") ||
        shortSubPath === "/__admin" ||
        shortSubPath.startsWith("/__admin/")
      ) {
        return render404();
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return render404();
      }

      const redirectReq = new Request(
        new URL(shortSubPath + reqUrl.search, req.url).toString(),
        req,
      );
      return originalFetch(normalizeRequest(redirectReq), env, ctx);
    }
  }

  // 3. Neither matched -> 404
  return render404();
}

app.fetch = ((req: Request, env?: Env, ctx?: ExecutionContext) => {
  return dispatchRequest(
    req,
    env ?? ({} as Env),
    ctx ??
      ({
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any),
  );
}) as typeof app.fetch;

const worker = {
  fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> | Response {
    return dispatchRequest(req, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(handleScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;

export default worker;
