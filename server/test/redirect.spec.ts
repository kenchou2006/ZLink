import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll } from "./helpers";

describe("Redirect Hot Path (GET /{code} and GET /)", () => {
  beforeEach(async () => {
    await clearAll();
    if (env.KV && typeof env.KV.list === "function") {
      const list = await env.KV.list();
      for (const k of list.keys) {
        await env.KV.delete(k.name);
      }
    }
  });

  it("test_redirect_root_to_at_root", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://root.example.com', '@root', ?)`,
    )
      .bind(now)
      .run();

    const res = await call("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://root.example.com");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // Check that KV was backfilled
    const cached = await env.KV.get(":0:shortener:url:@root");
    expect(cached).toBeDefined();
    expect(JSON.parse(cached!).url).toBe("https://root.example.com");
  });

  it("test_redirect_code_302", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://dest.example.com/page', 'mycode', ?)`,
    )
      .bind(now)
      .run();

    const res = await call("/mycode");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://dest.example.com/page");
  });

  it("test_redirect_kv_cache_hit", async () => {
    // Put directly in KV without D1 row
    await env.KV.put(
      ":0:shortener:url:fast",
      JSON.stringify({
        url: "https://fast.example.com",
        id: 99,
        cached_at: 100,
      }),
    );

    const res = await call("/fast");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://fast.example.com");
  });

  it("test_redirect_expired_link_returns_404", async () => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://expired.com', 'oldlink', ?, ?)`,
    )
      .bind(now, past)
      .run();

    const res = await call("/oldlink");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("Page Not Found");
  });

  it("test_redirect_reserved_word_returns_404", async () => {
    const res = await call("/login");
    expect(res.status).toBe(404);
  });

  it("test_redirect_rejects_non_http_https_urls", async () => {
    const now = new Date().toISOString();
    // Suppose an invalid link was in DB
    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at) VALUES ('javascript:alert(1)', 'xss', ?)`,
    )
      .bind(now)
      .run();

    const res = await call("/xss");
    expect(res.status).toBe(404);
  });

  it("test_nonexistent_returns_404_html", async () => {
    const res = await call("/not-a-real-code-xyz");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("test_404_page_has_strict_csp_and_no_external_scripts", async () => {
    const res = await call("/not-a-real-code-xyz");
    expect(res.status).toBe(404);
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    // Must NOT contain tailwind runtime CDN or external script tags
    expect(html).not.toContain("https://cdn.tailwindcss.com");
    expect(html).not.toContain("<script");
    expect(html).toContain("Page Not Found");
  });
});

describe("redirectCacheControl", () => {
  const now = 1_800_000_000;
  it("defaults to no-store", () => {
    expect(redirectCacheControl(undefined, 0, now)).toBe("no-store");
    expect(redirectCacheControl("0", 0, now)).toBe("no-store");
    expect(redirectCacheControl("abc", 0, now)).toBe("no-store");
  });
  it("uses a private max-age when configured", () => {
    expect(redirectCacheControl("60", 0, now)).toBe("private, max-age=60");
  });
  it("never caches past the link's expiry", () => {
    expect(redirectCacheControl("60", now + 10, now)).toBe("private, max-age=10");
    expect(redirectCacheControl("60", now, now)).toBe("no-store");
  });
});
