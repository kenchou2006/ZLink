import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { call, callWithAssets, clearAll, createUser } from "./helpers";
import { setBuildMetaCache, resetBuildMetaCache } from "../src/lib/meta";

describe("Subpath & Separated Domain Deployment with Static Assets", () => {
  beforeEach(async () => {
    await clearAll();
    resetBuildMetaCache();
    if (env.KV && typeof env.KV.list === "function") {
      const list = await env.KV.list();
      for (const k of list.keys) {
        await env.KV.delete(k.name);
      }
    }
  });

  describe("Configuration 1: Default Base (/admin)", () => {
    const envDefault = {
      SHORT_LINK_URL: "https://zlink.example.com",
      ADMIN_URL: "https://zlink.example.com/admin",
    };

    it("verifies assets served by static layer, HTML by worker, and short root/api behavior", async () => {
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://root.example.com', '@root', ?)`,
      )
        .bind(now)
        .run();

      // 1. Static asset directly served by static layer (without worker asset logic)
      const assetRes = await callWithAssets(
        "https://zlink.example.com/admin/main.js",
        {
          envOverrides: envDefault,
        },
      );
      expect(assetRes.status).toBe(200);
      const assetText = await assetRes.text();
      expect(assetText).toContain("direct asset from admin static assets");

      // Static i18n
      const i18nRes = await callWithAssets(
        "https://zlink.example.com/admin/i18n/zh-TW.json",
        {
          envOverrides: envDefault,
        },
      );
      expect(i18nRes.status).toBe(200);
      const i18nJson = (await i18nRes.json()) as any;
      expect(i18nJson.LOGIN).toBe("登入");

      // 2. HTML served by Worker with base rewritten to /admin/
      const spaRes = await callWithAssets("https://zlink.example.com/admin/", {
        envOverrides: envDefault,
      });
      expect(spaRes.status).toBe(200);
      expect(spaRes.headers.get("Content-Type")).toContain("text/html");
      const html = await spaRes.text();
      expect(html).toContain('<base href="/admin/">');
      expect(html).toContain("ZLink Admin");

      // 3. Deep SPA route fallback served by Worker
      const deepRes = await callWithAssets(
        "https://zlink.example.com/admin/settings/users",
        {
          envOverrides: envDefault,
        },
      );
      expect(deepRes.status).toBe(200);
      const deepHtml = await deepRes.text();
      expect(deepHtml).toContain('<base href="/admin/">');

      // 4. Dynamic config.json served by Worker with no-store
      const configRes = await callWithAssets(
        "https://zlink.example.com/admin/config.json",
        {
          envOverrides: envDefault,
        },
      );
      expect(configRes.status).toBe(200);
      expect(configRes.headers.get("Cache-Control")).toBe("no-store");
      const configJson = (await configRes.json()) as any;
      expect(configJson.apiBase).toBe("/admin/api");

      // 5. Short link domain: / is @root redirect, NOT admin UI
      const rootRes = await callWithAssets("https://zlink.example.com/", {
        envOverrides: envDefault,
      });
      expect(rootRes.status).toBe(302);
      expect(rootRes.headers.get("Location")).toBe("https://root.example.com");

      // 6. Short link domain: /api is 404
      const apiBlockedRes = await callWithAssets(
        "https://zlink.example.com/api",
        {
          envOverrides: envDefault,
        },
      );
      expect(apiBlockedRes.status).toBe(404);

      const apiSubBlockedRes = await callWithAssets(
        "https://zlink.example.com/api/healthz",
        {
          envOverrides: envDefault,
        },
      );
      expect(apiSubBlockedRes.status).toBe(404);

      // 7. Admin API works at /admin/api/healthz/
      const adminApiRes = await callWithAssets(
        "https://zlink.example.com/admin/api/healthz/",
        {
          envOverrides: envDefault,
        },
      );
      expect(adminApiRes.status).toBe(200);
      const adminApiJson = (await adminApiRes.json()) as any;
      expect(adminApiJson.status).toBe("ok");

      // 8. Outside base path: returns 404
      const outsideRes = await callWithAssets(
        "https://zlink.example.com/other-unmatched",
        {
          envOverrides: envDefault,
        },
      );
      expect(outsideRes.status).toBe(404);
    });
  });

  describe("Configuration 2: Dedicated Admin Domain (admin base is empty)", () => {
    const envDedicated = {
      SHORT_LINK_URL: "https://zl.ink",
      ADMIN_URL: "https://admin.example.com",
    };

    it("verifies assets served by static layer, HTML by worker, root redirect, /api blocked, and reserved words", async () => {
      // In this mode, build-meta has basePath: "" and rootReservedNames: ["favicon.ico", "i18n", "main.js"]
      setBuildMetaCache({
        basePath: "",
        builtAt: new Date().toISOString(),
        rootReservedNames: ["favicon.ico", "i18n", "media", "main.js"],
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://root.b.com', '@root', ?)`,
      )
        .bind(now)
        .run();

      // 1. Assets served directly by static layer from asset root
      const assetRes = await callWithAssets(
        "https://admin.example.com/main.js",
        {
          envOverrides: envDedicated,
        },
      );
      expect(assetRes.status).toBe(200);
      const assetText = await assetRes.text();
      expect(assetText).toContain("direct asset from root static assets");

      const i18nRes = await callWithAssets(
        "https://admin.example.com/i18n/zh-TW.json",
        {
          envOverrides: envDedicated,
        },
      );
      expect(i18nRes.status).toBe(200);
      const i18nJson = (await i18nRes.json()) as any;
      expect(i18nJson.LOGIN).toBe("登入");

      // 2. HTML served by Worker with base rewritten to /
      const spaRes = await callWithAssets("https://admin.example.com/", {
        envOverrides: envDedicated,
      });
      expect(spaRes.status).toBe(200);
      const html = await spaRes.text();
      expect(html).toContain('<base href="/">');
      expect(html).toContain("ZLink Admin");

      // 3. Deep SPA route
      const deepRes = await callWithAssets(
        "https://admin.example.com/settings/users",
        {
          envOverrides: envDedicated,
        },
      );
      expect(deepRes.status).toBe(200);
      const deepHtml = await deepRes.text();
      expect(deepHtml).toContain('<base href="/">');

      // 4. Dynamic config.json
      const configRes = await callWithAssets(
        "https://admin.example.com/config.json",
        {
          envOverrides: envDedicated,
        },
      );
      expect(configRes.status).toBe(200);
      expect(configRes.headers.get("Cache-Control")).toBe("no-store");
      const configJson = (await configRes.json()) as any;
      expect(configJson.apiBase).toBe("/api");

      // 5. Short link domain: / is @root redirect, NOT admin UI
      const rootRes = await callWithAssets("https://zl.ink/", {
        envOverrides: envDedicated,
      });
      expect(rootRes.status).toBe(302);
      expect(rootRes.headers.get("Location")).toBe("https://root.b.com");

      // 6. Short link domain: /api is 404
      const apiBlockedRes = await callWithAssets("https://zl.ink/api", {
        envOverrides: envDedicated,
      });
      expect(apiBlockedRes.status).toBe(404);

      // 7. Admin API works at /api/healthz/ on admin domain
      const adminApiRes = await callWithAssets(
        "https://admin.example.com/api/healthz/",
        {
          envOverrides: envDedicated,
        },
      );
      expect(adminApiRes.status).toBe(200);

      // 8. Top-level names in asset root must be automatically reserved as short codes
      const staff = await createUser({
        username: "staff-dedicated",
        isStaff: true,
      });

      // Try creating 'i18n' -> should be rejected
      const resI18n = await call("https://admin.example.com/api/links/", {
        method: "POST",
        token: staff.token,
        body: { original_url: "https://target.com/test", short_code: "i18n" },
        envOverrides: envDedicated,
      });
      expect(resI18n.status).toBe(400);
      const errI18n = (await resI18n.json()) as any;
      expect(errI18n.short_code[0]).toContain("reserved");

      // Try creating 'media' -> should be rejected
      const resMedia = await call("https://admin.example.com/api/links/", {
        method: "POST",
        token: staff.token,
        body: { original_url: "https://target.com/test", short_code: "media" },
        envOverrides: envDedicated,
      });
      expect(resMedia.status).toBe(400);
      const errMedia = (await resMedia.json()) as any;
      expect(errMedia.short_code[0]).toContain("reserved");

      // Try creating 'favicon.ico' -> should be rejected
      const resFavicon = await call("https://admin.example.com/api/links/", {
        method: "POST",
        token: staff.token,
        body: {
          original_url: "https://target.com/test",
          short_code: "favicon.ico",
        },
        envOverrides: envDedicated,
      });
      expect(resFavicon.status).toBe(400);
      const errFavicon = (await resFavicon.json()) as any;
      expect(errFavicon.short_code[0]).toContain("reserved");
    });
  });

  describe("Configuration 3: Subpath on Same Domain (/zlink, short link /s)", () => {
    const envSubpath = {
      SHORT_LINK_URL: "https://example.com/s",
      ADMIN_URL: "https://example.com/zlink",
    };

    it("verifies assets under /zlink, HTML by worker, 301 redirects, short root and /api blocked", async () => {
      setBuildMetaCache({
        basePath: "/zlink",
        builtAt: new Date().toISOString(),
        rootReservedNames: ["zlink", "favicon.ico"],
      });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO links (original_url, short_code, created_at) VALUES ('https://root.c.com', '@root', ?)`,
      )
        .bind(now)
        .run();

      // 1. Asset directly served from /zlink/*
      const assetRes = await callWithAssets(
        "https://example.com/zlink/main.js",
        {
          envOverrides: envSubpath,
        },
      );
      expect(assetRes.status).toBe(200);
      const assetText = await assetRes.text();
      expect(assetText).toContain("direct asset from zlink static assets");

      const i18nRes = await callWithAssets(
        "https://example.com/zlink/i18n/zh-TW.json",
        {
          envOverrides: envSubpath,
        },
      );
      expect(i18nRes.status).toBe(200);
      const i18nJson = (await i18nRes.json()) as any;
      expect(i18nJson.LOGIN).toBe("登入");

      // 2. HTML served by Worker with base rewritten to /zlink/
      const spaRes = await callWithAssets("https://example.com/zlink/", {
        envOverrides: envSubpath,
      });
      expect(spaRes.status).toBe(200);
      const html = await spaRes.text();
      expect(html).toContain('<base href="/zlink/">');
      expect(html).toContain("ZLink Admin");

      // 3. Admin path without trailing slash -> 301 redirect
      const noSlashRes = await callWithAssets("https://example.com/zlink", {
        envOverrides: envSubpath,
      });
      expect(noSlashRes.status).toBe(301);
      expect(noSlashRes.headers.get("Location")).toBe(
        "https://example.com/zlink/",
      );

      // 4. Deep SPA route under /zlink/
      const deepRes = await callWithAssets(
        "https://example.com/zlink/dashboard/users",
        {
          envOverrides: envSubpath,
        },
      );
      expect(deepRes.status).toBe(200);
      const deepHtml = await deepRes.text();
      expect(deepHtml).toContain('<base href="/zlink/">');

      // 5. Dynamic config.json
      const configRes = await callWithAssets(
        "https://example.com/zlink/config.json",
        {
          envOverrides: envSubpath,
        },
      );
      expect(configRes.status).toBe(200);
      expect(configRes.headers.get("Cache-Control")).toBe("no-store");
      const configJson = (await configRes.json()) as any;
      expect(configJson.apiBase).toBe("/zlink/api");

      // 6. Short link domain: /s/ is @root redirect
      const rootRes = await callWithAssets("https://example.com/s/", {
        envOverrides: envSubpath,
      });
      expect(rootRes.status).toBe(302);
      expect(rootRes.headers.get("Location")).toBe("https://root.c.com");

      // 7. Short link without slash: /s -> 301 redirect to /s/
      const shortNoSlashRes = await callWithAssets("https://example.com/s", {
        envOverrides: envSubpath,
      });
      expect(shortNoSlashRes.status).toBe(301);
      expect(shortNoSlashRes.headers.get("Location")).toBe(
        "https://example.com/s/",
      );

      // 8. Short link domain: /api and /s/api are 404
      const apiBlockedRes = await callWithAssets("https://example.com/api", {
        envOverrides: envSubpath,
      });
      expect(apiBlockedRes.status).toBe(404);

      const shortApiBlockedRes = await callWithAssets(
        "https://example.com/s/api",
        {
          envOverrides: envSubpath,
        },
      );
      expect(shortApiBlockedRes.status).toBe(404);

      // 9. Admin API works at /zlink/api/healthz/
      const adminApiRes = await callWithAssets(
        "https://example.com/zlink/api/healthz/",
        {
          envOverrides: envSubpath,
        },
      );
      expect(adminApiRes.status).toBe(200);
    });
  });

  describe("Base Path Mismatch & Security Verification", () => {
    it("returns 500 and console.error when built base does not match runtime base", async () => {
      // Mock build-meta built for /admin
      setBuildMetaCache({
        basePath: "/admin",
        builtAt: new Date().toISOString(),
      });

      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

      // Runtime is configured with /different-base
      const mismatchEnv = {
        SHORT_LINK_URL: "https://zlink.example.com",
        ADMIN_URL: "https://zlink.example.com/different-base",
      };

      const res = await callWithAssets(
        "https://zlink.example.com/different-base/",
        {
          envOverrides: mismatchEnv,
        },
      );
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain("Frontend build base mismatch");
      expect(spyError).toHaveBeenCalled();
      const errorLog = spyError.mock.calls.flat().join(" ");
      expect(errorLog).toContain("rebuild frontend");

      spyError.mockRestore();
    });

    it("blocks external access to internal /__admin paths", async () => {
      const res = await callWithAssets(
        "https://zlink.example.com/__admin/index.html",
      );
      expect(res.status).toBe(404);

      const resMeta = await callWithAssets(
        "https://zlink.example.com/__admin/build-meta.json",
      );
      expect(resMeta.status).toBe(404);
    });
  });
});

describe("short_url and session cookies follow the configured URLs", () => {
  beforeEach(async () => {
    await clearAll();
    resetBuildMetaCache();
  });

  const cases = [
    {
      name: "default /admin",
      env: {
        SHORT_LINK_URL: "https://zlink.example.com",
        ADMIN_URL: "https://zlink.example.com/admin",
      },
      admin: "https://zlink.example.com/admin",
      short: "https://zlink.example.com",
      refreshPath: "/admin/api/auth/",
    },
    {
      name: "dedicated admin domain",
      env: {
        SHORT_LINK_URL: "https://zl.ink",
        ADMIN_URL: "https://admin.example.com",
      },
      admin: "https://admin.example.com",
      short: "https://zl.ink",
      refreshPath: "/api/auth/",
    },
    {
      name: "same-domain sub-paths",
      env: {
        SHORT_LINK_URL: "https://example.com/s",
        ADMIN_URL: "https://example.com/zlink",
      },
      admin: "https://example.com/zlink",
      short: "https://example.com/s",
      refreshPath: "/zlink/api/auth/",
    },
  ];

  for (const tc of cases) {
    it(`${tc.name}: short_url uses SHORT_LINK_URL and cookies are scoped to ADMIN_URL`, async () => {
      await createUser({
        username: "owner",
        password: "pass12345",
        isStaff: true,
      });

      const login = await call(`${tc.admin}/api/auth/login`, {
        body: { username: "owner", password: "pass12345" },
        envOverrides: tc.env,
      });
      expect(login.status).toBe(200);
      const cookies = login.headers.getSetCookie();
      expect(
        cookies.some(
          (c) => c.startsWith("__Host-zl_at=") && c.includes("Path=/;"),
        ),
      ).toBe(true);
      const refresh = cookies.find((c) => c.startsWith("__Secure-zl_rt="));
      expect(refresh).toContain(`Path=${tc.refreshPath}`);
      expect(cookies.every((c) => !/Domain=/i.test(c))).toBe(true);
      const { access } = (await login.json()) as { access: string };

      const created = await call(`${tc.admin}/api/links/`, {
        token: access,
        body: { original_url: "https://example.org/x", short_code: "probe1" },
        envOverrides: tc.env,
      });
      expect(created.status).toBe(201);
      expect(((await created.json()) as { short_url: string }).short_url).toBe(
        `${tc.short}/probe1`,
      );

      if (new URL(tc.short).host !== new URL(tc.admin).host) {
        const onShortHost = await call(`${tc.short}/api/auth/login`, {
          body: { username: "owner", password: "pass12345" },
          envOverrides: tc.env,
        });
        expect(onShortHost.status).toBe(404);
        expect(onShortHost.headers.getSetCookie()).toHaveLength(0);
      }
    });
  }
});
