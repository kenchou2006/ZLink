import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll, createUser } from "./helpers";

describe("ApiKey API (recreating Django ApiKeyTests)", () => {
  beforeEach(async () => {
    await clearAll();
  });

  async function createKey(
    staffToken: string,
    extra: Record<string, unknown> = {},
  ) {
    return call("/api/api-keys/", {
      method: "POST",
      token: staffToken,
      body: { name: "k", ...extra },
    });
  }

  it("test_create_returns_plaintext_once", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await createKey(staff.token);
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.key).toBeDefined();
    expect(data.key.startsWith("zlk_")).toBe(true);
    expect(data.prefix).toBe(data.key.slice(0, 12));
  });

  it("test_key_can_manage_links", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const keyRes = await createKey(staff.token);
    const keyData = (await keyRes.json()) as any;
    const rawKey = keyData.key;

    const res = await call("/api/links/", {
      method: "POST",
      apiKey: rawKey,
      body: { original_url: "https://example.com" },
    });
    expect(res.status).toBe(201);
  });

  it("test_key_cannot_manage_users_or_keys", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const keyRes = await createKey(staff.token);
    const rawKey = ((await keyRes.json()) as any).key;

    const uRes = await call("/api/users/", { apiKey: rawKey });
    expect(uRes.status).toBe(401);

    const kRes = await call("/api/api-keys/", { apiKey: rawKey });
    expect(kRes.status).toBe(401);
  });

  it("test_invalid_key_rejected", async () => {
    const res = await call("/api/links/", { apiKey: "zlk_invalid" });
    expect(res.status).toBe(401);
  });

  it("test_expired_key_rejected", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const keyRes = await createKey(staff.token, { expires_at: past });
    const rawKey = ((await keyRes.json()) as any).key;

    const res = await call("/api/links/", { apiKey: rawKey });
    expect(res.status).toBe(401);
  });

  it("test_revoked_key_rejected", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const keyRes = await createKey(staff.token);
    const keyData = (await keyRes.json()) as any;
    const rawKey = keyData.key;
    const kid = keyData.id;

    // Revoke key
    const patchRes = await call(`/api/api-keys/${kid}/`, {
      method: "PATCH",
      token: staff.token,
      body: { is_active: false },
    });
    expect(patchRes.status).toBe(200);

    const res = await call("/api/links/", { apiKey: rawKey });
    expect(res.status).toBe(401);
  });

  it("test_apikeys_expired_and_purge", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    await createKey(staff.token, { name: "live" });
    await createKey(staff.token, { name: "exp", expires_at: past });

    const listed = await call("/api/api-keys/expired/", { token: staff.token });
    expect(listed.status).toBe(200);
    const data = (await listed.json()) as any[];
    expect(data.map((k) => k.name)).toEqual(["exp"]);

    const purged = await call("/api/api-keys/purge-expired/", {
      method: "POST",
      token: staff.token,
    });
    expect(purged.status).toBe(200);
    const purgedData = (await purged.json()) as any;
    expect(purgedData.deleted).toBe(1);

    const remaining = await env.DB.prepare("SELECT name FROM api_keys").all<{
      name: string;
    }>();
    expect(remaining.results.map((k) => k.name)).toEqual(["live"]);
  });
});
