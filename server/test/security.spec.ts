import { beforeEach, describe, expect, it } from "vitest";
import { call, clearAll, createUser } from "./helpers";
import { clearMemoryRateLimits } from "../src/middleware/rateLimit";
import wranglerRaw from "../wrangler.jsonc?raw";
import devVarsRaw from "../.dev.vars.example?raw";
import headersRaw from "../../client/public/_headers?raw";

describe("Security & Protection Tests", () => {
  beforeEach(async () => {
    await clearAll();
    clearMemoryRateLimits();
  });

  it("test_unauthorized_access_to_protected_endpoints", async () => {
    const res1 = await call("/api/links/");
    expect(res1.status).toBe(401);

    const res2 = await call("/api/users/");
    expect(res2.status).toBe(401);

    const res3 = await call("/api/api-keys/");
    expect(res3.status).toBe(401);

    const res4 = await call("/api/profile/");
    expect(res4.status).toBe(401);

    const res5 = await call("/api/cache/keys/");
    expect(res5.status).toBe(401);
  });

  it("test_privilege_escalation_prevented", async () => {
    const staff = await createUser({
      username: "staff1",
      isStaff: true,
      isSuperUser: false,
    });

    // Staff cannot list users
    const resUsers = await call("/api/users/", { token: staff.token });
    expect(resUsers.status).toBe(403);

    // Staff cannot view cache
    const resCache = await call("/api/cache/keys/", { token: staff.token });
    expect(resCache.status).toBe(403);
  });

  it("test_rate_limiting_throttles_excess_requests", async () => {
    await createUser({ username: "ratelimited", isStaff: true });

    // Login rate limit is 15/min
    let throttled = false;
    for (let i = 0; i < 20; i++) {
      const res = await call("/api/auth/login/", {
        method: "POST",
        body: { username: "ratelimited", password: "wrong" },
      });
      if (res.status === 429) {
        throttled = true;
        expect(res.headers.get("Retry-After")).toBeDefined();
        break;
      }
    }
    expect(throttled).toBe(true);
  });

  it("test_csrf_same_origin_guard", async () => {
    // When state-changing request has cross-site Sec-Fetch-Site and Origin
    const res = await call("/api/auth/login/", {
      method: "POST",
      headers: {
        Origin: "https://malicious-attacker.com",
        "Sec-Fetch-Site": "cross-site",
      },
      body: { username: "test", password: "123" },
    });
    expect(res.status).toBe(403);
  });

  it("test_security_headers_present", async () => {
    const res = await call("/healthz");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
  });

  it("test_xss_url_injection_prevented_on_link_creation", async () => {
    const staff = await createUser({ username: "staff", isStaff: true });

    const evilUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ];

    for (const evil of evilUrls) {
      const res = await call("/api/links/", {
        method: "POST",
        token: staff.token,
        body: { original_url: evil },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.original_url).toBeDefined();
    }
  });

  it("test_swagger_ui_pinned_exact_version_with_sri", async () => {
    const res = await call("/api/docs");
    expect(res.status).toBe(200);
    const html = await res.text();

    // Must be pinned exact version (no floating @5)
    expect(html).toContain("swagger-ui-dist@5.18.2");
    expect(html).not.toContain("swagger-ui-dist@5/");

    // Must have SRI integrity attributes and crossorigin="anonymous"
    expect(html).toContain(
      'integrity="sha384-rcbEi6xgdPk0iWkAQzT2F3FeBJXdG+ydrawGlfHAFIZG7wU6aKbQaRewysYpmrlW"',
    );
    expect(html).toContain(
      'integrity="sha384-NXtFPpN61oWCuN4D42K6Zd5Rt2+uxeIT36R7kpXBuY9tLnZorzrJ4ykpqwJfgjpZ"',
    );
    expect(html).toMatch(/crossorigin="anonymous"/);
  });

  it("test_production_wrangler_config_and_dev_vars_for_allowed_origins", () => {
    // Parse vars from wrangler.jsonc
    const allowedOriginsMatch = wranglerRaw.match(
      /"ALLOWED_ORIGINS":\s*"([^"]*)"/,
    );
    expect(allowedOriginsMatch).not.toBeNull();
    const prodAllowedOrigins = allowedOriginsMatch![1];
    expect(prodAllowedOrigins).not.toContain("localhost");
    expect(prodAllowedOrigins).not.toContain("127.0.0.1");

    // .dev.vars.example must contain ALLOWED_ORIGINS with localhost
    expect(devVarsRaw).toContain(
      "ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200",
    );
  });

  it("test_cors_and_csrf_in_production_rejects_localhost", async () => {
    // When ENVIRONMENT is production, localhost must be rejected by CSRF
    const resCsrf = await call("/api/links/", {
      method: "POST",
      headers: {
        Origin: "http://localhost:4200",
      },
      envOverrides: {
        ENVIRONMENT: "production",
        ALLOWED_ORIGINS: "http://localhost:4200", // even if misconfigured
      },
      body: { original_url: "https://example.com" },
    });
    expect(resCsrf.status).toBe(403);

    // OPTIONS preflight in production with localhost origin should not return Access-Control-Allow-Origin
    const resOptions = await call("/api/links/", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:4200",
      },
      envOverrides: {
        ENVIRONMENT: "production",
        ALLOWED_ORIGINS: "http://localhost:4200",
      },
    });
    expect(resOptions.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("test_client_public_headers_contains_required_security_headers", () => {
    expect(headersRaw).toContain("/admin/*");
    expect(headersRaw).toContain("Content-Security-Policy");
    expect(headersRaw).toContain("default-src 'self'");
    expect(headersRaw).toContain("frame-ancestors 'none'");
    expect(headersRaw).toContain("X-Content-Type-Options: nosniff");
    expect(headersRaw).toContain(
      "Referrer-Policy: strict-origin-when-cross-origin",
    );
    expect(headersRaw).toContain("Permissions-Policy");
    expect(headersRaw).toContain("Strict-Transport-Security");
  });
});
