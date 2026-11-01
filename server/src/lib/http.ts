import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { resolveAppUrls, type EnvUrlsLike } from "./urls";

export function drfError(
  status: ContentfulStatusCode,
  detail: string,
  fields?: Record<string, string | string[]>,
): never {
  const body: Record<string, unknown> = fields ? { ...fields } : { detail };
  if (fields && !body.detail && !body.non_field_errors) {
    // If detail isn't already present in fields
  }
  throw new HTTPException(status, {
    res: Response.json(body, { status }),
    message: detail,
  });
}

export function validateZod<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.output<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const fields: Record<string, string[]> = {};
  let firstDetail = "";

  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "detail";
    if (!firstDetail) firstDetail = issue.message;
    (fields[key] ??= []).push(issue.message);
  }

  if (fields.detail && Object.keys(fields).length === 1) {
    drfError(400, fields.detail[0]);
  }

  drfError(400, firstDetail || "Validation error", fields);
}

export async function readJson(req: {
  json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(
  origin: string | undefined | null,
  env: { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string } & EnvUrlsLike,
  requestUrl: string,
): boolean {
  if (!origin) return false;

  const isDevOrTest =
    env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";

  // In production, reject localhost origins unconditionally
  if (!isDevOrTest && isLocalhostOrigin(origin)) {
    return false;
  }

  const urls = resolveAppUrls(env, requestUrl);
  if (origin === urls.adminOrigin) {
    return true;
  }

  const requestOrigin = new URL(requestUrl).origin;
  if (origin === requestOrigin) {
    return true;
  }

  const allowedRaw = env.ALLOWED_ORIGINS || "";
  const allowed = allowedRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const effectiveAllowed = isDevOrTest
    ? allowed
    : allowed.filter((o) => !isLocalhostOrigin(o));

  return effectiveAllowed.includes(origin);
}
