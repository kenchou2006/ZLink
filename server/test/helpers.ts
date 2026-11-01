import { env, exports } from "cloudflare:workers";
import { app } from "../src/index";
import { hashPassword } from "../src/lib/crypto";
import { signToken } from "../src/lib/jwt";
import { resolveAppUrls } from "../src/lib/urls";
import { resetBuildMetaCache } from "../src/lib/meta";

export interface TestUserOptions {
  username: string;
  email?: string;
  password?: string;
  isStaff?: boolean;
  isSuperUser?: boolean;
  isActive?: boolean;
  passwordLoginDisabled?: boolean;
  rawPasswordHash?: string; // e.g. for testing Django hash upgrade
}

export async function createUser(
  opts: TestUserOptions,
): Promise<{ id: number; username: string; token: string }> {
  const pwdHash =
    opts.rawPasswordHash ?? (await hashPassword(opts.password ?? "pass12345"));
  const now = new Date().toISOString();
  const email = opts.email ?? `${opts.username}@example.com`;

  const res = await env.DB.prepare(
    `INSERT INTO users (username, email, password, is_staff, is_superuser, is_active, date_joined, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      opts.username,
      email,
      pwdHash,
      (opts.isStaff ?? opts.isSuperUser) ? 1 : 0,
      opts.isSuperUser ? 1 : 0,
      (opts.isActive ?? true) ? 1 : 0,
      now,
      null,
    )
    .first<{ id: number }>();

  const userId = res!.id;

  await env.DB.prepare(
    `INSERT INTO profiles (user_id, avatar_url, password_login_disabled)
     VALUES (?, NULL, ?)`,
  )
    .bind(userId, opts.passwordLoginDisabled ? 1 : 0)
    .run();

  const token = await signToken("access", { user_id: userId }, env);
  return { id: userId, username: opts.username, token };
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  envOverrides?: Record<string, any>;
}

export async function call(
  path: string,
  opts: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.apiKey) {
    headers["X-API-Key"] = opts.apiKey;
  }

  const callEnv = opts.envOverrides ? { ...env, ...opts.envOverrides } : env;
  const urls = resolveAppUrls(callEnv);

  let fullUrl: string;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    fullUrl = path;
  } else {
    if (
      path.startsWith("/api") ||
      path.startsWith("/admin") ||
      path === "/config.json"
    ) {
      const subPath =
        urls.adminBase && path.startsWith("/api")
          ? `${urls.adminBase}${path}`
          : path;
      fullUrl = `${urls.adminOrigin}${subPath}`;
    } else {
      const subPath =
        urls.shortBase && !path.startsWith(urls.shortBase)
          ? `${urls.shortBase}${path === "/" ? "" : path}`
          : path;
      fullUrl = `${urls.shortOrigin}${subPath}`;
    }
  }

  const req = new Request(fullUrl, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });

  if (opts.envOverrides) {
    return app.fetch(req, callEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
  }

  const worker = (
    exports as unknown as {
      default: { fetch(r: Request, env: any, ctx: any): Promise<Response> };
    }
  ).default;
  return worker.fetch(req, callEnv, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as any);
}

export async function callWithAssets(
  path: string,
  opts: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.apiKey) {
    headers["X-API-Key"] = opts.apiKey;
  }

  let originalEnv: Record<string, any> | null = null;
  if (opts.envOverrides) {
    originalEnv = {};
    for (const [k, v] of Object.entries(opts.envOverrides)) {
      originalEnv[k] = (env as any)[k];
      (env as any)[k] = v;
    }
  }

  const callEnv = opts.envOverrides ? { ...env, ...opts.envOverrides } : env;
  const urls = resolveAppUrls(callEnv);

  let fullUrl: string;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    fullUrl = path;
  } else {
    if (
      path.startsWith("/api") ||
      path.startsWith("/admin") ||
      path === "/config.json"
    ) {
      const subPath =
        urls.adminBase && path.startsWith("/api")
          ? `${urls.adminBase}${path}`
          : path;
      fullUrl = `${urls.adminOrigin}${subPath}`;
    } else {
      const subPath =
        urls.shortBase && !path.startsWith(urls.shortBase)
          ? `${urls.shortBase}${path === "/" ? "" : path}`
          : path;
      fullUrl = `${urls.shortOrigin}${subPath}`;
    }
  }

  const req = new Request(fullUrl, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });

  const selfService = (env as any).__VITEST_POOL_WORKERS_SELF_SERVICE;
  let res: Response;
  if (selfService && typeof selfService.fetch === "function") {
    res = await selfService.fetch(req);
  } else {
    const worker = (
      exports as unknown as {
        default: { fetch(r: Request, env: any, ctx: any): Promise<Response> };
      }
    ).default;
    res = await worker.fetch(req, callEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
  }

  if (originalEnv) {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) {
        delete (env as any)[k];
      } else {
        (env as any)[k] = v;
      }
    }
  }

  return res;
}

export async function clearAll(): Promise<void> {
  resetBuildMetaCache();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM refresh_tokens"),
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM links"),
    env.DB.prepare("DELETE FROM profiles"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}
