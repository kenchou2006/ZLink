import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll, createUser } from "./helpers";
import { webAuthnConfig } from "../src/routes/auth";

describe("Auth API (recreating Django AuthTests + upgrades)", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("test_login_returns_tokens_and_user", async () => {
    await createUser({
      username: "admin",
      isSuperUser: true,
      password: "pass12345",
    });

    const res = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "admin", password: "pass12345" },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.access).toBeDefined();
    expect(data.refresh).toBeDefined();
    expect(data.user.username).toBe("admin");
    expect(data.user.is_superuser).toBe(true);
  });

  it("test_login_wrong_password", async () => {
    await createUser({
      username: "admin",
      isSuperUser: true,
      password: "pass12345",
    });

    const res = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "admin", password: "nope" },
    });

    expect(res.status).toBe(401);
  });

  it("test_me_requires_auth", async () => {
    const res = await call("/api/auth/me/");
    expect(res.status).toBe(401);
  });

  it("test_logout_blacklists_refresh", async () => {
    await createUser({
      username: "admin",
      isSuperUser: true,
      password: "pass12345",
    });

    const loginRes = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "admin", password: "pass12345" },
    });
    const loginData = (await loginRes.json()) as any;
    const refresh = loginData.refresh;
    const access = loginData.access;

    const logoutRes = await call("/api/auth/logout/", {
      method: "POST",
      token: access,
      body: { refresh },
    });
    expect(logoutRes.status).toBe(205);

    // Reusing the blacklisted refresh must fail
    const again = await call("/api/auth/refresh/", {
      method: "POST",
      body: { refresh },
    });
    expect(again.status).toBe(401);
  });

  it("test_login_django_pbkdf2_1_2m_hash_upgrades_to_100k", async () => {
    // A real Django 6 pbkdf2_sha256 hash with 1,200,000 iterations for password 'secret123'
    // Format: pbkdf2_sha256$<iterations>$<salt>$<base64_hash>
    const djangoHash1200k =
      "pbkdf2_sha256$1200000$djangoSalt1234567890$LZsyN9d2SgqLgOsepoEcLBm+ccFsdWreJYIBTaedPaQ=";

    await createUser({
      username: "django1200k_user",
      rawPasswordHash: djangoHash1200k,
      isStaff: true,
    });

    const rowBefore = await env.DB.prepare(
      "SELECT password FROM users WHERE username = ?",
    )
      .bind("django1200k_user")
      .first<{ password: string }>();
    expect(rowBefore?.password).toBe(djangoHash1200k);

    // Sign in with 'secret123'
    const res = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "django1200k_user", password: "secret123" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.access).toBeDefined();

    // Verify password hash in D1 was rehashed to standard 100,000 iterations
    const rowAfter = await env.DB.prepare(
      "SELECT password FROM users WHERE username = ?",
    )
      .bind("django1200k_user")
      .first<{ password: string }>();
    expect(rowAfter?.password).not.toBe(djangoHash1200k);
    expect(rowAfter?.password.startsWith("pbkdf2_sha256$100000$")).toBe(true);

    // Subsequent login works with rehashed password
    const resAgain = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "django1200k_user", password: "secret123" },
    });
    expect(resAgain.status).toBe(200);
  });

  describe("WebAuthn Expected Origins Configuration", () => {
    it("test_webauthn_production_only_allows_configured_https_and_rejects_localhost_and_http", () => {
      const prodEnv = {
        ENVIRONMENT: "production",
        SITE_ORIGIN: "https://zlink.example.com",
        WEBAUTHN_RP_ID: "zlink.example.com",
      } as any;

      const config = webAuthnConfig(
        "https://zlink.example.com/api/auth/passkeys/register/options",
        prodEnv,
      );
      expect(config.expectedOrigins).toEqual(["https://zlink.example.com"]);
      expect(config.expectedOrigins).not.toContain("http://localhost:4200");
      expect(config.expectedOrigins).not.toContain("http://127.0.0.1:4200");
      expect(config.expectedOrigins).not.toContain("http://zlink.example.com");
    });

    it("test_webauthn_production_strips_localhost_and_http_from_dedicated_var", () => {
      const prodEnv = {
        ENVIRONMENT: "production",
        WEBAUTHN_ORIGINS:
          "https://app.example.com,http://localhost:4200,http://insecure.example.com",
        WEBAUTHN_RP_ID: "app.example.com",
      } as any;

      const config = webAuthnConfig(
        "https://app.example.com/api/auth/passkeys/register/options",
        prodEnv,
      );
      expect(config.expectedOrigins).toEqual(["https://app.example.com"]);
    });

    it("test_webauthn_dev_and_test_allows_localhost", () => {
      const devEnv = {
        ENVIRONMENT: "development",
        WEBAUTHN_ORIGINS: "http://localhost:8787,http://localhost:4200",
        WEBAUTHN_RP_ID: "localhost",
      } as any;

      const config = webAuthnConfig(
        "http://localhost:8787/api/auth/passkeys/register/options",
        devEnv,
      );
      expect(config.expectedOrigins).toContain("http://localhost:8787");
      expect(config.expectedOrigins).toContain("http://localhost:4200");
    });
  });

  it("test_login_password_login_disabled_requires_passkey", async () => {
    await createUser({
      username: "keyonly",
      isStaff: true,
      password: "pass12345",
      passwordLoginDisabled: true,
    });

    const res = await call("/api/auth/login/", {
      method: "POST",
      body: { username: "keyonly", password: "pass12345" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.detail).toContain("Sign in with a passkey instead");
  });
});
