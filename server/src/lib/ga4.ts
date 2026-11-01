import type { Env } from "../env";

function extractGAClientID(cookieHeader?: string): string {
  if (cookieHeader) {
    const match = cookieHeader.match(/_ga=([^;]+)/);
    if (match) {
      let val = match[1].trim();
      if (val.startsWith("GA")) {
        const parts = val.split(".");
        if (parts.length > 2) {
          val = parts.slice(2).join(".");
        }
      }
      if (val) return val;
    }
  }
  return crypto.randomUUID();
}

function resolveClientIP(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();

  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }

  return "";
}

export async function sendGA4Event(
  env: Env,
  request: Request,
  targetUrl: string,
  fullShortUrl: string,
  source: "cache" | "db",
): Promise<void> {
  const measurementId = env.GA_MEASUREMENT_ID;
  const apiSecret = env.GA_API_SECRET;

  if (!measurementId || !apiSecret) {
    return;
  }

  const clientId = extractGAClientID(
    request.headers.get("Cookie") ?? undefined,
  );
  const ipOverride = resolveClientIP(request);
  const userAgent = request.headers.get("User-Agent") ?? "";

  const payload = {
    client_id: clientId,
    events: [
      {
        name: "page_view",
        params: {
          page_title: targetUrl,
          page_location: fullShortUrl,
          source,
        },
      },
    ],
  };

  const url = new URL("https://www.google-analytics.com/mp/collect");
  url.searchParams.set("measurement_id", measurementId);
  url.searchParams.set("api_secret", apiSecret);
  if (ipOverride) {
    url.searchParams.set("ip_override", ipOverride);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }

  try {
    await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[ga4] failed to dispatch measurement event:", err);
  }
}
