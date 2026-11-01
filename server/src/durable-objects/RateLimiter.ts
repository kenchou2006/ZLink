import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject {
  async hit(
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - (now % windowMs);
    const stored = (await this.ctx.storage.get<{
      start: number;
      count: number;
    }>("w")) ?? {
      start: windowStart,
      count: 0,
    };
    const state =
      stored.start === windowStart ? stored : { start: windowStart, count: 0 };
    if (state.count >= limit) {
      return {
        allowed: false,
        retryAfter: Math.ceil((windowStart + windowMs - now) / 1000),
      };
    }
    state.count += 1;
    await this.ctx.storage.put("w", state);
    await this.ctx.storage.setAlarm(windowStart + windowMs + 1000);
    return { allowed: true, retryAfter: 0 };
  }

  async peek(limit: number, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - (now % windowMs);
    const stored = await this.ctx.storage.get<{ start: number; count: number }>(
      "w",
    );
    if (!stored || stored.start !== windowStart || stored.count < limit)
      return 0;
    return Math.ceil((windowStart + windowMs - now) / 1000);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
