import { Hono } from "hono";
import { eq, desc, and, lte, isNotNull, inArray } from "drizzle-orm";
import type { AppEnv } from "../env";
import { createDb, apiKeys, type ApiKey } from "../db";
import { authMiddleware, requireStaff } from "../middleware/auth";
import { generateApiKey } from "../lib/crypto";
import { drfError, readJson } from "../lib/http";

export const apiKeyRoutes = new Hono<AppEnv>();

apiKeyRoutes.use("*", authMiddleware(), requireStaff());

function formatApiKey(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    expires_at: k.expiresAt,
    last_used_at: k.lastUsedAt,
    is_active: Boolean(k.isActive),
    created_at: k.createdAt,
  };
}

// GET /api-keys/expired/
apiKeyRoutes.get("/expired", async (c) => {
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(isNotNull(apiKeys.expiresAt), lte(apiKeys.expiresAt, now)))
    .orderBy(desc(apiKeys.createdAt));

  return c.json(rows.map(formatApiKey));
});

// POST /api-keys/purge-expired/
apiKeyRoutes.post("/purge-expired", async (c) => {
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const expired = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(isNotNull(apiKeys.expiresAt), lte(apiKeys.expiresAt, now)));

  if (expired.length > 0) {
    await db
      .delete(apiKeys)
      .where(
        inArray(
          apiKeys.id,
          expired.map((e) => e.id),
        ),
      )
      .run();
  }

  return c.json({ deleted: expired.length });
});

// GET /api-keys/
apiKeyRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  return c.json(rows.map(formatApiKey));
});

// POST /api-keys/
apiKeyRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const body = await readJson(c.req);
  const name = String(body.name || "").trim();
  const expiresAt = body.expires_at
    ? new Date(String(body.expires_at)).toISOString()
    : null;

  if (!name) {
    drfError(400, "name is required.", { name: ["This field is required."] });
  }

  const { raw, prefix, keyHash } = await generateApiKey();
  const now = new Date().toISOString();
  const db = createDb(c.env.DB);

  const [created] = await db
    .insert(apiKeys)
    .values({
      name,
      prefix,
      keyHash,
      createdById: user.id,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      isActive: 1,
    })
    .returning();

  return c.json(
    {
      ...formatApiKey(created),
      key: raw,
    },
    201,
  );
});

// PATCH /api-keys/:id/
apiKeyRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await readJson(c.req);
  const db = createDb(c.env.DB);

  const existing = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);
  if (!existing[0]) {
    drfError(404, "Not found.");
  }

  const updates: Partial<typeof apiKeys.$inferInsert> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.expires_at !== undefined)
    updates.expiresAt = body.expires_at
      ? new Date(String(body.expires_at)).toISOString()
      : null;
  if (body.is_active !== undefined) updates.isActive = body.is_active ? 1 : 0;

  const [updated] = await db
    .update(apiKeys)
    .set(updates)
    .where(eq(apiKeys.id, id))
    .returning();
  return c.json(formatApiKey(updated));
});

// DELETE /api-keys/:id/
apiKeyRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env.DB);
  const existing = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);
  if (!existing[0]) {
    drfError(404, "Not found.");
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
  return new Response(null, { status: 204 });
});
