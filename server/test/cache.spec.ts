import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll, createUser } from "./helpers";

describe("Cache API (recreating Django CacheKeysView & CacheClearView)", () => {
  beforeEach(async () => {
    await clearAll();
    if (env.KV && typeof env.KV.list === "function") {
      const list = await env.KV.list();
      for (const k of list.keys) {
        await env.KV.delete(k.name);
      }
    }
  });

  it("test_cache_keys_lists_and_deletes", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });

    // Seed KV
    await env.KV.put(
      "shortener:url:test1",
      JSON.stringify({ url: "https://1.com" }),
    );
    await env.KV.put(
      "shortener:url:test2",
      JSON.stringify({ url: "https://2.com" }),
    );

    const listRes = await call("/api/cache/keys/", { token: root.token });
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.keys.length).toBe(2);

    // Delete one
    const delRes = await call("/api/cache/keys/", {
      method: "DELETE",
      token: root.token,
      body: { key: "shortener:url:test1" },
    });
    expect(delRes.status).toBe(200);
    const delData = (await delRes.json()) as any;
    expect(delData.deleted).toBe(true);

    const remaining = await env.KV.get("shortener:url:test1");
    expect(remaining).toBeNull();
  });

  it("test_cache_clear_clears_all_keys", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });

    await env.KV.put(
      "shortener:url:test1",
      JSON.stringify({ url: "https://1.com" }),
    );
    await env.KV.put(
      "shortener:url:test2",
      JSON.stringify({ url: "https://2.com" }),
    );

    const clearRes = await call("/api/cache/clear/", {
      method: "POST",
      token: root.token,
    });
    expect(clearRes.status).toBe(200);
    const clearData = (await clearRes.json()) as any;
    expect(clearData.cleared).toBe(2);

    const check1 = await env.KV.get("shortener:url:test1");
    const check2 = await env.KV.get("shortener:url:test2");
    expect(check1).toBeNull();
    expect(check2).toBeNull();
  });

  it("test_non_superuser_forbidden_from_cache", async () => {
    const staff = await createUser({
      username: "staff",
      isStaff: true,
      isSuperUser: false,
    });
    const res = await call("/api/cache/keys/", { token: staff.token });
    expect(res.status).toBe(403);
  });
});
