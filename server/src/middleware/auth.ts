import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv, AuthUser } from "../env";
import { createDb, users, profiles, apiKeys } from "../db";
import { accessTokenFrom } from "../lib/session";
import { verifyToken, InvalidTokenError } from "../lib/jwt";
import { hashApiKey } from "../lib/crypto";
import { drfError } from "../lib/http";

async function resolveUser(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  token: string,
): Promise<AuthUser | null> {
  let userId: number;
  try {
    const payload = await verifyToken("access", token, c.env);
    userId = payload.user_id;
  } catch (e) {
    if (e instanceof InvalidTokenError) return null;
    throw e;
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isStaff: users.isStaff,
      isSuperUser: users.isSuperUser,
      isActive: users.isActive,
      dateJoined: users.dateJoined,
      avatarUrl: profiles.avatarUrl,
      passwordLoginDisabled: profiles.passwordLoginDisabled,
    })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    isStaff: Boolean(row.isStaff || row.isSuperUser),
    isSuperUser: Boolean(row.isSuperUser),
    isActive: Boolean(row.isActive),
    avatarUrl: row.avatarUrl ?? null,
    passwordLoginDisabled: Boolean(row.passwordLoginDisabled),
    dateJoined: row.dateJoined,
  };
}

async function resolveApiKey(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  rawKey: string,
): Promise<{
  user: AuthUser;
  key: { id: number; name: string; keyHash: string };
} | null> {
  const keyHash = await hashApiKey(rawKey);
  const db = createDb(c.env.DB);

  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const key = keys[0];
  if (!key || !key.isActive) return null;

  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  if (!key.createdById) return null;

  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      isStaff: users.isStaff,
      isSuperUser: users.isSuperUser,
      isActive: users.isActive,
      dateJoined: users.dateJoined,
      avatarUrl: profiles.avatarUrl,
      passwordLoginDisabled: profiles.passwordLoginDisabled,
    })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(users.id, key.createdById))
    .limit(1);

  const userRow = userRows[0];
  if (!userRow || !userRow.isActive) return null;

  // Best effort update last_used_at
  try {
    const now = new Date().toISOString();
    await db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, key.id))
      .run();
  } catch {
    // ignore
  }

  const user: AuthUser = {
    id: userRow.id,
    username: userRow.username,
    email: userRow.email,
    isStaff: Boolean(userRow.isStaff || userRow.isSuperUser),
    isSuperUser: Boolean(userRow.isSuperUser),
    isActive: Boolean(userRow.isActive),
    avatarUrl: userRow.avatarUrl ?? null,
    passwordLoginDisabled: Boolean(userRow.passwordLoginDisabled),
    dateJoined: userRow.dateJoined,
  };

  return { user, key: { id: key.id, name: key.name, keyHash: key.keyHash } };
}

export const authMiddleware =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const token = accessTokenFrom(c);
    if (!token) {
      drfError(401, "Authentication credentials were not provided.");
    }

    const user = await resolveUser(c, token);
    if (!user) {
      drfError(401, "Given token not valid for any token type");
    }

    c.set("user", user);
    c.set("userId", user.id);
    c.set("authMethod", "jwt");
    return next();
  };

export const optionalAuthMiddleware =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const token = accessTokenFrom(c);
    if (token) {
      const user = await resolveUser(c, token);
      if (user) {
        c.set("user", user);
        c.set("userId", user.id);
        c.set("authMethod", "jwt");
      }
    }
    return next();
  };

/** Authenticate via JWT (staff) OR X-API-Key. Used for links endpoints. */
export const authOrApiKey =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const apiKeyHeader = c.req.header("X-API-Key");
    if (apiKeyHeader) {
      const resolved = await resolveApiKey(c, apiKeyHeader);
      if (!resolved) {
        drfError(401, "Invalid API key.");
      }
      c.set("user", resolved.user);
      c.set("userId", resolved.user.id);
      c.set("apiKey", resolved.key);
      c.set("authMethod", "apikey");
      return next();
    }

    const token = accessTokenFrom(c);
    if (!token) {
      drfError(401, "Authentication credentials were not provided.");
    }

    const user = await resolveUser(c, token);
    if (!user) {
      drfError(401, "Given token not valid for any token type");
    }

    if (!user.isStaff && !user.isSuperUser) {
      drfError(403, "You do not have permission to perform this action.");
    }

    c.set("user", user);
    c.set("userId", user.id);
    c.set("authMethod", "jwt");
    return next();
  };

export const requireStaff =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const user = c.get("user");
    if (!user) {
      drfError(401, "Authentication credentials were not provided.");
    }
    if (!user.isStaff && !user.isSuperUser) {
      drfError(403, "You do not have permission to perform this action.");
    }
    return next();
  };

export const requireSuperUser =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const user = c.get("user");
    if (!user) {
      drfError(401, "Authentication credentials were not provided.");
    }
    if (!user.isSuperUser) {
      drfError(403, "You do not have permission to perform this action.");
    }
    return next();
  };
