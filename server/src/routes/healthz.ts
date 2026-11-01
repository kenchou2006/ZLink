import { Hono } from "hono";
import type { AppEnv } from "../env";

export const healthzRoutes = new Hono<AppEnv>();

healthzRoutes.get("/", (c) => {
  return c.json({ status: "ok" });
});
