import { Hono } from "hono";
import { eq, ne, and } from "drizzle-orm";
import type { AppEnv } from "../env";
import { createDb, users, profiles, passkeys } from "../db";
import { authMiddleware } from "../middleware/auth";
import { verifyPassword, hashPassword } from "../lib/crypto";
import { drfError, readJson } from "../lib/http";

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.use("*", authMiddleware());

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

// GET /profile/
profileRoutes.get("/", async (c) => {
  const caller = c.get("user")!;
  return c.json(formatUser(caller));
});

// PATCH /profile/
profileRoutes.patch("/", async (c) => {
  const caller = c.get("user")!;
  const body = await readJson(c.req);
  const db = createDb(c.env.DB);

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, caller.id))
    .limit(1);
  const currentUser = userRows[0];
  if (!currentUser) {
    drfError(404, "Not found.");
  }

  const profileRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, caller.id))
    .limit(1);
  let currentProfile = profileRows[0];
  if (!currentProfile) {
    const [created] = await db
      .insert(profiles)
      .values({ userId: caller.id, avatarUrl: null, passwordLoginDisabled: 0 })
      .returning();
    currentProfile = created;
  }

  const userUpdates: Partial<typeof users.$inferInsert> = {};
  const profileUpdates: Partial<typeof profiles.$inferInsert> = {};

  if (body.username !== undefined) {
    const username = String(body.username).trim();
    if (username && username !== currentUser.username) {
      const dup = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, username), ne(users.id, caller.id)))
        .limit(1);
      if (dup[0]) {
        drfError(400, "Username already exists.", {
          username: ["Username already exists."],
        });
      }
      userUpdates.username = username;
    }
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email && email !== currentUser.email) {
      const dup = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, caller.id)))
        .limit(1);
      if (dup[0]) {
        drfError(400, "Email already exists.", {
          email: ["Email already exists."],
        });
      }
      userUpdates.email = email;
    }
  }

  if (body.avatar_url !== undefined) {
    profileUpdates.avatarUrl = body.avatar_url
      ? String(body.avatar_url).trim()
      : null;
  }

  if (body.password_login_disabled !== undefined) {
    const disabled = Boolean(body.password_login_disabled);
    if (disabled) {
      const userPasskeys = await db
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(eq(passkeys.userId, caller.id));
      if (userPasskeys.length === 0) {
        drfError(400, "Add a passkey before disabling password login.", {
          password_login_disabled: [
            "Add a passkey before disabling password login.",
          ],
        });
      }
    }
    profileUpdates.passwordLoginDisabled = disabled ? 1 : 0;
  }

  let passwordChanged = false;
  const newPwd =
    body.new_password !== undefined ? String(body.new_password) : "";
  const confirmPwd =
    body.confirm_password !== undefined ? String(body.confirm_password) : "";
  const currentPwd =
    body.current_password !== undefined ? String(body.current_password) : "";

  if (newPwd || confirmPwd) {
    if (newPwd !== confirmPwd) {
      drfError(400, "New passwords do not match.", {
        confirm_password: ["New passwords do not match."],
      });
    }
    if (!currentPwd) {
      drfError(400, "Current password is required to change password.", {
        current_password: ["Current password is required to change password."],
      });
    }
    const matches = await verifyPassword(currentPwd, currentUser.passwordHash);
    if (!matches) {
      drfError(400, "Current password is incorrect.", {
        current_password: ["Current password is incorrect."],
      });
    }
    userUpdates.passwordHash = await hashPassword(newPwd);
    passwordChanged = true;
  }

  let updatedUser = currentUser;
  if (Object.keys(userUpdates).length > 0) {
    const [u] = await db
      .update(users)
      .set(userUpdates)
      .where(eq(users.id, caller.id))
      .returning();
    updatedUser = u;
  }

  let updatedProfile = currentProfile;
  if (Object.keys(profileUpdates).length > 0) {
    const [p] = await db
      .update(profiles)
      .set(profileUpdates)
      .where(eq(profiles.userId, caller.id))
      .returning();
    updatedProfile = p;
  }

  return c.json({
    user: formatUser({ ...updatedUser, ...updatedProfile }),
    password_changed: passwordChanged,
  });
});
