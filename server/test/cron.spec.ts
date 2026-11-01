import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { clearAll } from "./helpers";
import { handleScheduled } from "../src/jobs/index";

describe("Scheduled Cron Job (Expired Cleanup)", () => {
  beforeEach(async () => {
    await clearAll();
    if (env.KV && typeof env.KV.list === "function") {
      const list = await env.KV.list();
      for (const k of list.keys) {
        await env.KV.delete(k.name);
      }
    }
  });

  it("test_scheduled_job_cleans_expired_links_and_keys", async () => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    // Links: one active, one expired, one future
    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://a.com', 'keep', ?, NULL)`,
    )
      .bind(now)
      .run();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://b.com', 'future', ?, ?)`,
    )
      .bind(now, future)
      .run();

    await env.DB.prepare(
      `INSERT INTO links (original_url, short_code, created_at, expires_at)
       VALUES ('https://c.com', 'past', ?, ?)`,
    )
      .bind(now, past)
      .run();

    // Cache entry for past link
    await env.KV.put(
      ":0:shortener:url:past",
      JSON.stringify({ url: "https://c.com" }),
    );

    // API Keys: one live, one expired
    await env.DB.prepare(
      `INSERT INTO api_keys (name, prefix, key_hash, created_at, expires_at, is_active)
       VALUES ('live', 'zlk_live1234', 'hash_live', ?, NULL, 1)`,
    )
      .bind(now)
      .run();

    await env.DB.prepare(
      `INSERT INTO api_keys (name, prefix, key_hash, created_at, expires_at, is_active)
       VALUES ('exp', 'zlk_exp12345', 'hash_exp', ?, ?, 1)`,
    )
      .bind(now, past)
      .run();

    // Run scheduled job
    const controller = {
      cron: "0 3 * * *",
      scheduledTime: Date.now(),
      noRetry: () => {},
    } as unknown as ScheduledController;

    await handleScheduled(controller, env);

    // Verify expired link was removed
    const remainingLinks = await env.DB.prepare(
      "SELECT short_code FROM links",
    ).all<{ short_code: string }>();
    const linkCodes = new Set(remainingLinks.results.map((r) => r.short_code));
    expect(linkCodes.has("keep")).toBe(true);
    expect(linkCodes.has("future")).toBe(true);
    expect(linkCodes.has("past")).toBe(false);

    // Verify cache was deleted
    const cacheVal = await env.KV.get(":0:shortener:url:past");
    expect(cacheVal).toBeNull();

    // Verify expired key was removed
    const remainingKeys = await env.DB.prepare(
      "SELECT name FROM api_keys",
    ).all<{ name: string }>();
    const keyNames = new Set(remainingKeys.results.map((r) => r.name));
    expect(keyNames.has("live")).toBe(true);
    expect(keyNames.has("exp")).toBe(false);
  });
});
