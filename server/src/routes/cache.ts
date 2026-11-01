import { Hono } from "hono";
import type { AppEnv } from "../env";
import { authMiddleware, requireSuperUser } from "../middleware/auth";
import { drfError, readJson } from "../lib/http";

export const cacheRoutes = new Hono<AppEnv>();

cacheRoutes.use("*", authMiddleware(), requireSuperUser());

const CLEAR_LIMIT = 900;

/** All keys in the namespace; `list()` returns at most 1000 per page. */
async function listAllKeys(kv: KVNamespace): Promise<KVNamespaceListKey<unknown>[]> {
  const keys: KVNamespaceListKey<unknown>[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

// GET /cache/keys/
cacheRoutes.get("/keys", async (c) => {
  const kv = c.env.KV;
  if (!kv || typeof kv.list !== "function") {
    return c.json({ keys: [], error: "KV is unavailable." }, 503);
  }

  try {
    const allKeys = await listAllKeys(kv);
    const nowSec = Math.floor(Date.now() / 1000);
    const keys_data = allKeys.map((k) => {
      const display = k.name.includes("url:")
        ? k.name.split("url:").pop()!
        : k.name;
      const ttl = k.expiration ? Math.max(0, k.expiration - nowSec) : -1;
      return {
        key: k.name,
        display_key: display,
        ttl,
        type: "string",
      };
    });

    return c.json({ keys: keys_data, error: null });
  } catch (e) {
    return c.json({ keys: [], error: String(e) }, 503);
  }
});

// DELETE /cache/keys/
cacheRoutes.delete("/keys", async (c) => {
  const body = await readJson(c.req);
  const key = typeof body.key === "string" ? body.key.trim() : "";

  if (!key) {
    drfError(400, "key is required.");
  }

  const kv = c.env.KV;
  if (!kv || typeof kv.delete !== "function") {
    return c.json({ detail: "KV is unavailable." }, 503);
  }

  try {
    await kv.delete(key);
    return c.json({ deleted: true, key });
  } catch (e) {
    return c.json({ detail: String(e) }, 503);
  }
});

// POST /cache/clear/
cacheRoutes.post("/clear", async (c) => {
  const kv = c.env.KV;
  if (!kv || typeof kv.list !== "function") {
    return c.json({ detail: "KV is unavailable." }, 503);
  }

  try {
    // Stay under the per-invocation KV operation limit (1000); callers repeat while has_more.
    const allKeys = await listAllKeys(kv);
    const batch = allKeys.slice(0, CLEAR_LIMIT);
    for (let i = 0; i < batch.length; i += 50) {
      await Promise.all(batch.slice(i, i + 50).map((k) => kv.delete(k.name)));
    }
    return c.json({ cleared: batch.length, has_more: allKeys.length > batch.length });
  } catch (e) {
    return c.json({ detail: String(e) }, 503);
  }
});
