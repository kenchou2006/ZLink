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

export { RateLimiter } from "./durable-objects/RateLimiter";

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

// Admin SPA routing
app.get("/admin", async (c) => {
  if (c.env.ASSETS && typeof c.env.ASSETS.fetch === "function") {
    return c.env.ASSETS.fetch(
      new Request(new URL("/admin/index.html", c.req.url)),
    );
  }
  return render404();
});

app.get("/admin/*", async (c) => {
  if (c.env.ASSETS && typeof c.env.ASSETS.fetch === "function") {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404) {
      // Angular SPA client-side route fallback
      return c.env.ASSETS.fetch(
        new Request(new URL("/admin/index.html", c.req.url)),
      );
    }
    return res;
  }
  return render404();
});

// Short link redirect hot path (GET /{code} and GET /)
app.route("/", redirectRoutes);

// 404 handler
app.notFound((c) => {
  const path = c.req.path;
  if (path.startsWith("/api/") || path === "/api") {
    return c.json({ detail: "Not found." }, 404);
  }
  if (path.startsWith("/admin")) {
    if (c.env.ASSETS && typeof c.env.ASSETS.fetch === "function") {
      return c.env.ASSETS.fetch(
        new Request(new URL("/admin/index.html", c.req.url)),
      );
    }
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
app.fetch = ((req: Request, env?: Env, ctx?: ExecutionContext) => {
  return originalFetch(normalizeRequest(req), env, ctx);
}) as typeof app.fetch;

const worker = {
  fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> | Response {
    return originalFetch(normalizeRequest(req), env, ctx);
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
