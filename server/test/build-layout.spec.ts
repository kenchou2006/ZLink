import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore
import { prepareDist } from "../../client/scripts/prepare-dist.mjs";
import { resolveAppUrls } from "../src/lib/urls";

describe("Frontend Build Output Layout Verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "zlink-layout-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupMockAngularOutput(baseHref: string) {
    const outDir = join(tempDir, "dist", "ZLinkFE", "browser");
    mkdirSync(join(outDir, "i18n"), { recursive: true });
    writeFileSync(
      join(outDir, "index.html"),
      `<!doctype html><html><head><base href="${baseHref}"><title>App</title></head><body></body></html>`,
      "utf8",
    );
    writeFileSync(
      join(outDir, "main-abc12345.js"),
      "console.log('main');",
      "utf8",
    );
    writeFileSync(
      join(outDir, "styles-xyz67890.css"),
      "body{margin:0}",
      "utf8",
    );
    writeFileSync(join(outDir, "favicon.ico"), "icon", "utf8");
    writeFileSync(join(outDir, "config.json"), '{"apiBase":"/api"}', "utf8");
    writeFileSync(join(outDir, "i18n", "en.json"), '{"hello":"world"}', "utf8");
    writeFileSync(
      join(outDir, "i18n", "zh-TW.json"),
      '{"hello":"世界"}',
      "utf8",
    );
  }

  it("Scenario 1: Default /admin base layout", () => {
    const urls = resolveAppUrls({
      SHORT_LINK_URL: "https://zlink.example.com",
      ADMIN_URL: "https://zlink.example.com/admin",
    });
    expect(urls.adminBase).toBe("/admin");
    expect(urls.adminBaseHref).toBe("/admin/");

    setupMockAngularOutput(urls.adminBaseHref);

    prepareDist(urls, { rootDir: tempDir });

    const distBrowser = join(tempDir, "dist", "browser");

    // 1. Assets must land under dist/browser/admin/
    expect(existsSync(join(distBrowser, "admin", "main-abc12345.js"))).toBe(
      true,
    );
    expect(existsSync(join(distBrowser, "admin", "styles-xyz67890.css"))).toBe(
      true,
    );
    expect(existsSync(join(distBrowser, "admin", "i18n", "zh-TW.json"))).toBe(
      true,
    );
    expect(existsSync(join(distBrowser, "admin", "favicon.ico"))).toBe(true);

    // Root favicon also present
    expect(existsSync(join(distBrowser, "favicon.ico"))).toBe(true);

    // 2. index.html must ONLY exist in __admin/index.html
    expect(existsSync(join(distBrowser, "__admin", "index.html"))).toBe(true);
    expect(existsSync(join(distBrowser, "admin", "index.html"))).toBe(false);
    expect(existsSync(join(distBrowser, "index.html"))).toBe(false);

    // 3. config.json must NOT exist as a static asset (handled dynamically by Worker)
    expect(existsSync(join(distBrowser, "admin", "config.json"))).toBe(false);
    expect(existsSync(join(distBrowser, "config.json"))).toBe(false);

    // 4. build-meta.json must be written in __admin/
    expect(existsSync(join(distBrowser, "__admin", "build-meta.json"))).toBe(
      true,
    );
    const meta = JSON.parse(
      readFileSync(join(distBrowser, "__admin", "build-meta.json"), "utf8"),
    );
    expect(meta.basePath).toBe("/admin");
    expect(meta.rootReservedNames).toContain("admin");
    expect(meta.rootReservedNames).toContain("favicon.ico");

    // 5. _headers must be at the root of dist/browser and include rules for /__admin/* and /admin/*
    expect(existsSync(join(distBrowser, "_headers"))).toBe(true);
    const headers = readFileSync(join(distBrowser, "_headers"), "utf8");
    expect(headers).toContain("/__admin/*");
    expect(headers).toContain("/admin/*");
    expect(headers).toContain("/admin/config.json");
    expect(headers).toContain("Content-Security-Policy");
  });

  it("Scenario 2: Dedicated domain (empty admin base) layout", () => {
    const urls = resolveAppUrls({
      SHORT_LINK_URL: "https://zl.ink",
      ADMIN_URL: "https://admin.example.com",
    });
    expect(urls.adminBase).toBe("");
    expect(urls.adminBaseHref).toBe("/");

    setupMockAngularOutput(urls.adminBaseHref);

    prepareDist(urls, { rootDir: tempDir });

    const distBrowser = join(tempDir, "dist", "browser");

    // 1. Assets must land directly in dist/browser/
    expect(existsSync(join(distBrowser, "main-abc12345.js"))).toBe(true);
    expect(existsSync(join(distBrowser, "styles-xyz67890.css"))).toBe(true);
    expect(existsSync(join(distBrowser, "i18n", "zh-TW.json"))).toBe(true);
    expect(existsSync(join(distBrowser, "favicon.ico"))).toBe(true);

    // 2. index.html must ONLY exist in __admin/index.html (NEVER in dist/browser/index.html)
    expect(existsSync(join(distBrowser, "__admin", "index.html"))).toBe(true);
    expect(existsSync(join(distBrowser, "index.html"))).toBe(false);

    // 3. config.json must NOT exist as a static asset
    expect(existsSync(join(distBrowser, "config.json"))).toBe(false);

    // 4. build-meta.json must list all top-level root asset names in rootReservedNames
    const meta = JSON.parse(
      readFileSync(join(distBrowser, "__admin", "build-meta.json"), "utf8"),
    );
    expect(meta.basePath).toBe("");
    expect(meta.rootReservedNames).toContain("favicon.ico");
    expect(meta.rootReservedNames).toContain("i18n");
    expect(meta.rootReservedNames).toContain("main-abc12345.js");
    expect(meta.rootReservedNames).toContain("styles-xyz67890.css");
    // Internal files must not be in rootReservedNames
    expect(meta.rootReservedNames).not.toContain("__admin");
    expect(meta.rootReservedNames).not.toContain("_headers");

    // 5. _headers must include rules for /__admin/* and /*
    const headers = readFileSync(join(distBrowser, "_headers"), "utf8");
    expect(headers).toContain("/__admin/*");
    expect(headers).toContain("/*");
    expect(headers).toContain("/config.json");
  });

  it("Scenario 3: Subpath on same domain (/zlink) layout", () => {
    const urls = resolveAppUrls({
      SHORT_LINK_URL: "https://example.com/s",
      ADMIN_URL: "https://example.com/zlink",
    });
    expect(urls.adminBase).toBe("/zlink");
    expect(urls.adminBaseHref).toBe("/zlink/");

    setupMockAngularOutput(urls.adminBaseHref);

    prepareDist(urls, { rootDir: tempDir });

    const distBrowser = join(tempDir, "dist", "browser");

    // 1. Assets must land under dist/browser/zlink/
    expect(existsSync(join(distBrowser, "zlink", "main-abc12345.js"))).toBe(
      true,
    );
    expect(existsSync(join(distBrowser, "zlink", "styles-xyz67890.css"))).toBe(
      true,
    );
    expect(existsSync(join(distBrowser, "zlink", "i18n", "zh-TW.json"))).toBe(
      true,
    );

    // 2. index.html must ONLY exist in __admin/index.html
    expect(existsSync(join(distBrowser, "__admin", "index.html"))).toBe(true);
    expect(existsSync(join(distBrowser, "zlink", "index.html"))).toBe(false);
    expect(existsSync(join(distBrowser, "index.html"))).toBe(false);

    // 3. build-meta.json
    const meta = JSON.parse(
      readFileSync(join(distBrowser, "__admin", "build-meta.json"), "utf8"),
    );
    expect(meta.basePath).toBe("/zlink");

    // 4. _headers must include rules for /__admin/* and /zlink/*
    const headers = readFileSync(join(distBrowser, "_headers"), "utf8");
    expect(headers).toContain("/__admin/*");
    expect(headers).toContain("/zlink/*");
    expect(headers).toContain("/zlink/config.json");
  });
});
