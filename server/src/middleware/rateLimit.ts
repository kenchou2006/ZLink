import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";

const UNITS: Record<string, number> = {
  sec: 1,
  min: 60,
  hour: 3600,
  day: 86400,
};

export function parseRate(rate: string): { limit: number; window: number } {
  const [n, unit] = rate.split("/");
  const window = UNITS[unit];
  if (!window || !Number(n)) throw new Error(`bad rate string: ${rate}`);
  return { limit: Number(n), window };
}

// In-memory fallback for local tests or environments where DO is mocked/disabled
const memLimitStore = new Map<string, { start: number; count: number }>();

async function checkDoOrMemoryLimit(
  c: Context<AppEnv>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (
    c.env.RATE_LIMITER &&
    typeof c.env.RATE_LIMITER.idFromName === "function"
  ) {
    try {
      const id = c.env.RATE_LIMITER.idFromName(key);
      const stub = c.env.RATE_LIMITER.get(id);
      return await stub.hit(limit, windowSeconds);
    } catch {
      // fallback to memory
    }
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - (now % windowMs);
  const stored = memLimitStore.get(key) ?? { start: windowStart, count: 0 };
  const state =
    stored.start === windowStart ? stored : { start: windowStart, count: 0 };

  if (state.count >= limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((windowStart + windowMs - now) / 1000),
    );
    return { allowed: false, retryAfter };
  }

  state.count += 1;
  memLimitStore.set(key, state);
  return { allowed: true, retryAfter: 0 };
}

export function clearMemoryRateLimits(): void {
  memLimitStore.clear();
}

export function rateLimit(
  scope: string,
  rate: string,
  keyFn?: (c: Context<AppEnv>) => string | undefined,
): MiddlewareHandler<AppEnv> {
  const { limit, window } = parseRate(rate);

  return async (c, next) => {
    const customKey = keyFn?.(c);
    const clientKey =
      customKey ??
      c.get("userId")?.toString() ??
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      "default";

    const fullKey = `${scope}:${clientKey}`;
    const result = await checkDoOrMemoryLimit(c, fullKey, limit, window);

    if (!result.allowed) {
      const wait = result.retryAfter || window;
      throw new HTTPException(429, {
        res: Response.json(
          {
            detail: `Request was throttled. Expected available in ${wait} seconds.`,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(wait),
            },
          },
        ),
        message: "Request was throttled.",
      });
    }

    return next();
  };
}
