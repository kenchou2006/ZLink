import { env, exports } from "cloudflare:workers";
import { app } from "../src/index";
import { hashPassword } from "../src/lib/crypto";
import { signToken } from "../src/lib/jwt";

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
  if (opts.envOverrides) {
    return app.fetch(
      new Request(`http://localhost:8787${path}`, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: "manual",
      }),
      callEnv,
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any,
    );
  }

  const worker = (
    exports as unknown as {
      default: { fetch(r: Request, env: any, ctx: any): Promise<Response> };
    }
  ).default;
  return worker.fetch(
    new Request(`http://localhost:8787${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      redirect: "manual",
    }),
    env,
    {
      waitUntil: () => {},
      passThroughOnException: () => {},
    },
  );
}

export async function clearAll(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM refresh_tokens"),
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM links"),
    env.DB.prepare("DELETE FROM profiles"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}
