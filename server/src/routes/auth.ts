import { Hono, type Context } from "hono";
import { eq, desc, and } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import type { AppEnv } from "../env";
import { createDb, users, profiles, passkeys, refreshTokens } from "../db";
import { hashPassword, verifyPassword, needsRehash } from "../lib/crypto";
import { signToken, verifyToken } from "../lib/jwt";
import { drfError, readJson } from "../lib/http";
import { authMiddleware } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { setSessionCookies, clearSessionCookies } from "../lib/session";
import { resolveAppUrls } from "../lib/urls";

export const authRoutes = new Hono<AppEnv>();

function formatUser(u: {
  id: number;
  username: string;
  email: string;
  isStaff: number | boolean;
  isSuperUser: number | boolean;
  isActive: number | boolean;
  dateJoined: string;
  avatarUrl?: string | null;
  passwordLoginDisabled?: number | boolean | null;
}) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    is_staff: Boolean(u.isStaff),
    is_superuser: Boolean(u.isSuperUser),
    is_active: Boolean(u.isActive),
    date_joined: u.dateJoined,
    avatar_url: u.avatarUrl ?? null,
    password_login_disabled: Boolean(u.passwordLoginDisabled),
  };
}

// POST /auth/login/
authRoutes.post("/login", rateLimit("login", "15/min"), async (c) => {
  const body = await readJson(c.req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    drfError(400, "Username and password are required.", {
      ...(username ? {} : { username: ["This field is required."] }),
      ...(password ? {} : { password: ["This field is required."] }),
    });
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      passwordHash: users.passwordHash,
      isStaff: users.isStaff,
      isSuperUser: users.isSuperUser,
      isActive: users.isActive,
      dateJoined: users.dateJoined,
      avatarUrl: profiles.avatarUrl,
      passwordLoginDisabled: profiles.passwordLoginDisabled,
    })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(users.username, username))
    .limit(1);

  const user = rows[0];
  if (!user || !user.isActive) {
    drfError(401, "No active account found with the given credentials");
  }

  if (user.passwordLoginDisabled) {
    drfError(
      400,
      "Password login is disabled for this account. Sign in with a passkey instead.",
      {
        detail:
          "Password login is disabled for this account. Sign in with a passkey instead.",
      },
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    drfError(401, "No active account found with the given credentials");
  }

  // Upgrade password hash if it was from older iterations (e.g. Django)
  if (needsRehash(user.passwordHash)) {
    const freshHash = await hashPassword(password);
    await db
      .update(users)
      .set({ passwordHash: freshHash })
      .where(eq(users.id, user.id))
      .run();
  }

  const now = new Date().toISOString();
  await db
    .update(users)
    .set({ lastLogin: now })
    .where(eq(users.id, user.id))
    .run();

  const jti = crypto.randomUUID();
  const [access, refresh] = await Promise.all([
    signToken("access", { user_id: user.id }, c.env),
    signToken("refresh", { user_id: user.id, jti, family_id: jti }, c.env),
  ]);

  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db.insert(refreshTokens).values({
    id: jti,
    jti,
    userId: user.id,
    familyId: jti,
    isRevoked: 0,
    expiresAt,
    createdAt: now,
  });

  setSessionCookies(c, { access, refresh });

  return c.json({
    access,
    refresh,
    user: formatUser(user),
  });
});

// POST /auth/refresh/ & /auth/token/refresh/
const handleRefresh = async (c: Context<AppEnv>) => {
  const body = await readJson(c.req);
  const rawRefresh = typeof body.refresh === "string" ? body.refresh : "";
  if (!rawRefresh) {
    drfError(400, "refresh token is required.", {
      refresh: ["This field is required."],
    });
  }

  let payload;
  try {
    payload = await verifyToken("refresh", rawRefresh, c.env);
  } catch {
    drfError(401, "Token is invalid or expired");
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.jti, payload.jti))
    .limit(1);

  const existing = rows[0];
  if (!existing || existing.isRevoked) {
    drfError(401, "Token is invalid or expired");
  }

  // Token rotation
  const newJti = crypto.randomUUID();
  const [newAccess, newRefresh] = await Promise.all([
    signToken("access", { user_id: payload.user_id }, c.env),
    signToken(
      "refresh",
      { user_id: payload.user_id, jti: newJti, family_id: payload.family_id },
      c.env,
    ),
  ]);

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Mark old token revoked/rotated and insert new
  await db.batch([
    db
      .update(refreshTokens)
      .set({ isRevoked: 1, rotatedAt: now, rotatedTokens: newJti })
      .where(eq(refreshTokens.id, existing.id)),
    db.insert(refreshTokens).values({
      id: newJti,
      jti: newJti,
      userId: payload.user_id,
      familyId: payload.family_id,
      isRevoked: 0,
      expiresAt,
      createdAt: now,
    }),
  ]);

  setSessionCookies(c, { access: newAccess, refresh: newRefresh });

  return c.json({
    access: newAccess,
    refresh: newRefresh,
  });
};

authRoutes.post("/refresh", handleRefresh);
authRoutes.post("/token/refresh", handleRefresh);

// POST /auth/logout/
authRoutes.post("/logout", authMiddleware(), async (c) => {
  const body = await readJson(c.req);
  const rawRefresh = typeof body.refresh === "string" ? body.refresh : "";
  if (!rawRefresh) {
    drfError(400, "refresh token is required.");
  }

  try {
    const payload = await verifyToken("refresh", rawRefresh, c.env);
    const db = createDb(c.env.DB);
    await db
      .update(refreshTokens)
      .set({ isRevoked: 1 })
      .where(eq(refreshTokens.jti, payload.jti))
      .run();
  } catch {
    drfError(400, "Invalid or expired refresh token.");
  }

  clearSessionCookies(c);
  return new Response(null, { status: 205 });
});

// GET /auth/me/
authRoutes.get("/me", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  return c.json(formatUser(user));
});

// Passkeys endpoints
export function webAuthnConfig(reqUrl: string, env: AppEnv["Bindings"]) {
  const urls = resolveAppUrls(env, reqUrl);
  const rpID = env.WEBAUTHN_RP_ID || urls.adminHostname;
  const rpName = env.WEBAUTHN_RP_NAME || "ZLink";

  const isDevOrTest =
    env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";

  // Read origins only from config: dedicated variable (WEBAUTHN_ORIGINS / WEBAUTHN_ORIGIN) or ADMIN_URL
  const rawOrigins =
    env.WEBAUTHN_ORIGINS || env.WEBAUTHN_ORIGIN || urls.adminOrigin || "";

  const candidates = rawOrigins
    ? rawOrigins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [urls.adminOrigin];

  const expectedOrigins = candidates.filter((originStr) => {
    try {
      const u = new URL(originStr);
      const isLocalhost =
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "[::1]";

      // Only allow localhost in development/test
      if (isLocalhost) {
        return isDevOrTest;
      }

      // In production, only allow https
      if (!isDevOrTest) {
        return u.protocol === "https:";
      }

      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  });

  return { rpID, rpName, expectedOrigins };
}

// POST /auth/passkeys/register/options/
authRoutes.post("/passkeys/register/options", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  const { rpID, rpName } = webAuthnConfig(c.req.url, c.env);
  const db = createDb(c.env.DB);

  const existing = await db
    .select({
      credentialId: passkeys.credentialId,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: isoUint8Array.fromUTF8String(String(user.id)),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: JSON.parse(p.transports || "[]"),
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  const state = await signToken(
    "passkey_state",
    { challenge: options.challenge, user_id: user.id },
    c.env,
    "5m",
  );

  return c.json({ options, state });
});

// POST /auth/passkeys/register/verify/
authRoutes.post("/passkeys/register/verify", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  const body = await readJson(c.req);
  const state = typeof body.state === "string" ? body.state : "";
  const credential = body.credential as RegistrationResponseJSON | undefined;
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";

  if (!state || !credential) {
    drfError(400, "state and credential are required.");
  }

  let statePayload;
  try {
    statePayload = await verifyToken("passkey_state", state, c.env);
  } catch {
    drfError(400, "Invalid or expired registration state.");
  }

  if (statePayload.user_id !== user.id) {
    drfError(400, "Invalid registration state.");
  }

  const { rpID, expectedOrigins } = webAuthnConfig(c.req.url, c.env);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: statePayload.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("[passkey register error]", err);
    drfError(400, "Could not verify passkey registration.");
  }

  if (!verification.verified || !verification.registrationInfo) {
    drfError(400, "Could not verify passkey registration.");
  }

  const { registrationInfo } = verification;
  const aaguid =
    registrationInfo.aaguid &&
    registrationInfo.aaguid !== "00000000-0000-0000-0000-000000000000"
      ? registrationInfo.aaguid
      : "";

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const credentialId = registrationInfo.credential.id;
  const publicKey = isoBase64URL.fromBuffer(
    registrationInfo.credential.publicKey,
  );
  const transports = JSON.stringify(
    registrationInfo.credential.transports ||
      credential.response?.transports ||
      [],
  );

  const [inserted] = await db
    .insert(passkeys)
    .values({
      userId: user.id,
      name,
      credentialId,
      publicKey,
      signCount: registrationInfo.credential.counter,
      transports,
      aaguid,
      createdAt: now,
      lastUsedAt: null,
    })
    .returning();

  return c.json(
    {
      id: inserted.id,
      name: inserted.name,
      aaguid: inserted.aaguid,
      created_at: inserted.createdAt,
      last_used_at: inserted.lastUsedAt,
    },
    201,
  );
});

// POST /auth/passkeys/login/options/
authRoutes.post("/passkeys/login/options", async (c) => {
  const { rpID } = webAuthnConfig(c.req.url, c.env);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });

  const state = await signToken(
    "passkey_state",
    { challenge: options.challenge },
    c.env,
    "5m",
  );

  return c.json({ options, state });
});

// POST /auth/passkeys/login/verify/
authRoutes.post("/passkeys/login/verify", async (c) => {
  const body = await readJson(c.req);
  const state = typeof body.state === "string" ? body.state : "";
  const credential = body.credential as AuthenticationResponseJSON | undefined;

  if (!state || !credential) {
    drfError(400, "state and credential are required.");
  }

  let statePayload;
  try {
    statePayload = await verifyToken("passkey_state", state, c.env);
  } catch {
    drfError(400, "Invalid or expired login state.");
  }

  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      passkey: passkeys,
      user: users,
      profile: profiles,
    })
    .from(passkeys)
    .innerJoin(users, eq(passkeys.userId, users.id))
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(passkeys.credentialId, credential.id))
    .limit(1);

  const match = rows[0];
  if (!match || !match.user.isActive) {
    drfError(400, "Passkey not recognized.");
  }

  const { rpID, expectedOrigins } = webAuthnConfig(c.req.url, c.env);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: statePayload.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      credential: {
        id: match.passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(match.passkey.publicKey),
        counter: match.passkey.signCount,
        transports: JSON.parse(match.passkey.transports || "[]"),
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("[passkey auth error]", err);
    drfError(400, "Could not verify passkey.");
  }

  if (!verification.verified) {
    drfError(400, "Could not verify passkey.");
  }

  const now = new Date().toISOString();
  await db
    .update(passkeys)
    .set({
      signCount: verification.authenticationInfo.newCounter,
      lastUsedAt: now,
    })
    .where(eq(passkeys.id, match.passkey.id))
    .run();
  await db
    .update(users)
    .set({ lastLogin: now })
    .where(eq(users.id, match.user.id))
    .run();

  const jti = crypto.randomUUID();
  const [access, refresh] = await Promise.all([
    signToken("access", { user_id: match.user.id }, c.env),
    signToken(
      "refresh",
      { user_id: match.user.id, jti, family_id: jti },
      c.env,
    ),
  ]);

  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await db.insert(refreshTokens).values({
    id: jti,
    jti,
    userId: match.user.id,
    familyId: jti,
    isRevoked: 0,
    expiresAt,
    createdAt: now,
  });

  setSessionCookies(c, { access, refresh });

  return c.json({
    access,
    refresh,
    user: formatUser({ ...match.user, ...match.profile }),
  });
});

// GET /auth/passkeys/
authRoutes.get("/passkeys", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      aaguid: passkeys.aaguid,
      created_at: passkeys.createdAt,
      last_used_at: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .orderBy(desc(passkeys.createdAt));

  return c.json(rows);
});

// PATCH /auth/passkeys/:id
authRoutes.patch("/passkeys/:id", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const body = await readJson(c.req);
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 100) : undefined;

  const db = createDb(c.env.DB);
  const existing = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    drfError(404, "Not found.");
  }

  const [updated] = await db
    .update(passkeys)
    .set({ ...(name !== undefined ? { name } : {}) })
    .where(eq(passkeys.id, id))
    .returning();

  return c.json({
    id: updated.id,
    name: updated.name,
    aaguid: updated.aaguid,
    created_at: updated.createdAt,
    last_used_at: updated.lastUsedAt,
  });
});

// DELETE /auth/passkeys/:id
authRoutes.delete("/passkeys/:id", authMiddleware(), async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));

  const db = createDb(c.env.DB);
  const existing = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    drfError(404, "Not found.");
  }

  await db.delete(passkeys).where(eq(passkeys.id, id)).run();

  // If this was the last passkey, re-enable password login if it was disabled
  const remaining = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, user.id));
  if (remaining.length === 0) {
    await db
      .update(profiles)
      .set({ passwordLoginDisabled: 0 })
      .where(eq(profiles.userId, user.id))
      .run();
  }

  return new Response(null, { status: 204 });
});
