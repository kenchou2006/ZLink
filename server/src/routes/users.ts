import { Hono } from "hono";
import { eq, desc, ne, and } from "drizzle-orm";
import type { AppEnv, AuthUser } from "../env";
import { createDb, users, profiles } from "../db";
import {
  authMiddleware,
  requireStaff,
  requireSuperUser,
} from "../middleware/auth";
import { hashPassword } from "../lib/crypto";
import { drfError, readJson } from "../lib/http";

export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", authMiddleware());

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

// GET /users/stats/ (Superuser only)
userRoutes.get("/stats", requireSuperUser(), async (c) => {
  const db = createDb(c.env.DB);
  const all = await db.select().from(users);
  return c.json({
    total: all.length,
    active: all.filter((u) => u.isActive).length,
    superusers: all.filter((u) => u.isSuperUser).length,
  });
});

// GET /users/ (Superuser only)
userRoutes.get("/", requireSuperUser(), async (c) => {
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
    .orderBy(desc(users.dateJoined));

  return c.json(rows.map(formatUser));
});

// POST /users/ (Superuser only)
userRoutes.post("/", requireSuperUser(), async (c) => {
  const body = await readJson(c.req);
  const username = String(body.username || "").trim();
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const confirmPassword = String(body.confirm_password || "");

  if (!username) {
    drfError(400, "Username already exists.", {
      username: ["This field is required."],
    });
  }

  if (password !== confirmPassword) {
    drfError(400, "Passwords do not match.", {
      confirm_password: ["Passwords do not match."],
    });
  }

  const db = createDb(c.env.DB);

  const existingUsername = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existingUsername[0]) {
    drfError(400, "Username already exists.", {
      username: ["Username already exists."],
    });
  }

  if (email) {
    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingEmail[0]) {
      drfError(400, "Email already exists.", {
        email: ["Email already exists."],
      });
    }
  }

  const pwdHash = await hashPassword(password);
  const now = new Date().toISOString();

  const [newUser] = await db
    .insert(users)
    .values({
      username,
      email,
      passwordHash: pwdHash,
      isStaff: 1, // created user is staff
      isSuperUser: 0,
      isActive: 1,
      dateJoined: now,
      lastLogin: null,
    })
    .returning();

  await db.insert(profiles).values({
    userId: newUser.id,
    avatarUrl: null,
    passwordLoginDisabled: 0,
  });

  return c.json(formatUser(newUser), 201);
});

function assertCanManage(
  caller: AuthUser,
  target: { isStaff: number | boolean; isSuperUser: number | boolean },
) {
  if ((target.isStaff || target.isSuperUser) && !caller.isSuperUser) {
    drfError(403, "Only superusers can manage staff or superuser accounts.");
  }
}

// GET /users/:id/
userRoutes.get("/:id", requireStaff(), async (c) => {
  const id = Number(c.req.param("id"));
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
    .where(eq(users.id, id))
    .limit(1);

  if (!rows[0]) {
    drfError(404, "Not found.");
  }

  return c.json(formatUser(rows[0]));
});

// POST /users/:id/toggle-active/ (Superuser only)
userRoutes.post("/:id/toggle-active", requireSuperUser(), async (c) => {
  const caller = c.get("user")!;
  const id = Number(c.req.param("id"));

  if (caller.id === id) {
    drfError(403, "You cannot deactivate yourself.");
  }

  const db = createDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const target = rows[0];
  if (!target) {
    drfError(404, "Not found.");
  }

  if (target.isSuperUser) {
    drfError(403, "Superusers cannot be deactivated.");
  }

  const newActive = target.isActive ? 0 : 1;
  const [updated] = await db
    .update(users)
    .set({ isActive: newActive })
    .where(eq(users.id, id))
    .returning();

  const profileRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, id))
    .limit(1);
  return c.json(
    formatUser({
      ...updated,
      avatarUrl: profileRows[0]?.avatarUrl,
      passwordLoginDisabled: profileRows[0]?.passwordLoginDisabled,
    }),
  );
});

// PUT / PATCH /users/:id/
const handleUserUpdate = async (c: any) => {
  const caller = c.get("user")!;
  const id = Number(c.req.param("id"));
  const body = await readJson(c.req);
  const db = createDb(c.env.DB);

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const target = rows[0];
  if (!target) {
    drfError(404, "Not found.");
  }

  assertCanManage(caller, target);

  if ("is_superuser" in body) {
    if (!caller.isSuperUser || target.id === caller.id) {
      drfError(403, "You cannot change superuser privileges here.");
    }
  }

  const updates: Partial<typeof users.$inferInsert> = {};

  if (body.username !== undefined) {
    const username = String(body.username).trim();
    if (!username) {
      drfError(400, "Username already exists.", {
        username: ["This field is required."],
      });
    }
    const dup = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), ne(users.id, id)))
      .limit(1);
    if (dup[0]) {
      drfError(400, "Username already exists.", {
        username: ["Username already exists."],
      });
    }
    updates.username = username;
  }

  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email) {
      const dup = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, id)))
        .limit(1);
      if (dup[0]) {
        drfError(400, "Email already exists.", {
          email: ["Email already exists."],
        });
      }
    }
    updates.email = email;
  }

  if (
    body.is_superuser !== undefined &&
    caller.isSuperUser &&
    target.id !== caller.id
  ) {
    updates.isSuperUser = body.is_superuser ? 1 : 0;
  }

  if (body.password || body.confirm_password) {
    if (body.password !== body.confirm_password) {
      drfError(400, "Passwords do not match.", {
        confirm_password: ["Passwords do not match."],
      });
    }
    updates.passwordHash = await hashPassword(String(body.password));
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();
  const profileRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, id))
    .limit(1);

  return c.json(
    formatUser({
      ...updated,
      avatarUrl: profileRows[0]?.avatarUrl,
      passwordLoginDisabled: profileRows[0]?.passwordLoginDisabled,
    }),
  );
};

userRoutes.put("/:id", requireStaff(), handleUserUpdate);
userRoutes.patch("/:id", requireStaff(), handleUserUpdate);

// DELETE /users/:id/
userRoutes.delete("/:id", requireStaff(), async (c) => {
  const caller = c.get("user")!;
  const id = Number(c.req.param("id"));

  if (caller.id === id) {
    drfError(403, "You cannot delete yourself.");
  }

  const db = createDb(c.env.DB);
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const target = rows[0];
  if (!target) {
    drfError(404, "Not found.");
  }

  assertCanManage(caller, target);

  await db.delete(users).where(eq(users.id, id)).run();
  return new Response(null, { status: 204 });
});
