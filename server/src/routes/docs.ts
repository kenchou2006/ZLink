import { Hono } from "hono";
import type { AppEnv } from "../env";

export const docsRoutes = new Hono<AppEnv>();

docsRoutes.get("/schema", (c) => {
  return c.json({
    openapi: "3.0.3",
    info: {
      title: "ZLink API",
      version: "1.0.0",
      description:
        "Management API for the ZLink URL shortener (Cloudflare Worker Edition).",
    },
    paths: {
      "/api/healthz/": { get: { summary: "Health check" } },
      "/api/auth/login/": { post: { summary: "User login" } },
      "/api/auth/refresh/": { post: { summary: "Token refresh" } },
      "/api/auth/logout/": { post: { summary: "Logout" } },
      "/api/auth/me/": { get: { summary: "Current user" } },
      "/api/links/": {
        get: { summary: "List links" },
        post: { summary: "Create link" },
      },
      "/api/links/{id}/": {
        get: { summary: "Get link" },
        patch: { summary: "Update link" },
        delete: { summary: "Delete link" },
      },
      "/api/links/expired/": { get: { summary: "List expired links" } },
      "/api/links/purge-expired/": { post: { summary: "Purge expired links" } },
      "/api/links/bulk-delete/": { post: { summary: "Bulk delete links" } },
      "/api/users/": {
        get: { summary: "List users" },
        post: { summary: "Create user" },
      },
      "/api/users/stats/": { get: { summary: "User statistics" } },
      "/api/users/{id}/": {
        get: { summary: "Get user" },
        patch: { summary: "Update user" },
        delete: { summary: "Delete user" },
      },
      "/api/users/{id}/toggle-active/": {
        post: { summary: "Toggle user active" },
      },
      "/api/api-keys/": {
        get: { summary: "List API keys" },
        post: { summary: "Create API key" },
      },
      "/api/api-keys/{id}/": {
        patch: { summary: "Update API key" },
        delete: { summary: "Delete API key" },
      },
      "/api/profile/": {
        get: { summary: "Get profile" },
        patch: { summary: "Update profile" },
      },
      "/api/cache/keys/": {
        get: { summary: "List cache keys" },
        delete: { summary: "Delete cache key" },
      },
      "/api/cache/clear/": { post: { summary: "Clear all cache keys" } },
    },
  });
});

docsRoutes.get("/docs", (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>ZLink API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css" integrity="sha384-rcbEi6xgdPk0iWkAQzT2F3FeBJXdG+ydrawGlfHAFIZG7wU6aKbQaRewysYpmrlW" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js" integrity="sha384-NXtFPpN61oWCuN4D42K6Zd5Rt2+uxeIT36R7kpXBuY9tLnZorzrJ4ykpqwJfgjpZ" crossorigin="anonymous"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/schema/',
        dom_id: '#swagger-ui',
      });
    };
  </script>
</body>
</html>`);
});
