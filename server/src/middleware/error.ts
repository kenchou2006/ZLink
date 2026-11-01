import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    if (err.res) return err.getResponse();
    return c.json({ detail: err.message || "Request error" }, err.status);
  }

  console.error("[unhandled error]", err);
  const detail =
    c.env.ENVIRONMENT === "development"
      ? String((err as Error)?.stack ?? err)
      : "Internal server error";

  return c.json({ detail }, 500);
};
