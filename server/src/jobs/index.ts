import { and, isNotNull, lte, inArray } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, links, apiKeys, refreshTokens } from "../db";
import { getCacheKeyVariants } from "../lib/utils";

export async function handleScheduled(
  _controller: ScheduledController,
  env: Env,
): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  // 1. Purge expired links & invalidate KV cache
  try {
    const expiredLinks = await db
      .select({ id: links.id, shortCode: links.shortCode })
      .from(links)
      .where(and(isNotNull(links.expiresAt), lte(links.expiresAt, now)));

    if (expiredLinks.length > 0) {
      if (env.KV && typeof env.KV.delete === "function") {
        for (const l of expiredLinks) {
          const variants = getCacheKeyVariants(l.shortCode);
          for (const v of variants) {
            await env.KV.delete(v).catch(() => {});
          }
        }
      }
      await db
        .delete(links)
        .where(
          inArray(
            links.id,
            expiredLinks.map((l) => l.id),
          ),
        )
        .run();
      console.log(
        `[scheduled] Purged ${expiredLinks.length} expired short link(s).`,
      );
    }
  } catch (err) {
    console.error("[scheduled] Error purging expired links:", err);
  }

  // 2. Purge expired API keys
  try {
    const expiredKeys = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(isNotNull(apiKeys.expiresAt), lte(apiKeys.expiresAt, now)));

    if (expiredKeys.length > 0) {
      await db
        .delete(apiKeys)
        .where(
          inArray(
            apiKeys.id,
            expiredKeys.map((k) => k.id),
          ),
        )
        .run();
      console.log(
        `[scheduled] Purged ${expiredKeys.length} expired API key(s).`,
      );
    }
  } catch (err) {
    console.error("[scheduled] Error purging expired API keys:", err);
  }

  // 3. Purge expired refresh tokens
  try {
    await db
      .delete(refreshTokens)
      .where(lte(refreshTokens.expiresAt, now))
      .run();
  } catch (err) {
    console.error("[scheduled] Error purging expired refresh tokens:", err);
  }
}
