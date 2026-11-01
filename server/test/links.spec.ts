import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll, createUser } from "./helpers";

describe("Link API (recreating Django LinkApiTests + ExpiredReviewEndpointTests)", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("test_anonymous_denied", async () => {
    const res = await call("/api/links/");
    expect(res.status).toBe(401);
  });

  it("test_non_staff_forbidden", async () => {
    const plain = await createUser({ username: "plain", isStaff: false });
    const res = await call("/api/links/", { token: plain.token });
    expect(res.status).toBe(403);
  });

  it("test_create_with_alias", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://example.com", short_code: "promo" },
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.short_code).toBe("promo");
    expect(data.original_url).toBe("https://example.com");
  });

  it("test_create_autogenerates_code", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://example.com" },
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.short_code).toBeDefined();
    expect(data.short_code.length).toBeGreaterThanOrEqual(6);
  });

  it("test_reserved_alias_rejected", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://x.com", short_code: "admin" },
    });

    expect(res.status).toBe(400);
  });

  it("test_duplicate_alias_rejected", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://x.com", short_code: "dup" },
    });

    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://y.com", short_code: "dup" },
    });

    expect(res.status).toBe(400);
  });

  it("test_invalid_url_rejected", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "not-a-url" },
    });

    expect(res.status).toBe(400);
  });

  it("test_update_and_delete", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const createRes = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://old.com", short_code: "edit" },
    });
    const link = (await createRes.json()) as any;

    const upd = await call(`/api/links/${link.id}/`, {
      method: "PATCH",
      token: staff.token,
      body: { original_url: "https://new.com" },
    });
    expect(upd.status).toBe(200);
    const updData = (await upd.json()) as any;
    expect(updData.original_url).toBe("https://new.com");

    const del = await call(`/api/links/${link.id}/`, {
      method: "DELETE",
      token: staff.token,
    });
    expect(del.status).toBe(204);

    const check = await env.DB.prepare("SELECT id FROM links WHERE id = ?")
      .bind(link.id)
      .first();
    expect(check).toBeNull();
  });

  it("test_create_with_expiry", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const expires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: {
        original_url: "https://example.com",
        short_code: "temp",
        expires_at: expires,
      },
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.expires_at).toBeDefined();
    expect(data.is_expired).toBe(false);
  });

  it("test_create_without_expiry_is_unlimited", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/", {
      method: "POST",
      token: staff.token,
      body: { original_url: "https://example.com" },
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.expires_at).toBeNull();
  });

  it("test_is_expired_flag", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const past = new Date(Date.now() - 3600 * 1000).toISOString();

    const ins = await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://x.com', 'gone', ?, ?) RETURNING id`,
    )
      .bind(new Date().toISOString(), past)
      .first<{ id: number }>();

    const res = await call(`/api/links/${ins!.id}/`, { token: staff.token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.is_expired).toBe(true);
  });

  it("test_links_expired_lists_only_expired", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://a.com', 'keep', ?, NULL)`,
    )
      .bind(now)
      .run();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://c.com', 'past', ?, ?)`,
    )
      .bind(now, past)
      .run();

    const res = await call("/api/links/expired/", { token: staff.token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any[];
    expect(data.map((l) => l.short_code)).toEqual(["past"]);
  });

  it("test_links_purge_expired", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://a.com', 'keep', ?, NULL)`,
    )
      .bind(now)
      .run();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://c.com', 'past', ?, ?)`,
    )
      .bind(now, past)
      .run();

    const res = await call("/api/links/purge-expired/", {
      method: "POST",
      token: staff.token,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.deleted).toBe(1);

    const remaining = await env.DB.prepare("SELECT short_code FROM links").all<{
      short_code: string;
    }>();
    expect(remaining.results.map((r) => r.short_code)).toEqual(["keep"]);
  });

  it("test_links_bulk_delete", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const now = new Date().toISOString();

    const r1 = await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://1.com', 'b1', ?) RETURNING id`,
    )
      .bind(now)
      .first<{ id: number }>();
    const r2 = await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://2.com', 'b2', ?) RETURNING id`,
    )
      .bind(now)
      .first<{ id: number }>();

    const res = await call("/api/links/bulk-delete/", {
      method: "POST",
      token: staff.token,
      body: { ids: [r1!.id, r2!.id] },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.deleted).toBe(2);

    const remaining = await env.DB.prepare(
      "SELECT id FROM links WHERE id IN (?, ?)",
    )
      .bind(r1!.id, r2!.id)
      .all();
    expect(remaining.results.length).toBe(0);
  });

  it("test_links_bulk_delete_requires_ids", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });
    const res = await call("/api/links/bulk-delete/", {
      method: "POST",
      token: staff.token,
      body: { ids: [] },
    });
    expect(res.status).toBe(400);
  });
});
