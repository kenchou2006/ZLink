import { Hono } from "hono";
import {
  eq,
  desc,
  asc,
  like,
  or,
  and,
  lte,
  isNotNull,
  inArray,
} from "drizzle-orm";
import type { AppEnv } from "../env";
import { createDb, links, type Link } from "../db";
import { authOrApiKey } from "../middleware/auth";
import { drfError, readJson } from "../lib/http";
import {
  normalizeShortCode,
  validateShortCodeFormat,
  isValidHttpUrl,
  getCacheKeyVariants,
} from "../lib/utils";
import { resolveAppUrls } from "../lib/urls";
import { generateShortCode } from "../lib/crypto";
import { getBuildMeta } from "../lib/meta";

export const linkRoutes = new Hono<AppEnv>();

linkRoutes.use("*", authOrApiKey());

function getShortUrl(
  env: AppEnv["Bindings"],
  reqUrl: string,
  code: string,
): string {
  const urls = resolveAppUrls(env, reqUrl);
  return `${urls.shortLinkUrl}/${code}`;
}

function formatLink(env: AppEnv["Bindings"], reqUrl: string, link: Link) {
  const now = Date.now();
  const isExpired = Boolean(
    link.expiresAt && new Date(link.expiresAt).getTime() <= now,
  );
  return {
    id: link.id,
    original_url: link.originalUrl,
    short_code: link.shortCode,
    short_url: getShortUrl(env, reqUrl, link.shortCode),
    expires_at: link.expiresAt,
    is_expired: isExpired,
    created_at: link.createdAt,
  };
}

async function invalidateKv(kv: KVNamespace, code: string): Promise<void> {
  if (!kv || typeof kv.delete !== "function") return;
  const variants = getCacheKeyVariants(code);
  await Promise.all(variants.map((k) => kv.delete(k).catch(() => {})));
}

// GET /links/expired/
linkRoutes.get("/expired", async (c) => {
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const rows = await db
    .select()
    .from(links)
    .where(and(isNotNull(links.expiresAt), lte(links.expiresAt, now)))
    .orderBy(desc(links.createdAt));

  return c.json(rows.map((r) => formatLink(c.env, c.req.url, r)));
});

// POST /links/purge-expired/
linkRoutes.post("/purge-expired", async (c) => {
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const expired = await db
    .select()
    .from(links)
    .where(and(isNotNull(links.expiresAt), lte(links.expiresAt, now)));

  for (const item of expired) {
    await invalidateKv(c.env.KV, item.shortCode);
  }

  if (expired.length > 0) {
    const ids = expired.map((e) => e.id);
    await db.delete(links).where(inArray(links.id, ids)).run();
  }

  return c.json({ deleted: expired.length });
});

// POST /links/bulk-delete/
linkRoutes.post("/bulk-delete", async (c) => {
  const body = await readJson(c.req);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    drfError(400, "ids must be a non-empty list.");
  }

  const numericIds = ids
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (numericIds.length === 0) {
    drfError(400, "ids must be a non-empty list.");
  }

  const db = createDb(c.env.DB);
  const toDelete = await db
    .select()
    .from(links)
    .where(inArray(links.id, numericIds));

  for (const item of toDelete) {
    await invalidateKv(c.env.KV, item.shortCode);
  }

  if (toDelete.length > 0) {
    await db
      .delete(links)
      .where(
        inArray(
          links.id,
          toDelete.map((i) => i.id),
        ),
      )
      .run();
  }

  return c.json({ deleted: toDelete.length });
});

// GET /links/
linkRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const search = c.req.query("search")?.trim();
  const ordering = c.req.query("ordering")?.trim() || "-created_at";

  let query = db.select().from(links).$dynamic();

  if (search) {
    const pattern = `%${search}%`;
    query = query.where(
      or(like(links.originalUrl, pattern), like(links.shortCode, pattern)),
    );
  }

  switch (ordering) {
    case "created_at":
      query = query.orderBy(asc(links.createdAt));
      break;
    case "short_code":
      query = query.orderBy(asc(links.shortCode));
      break;
    case "-short_code":
      query = query.orderBy(desc(links.shortCode));
      break;
    case "id":
      query = query.orderBy(asc(links.id));
      break;
    case "-id":
      query = query.orderBy(desc(links.id));
      break;
    case "-created_at":
    default:
      query = query.orderBy(desc(links.createdAt));
      break;
  }

  const rows = await query;
  return c.json(rows.map((r) => formatLink(c.env, c.req.url, r)));
});

// POST /links/
linkRoutes.post("/", async (c) => {
  const body = await readJson(c.req);
  const originalUrl = String(body.original_url || "").trim();
  const rawAlias =
    typeof body.short_code === "string" ? body.short_code.trim() : "";
  const expiresAt = body.expires_at
    ? new Date(String(body.expires_at)).toISOString()
    : null;

  if (!originalUrl) {
    drfError(400, "original_url is required.", {
      original_url: ["This field is required."],
    });
  }

  if (!isValidHttpUrl(originalUrl)) {
    drfError(400, "Enter a valid URL.", {
      original_url: ["Enter a valid URL."],
    });
  }

  const db = createDb(c.env.DB);
  let shortCode = "";

  if (rawAlias) {
    const urls = resolveAppUrls(c.env);
    const meta =
      urls.adminBase === "" ? await getBuildMeta(c.env, c.req.url) : null;
    const err = validateShortCodeFormat(
      rawAlias,
      c.env,
      meta?.rootReservedNames,
    );
    if (err) {
      drfError(400, err, { short_code: [err] });
    }

    shortCode = normalizeShortCode(rawAlias);
    const existing = await db
      .select({ id: links.id })
      .from(links)
      .where(eq(links.shortCode, shortCode))
      .limit(1);

    if (existing[0]) {
      const msg = `Alias '${shortCode}' is already taken.`;
      drfError(400, msg, { short_code: [msg] });
    }
  } else {
    // Generate unique short code
    for (let i = 0; i < 10; i++) {
      const candidate = generateShortCode();
      const existing = await db
        .select({ id: links.id })
        .from(links)
        .where(eq(links.shortCode, candidate))
        .limit(1);
      if (!existing[0]) {
        shortCode = candidate;
        break;
      }
    }
    if (!shortCode) {
      shortCode = `${generateShortCode()}${Math.floor(Math.random() * 90 + 10)}`;
    }
  }

  const now = new Date().toISOString();
  const [created] = await db
    .insert(links)
    .values({
      originalUrl,
      shortCode,
      createdAt: now,
      expiresAt,
    })
    .returning();

  await invalidateKv(c.env.KV, shortCode);

  return c.json(formatLink(c.env, c.req.url, created), 201);
});

// GET /links/:id/
linkRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env.DB);
  const rows = await db.select().from(links).where(eq(links.id, id)).limit(1);
  if (!rows[0]) {
    drfError(404, "Not found.");
  }
  return c.json(formatLink(c.env, c.req.url, rows[0]));
});

// PUT / PATCH /links/:id/
const handleUpdate = async (c: any) => {
  const id = Number(c.req.param("id"));
  const body = await readJson(c.req);
  const db = createDb(c.env.DB);

  const existingRows = await db
    .select()
    .from(links)
    .where(eq(links.id, id))
    .limit(1);
  const current = existingRows[0];
  if (!current) {
    drfError(404, "Not found.");
  }

  const updates: Partial<typeof links.$inferInsert> = {};

  if (body.original_url !== undefined) {
    const originalUrl = String(body.original_url).trim();
    if (!originalUrl || !isValidHttpUrl(originalUrl)) {
      drfError(400, "Enter a valid URL.", {
        original_url: ["Enter a valid URL."],
      });
    }
    updates.originalUrl = originalUrl;
  }

  if (body.expires_at !== undefined) {
    updates.expiresAt = body.expires_at
      ? new Date(String(body.expires_at)).toISOString()
      : null;
  }

  let oldCode = current.shortCode;
  let newCode = oldCode;

  if (body.short_code !== undefined) {
    const rawAlias = String(body.short_code).trim();
    if (rawAlias && rawAlias !== current.shortCode) {
      const urls = resolveAppUrls(c.env);
      const meta =
        urls.adminBase === "" ? await getBuildMeta(c.env, c.req.url) : null;
      const err = validateShortCodeFormat(
        rawAlias,
        c.env,
        meta?.rootReservedNames,
      );
      if (err) {
        drfError(400, err, { short_code: [err] });
      }

      newCode = normalizeShortCode(rawAlias);
      const duplicate = await db
        .select({ id: links.id })
        .from(links)
        .where(eq(links.shortCode, newCode))
        .limit(1);

      if (duplicate[0] && duplicate[0].id !== id) {
        const msg = `Alias '${newCode}' is already taken.`;
        drfError(400, msg, { short_code: [msg] });
      }
      updates.shortCode = newCode;
    }
  }

  const [updated] = await db
    .update(links)
    .set(updates)
    .where(eq(links.id, id))
    .returning();

  await invalidateKv(c.env.KV, oldCode);
  if (newCode !== oldCode) {
    await invalidateKv(c.env.KV, newCode);
  }

  return c.json(formatLink(c.env, c.req.url, updated));
};

linkRoutes.put("/:id", handleUpdate);
linkRoutes.patch("/:id", handleUpdate);

// DELETE /links/:id/
linkRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = createDb(c.env.DB);
  const rows = await db.select().from(links).where(eq(links.id, id)).limit(1);
  if (!rows[0]) {
    drfError(404, "Not found.");
  }

  await invalidateKv(c.env.KV, rows[0].shortCode);
  await db.delete(links).where(eq(links.id, id)).run();

  return new Response(null, { status: 204 });
});
