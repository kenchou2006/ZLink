# ZLink (Cloudflare Workers 前後端整合版)

ZLink 是一套高可用、低延遲的企業級短網址管理系統。本專案將原先分散的系統（Django REST Framework 管理 API、Angular 20 管理介面、Go 轉址轉接器）全面改寫並整合為單一 **Cloudflare Worker** 應用，實現同網域提供靜態管理後台、RESTful 管理 API、全球分散式短網址轉址、KV 快取與防護機制。

---

## 一、 系統架構圖

```mermaid
flowchart TD
    subgraph ClientLayer ["用戶端層 (Clients)"]
        UserBrowser["使用者瀏覽器 (短網址造訪)"]
        AdminUser["管理人員 (Angular SPA 後台)"]
        LineBot["ZLink Line Bot / API 客戶端"]
    end

    subgraph CFEdge ["Cloudflare 全球邊緣網路 (Single Worker)"]
        WorkerEntry["Cloudflare Worker Entrypoint (Hono)"]
        Assets["Workers Static Assets (/admin/*)"]
        RedirectPath["轉址熱路徑 (GET /{code} & GET /)"]
        AdminAPI["管理 API (/api/*)"]
        DO["Durable Objects (RateLimiter)"]
    end

    subgraph StorageLayer ["儲存與外部服務 (Cloudflare & Google)"]
        KV["Cloudflare KV (轉址快速快取)"]
        D1["Cloudflare D1 (關聯資料庫 SQLite)"]
        GA4["Google Analytics 4 (Measurement Protocol)"]
    end

    UserBrowser -->|GET /{code}| RedirectPath
    AdminUser -->|造訪後台| Assets
    AdminUser -->|API 呼叫| AdminAPI
    LineBot -->|X-API-Key| AdminAPI

    WorkerEntry --> Assets
    WorkerEntry --> RedirectPath
    WorkerEntry --> AdminAPI

    AdminAPI -->|限流檢查| DO
    AdminAPI -->|資料存取| D1
    AdminAPI -->|快取無效化| KV

    RedirectPath -->|1. 查詢快取| KV
    RedirectPath -->|2. 未命中查庫| D1
    RedirectPath -->|3. 回填快取| KV
    RedirectPath -.->|4. ctx.waitUntil 非同步上報| GA4
```

---

## 二、 Cloudflare 服務綁定表 (Bindings)

在 [`wrangler.jsonc`](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/wrangler.jsonc) 中設定以下資源綁定（皆不寫死環境資源 ID，符合正式環境動態指派）：

| 綁定名稱 (Binding) | 資源類型 (Type) | 用途與說明 |
| :--- | :--- | :--- |
| `DB` | Cloudflare D1 Database | 儲存核心資料（短網址資料表 `links`、使用者 `users`、帳號設定 `profiles`、API 金鑰 `api_keys`、Passkeys `passkeys`、憑證輪替黑名單 `refresh_tokens`）。 |
| `KV` | Cloudflare KV Namespace | 存放短網址轉址快速快取，採用 `:0:shortener:url:{code}` 格式，支援自訂與過期 TTL，實現邊緣幾毫秒內的極速轉址。 |
| `RATE_LIMITER` | Cloudflare Durable Objects | 提供原子計數器防護，針對敏感端點（登入、Passkey 挑戰、短網址新增）進行固定時間窗口精確頻率限制。 |
| `ASSETS` | Workers Static Assets | 掛載位於 `../client/dist/browser` 之 Angular 20 前端打包檔案，提供同源免伺服器之靜態資源加速。 |

---

## 三、 網域與路徑分離架構設計

ZLink 支援同一份建置部署於**根網域**或**子路徑**，並支援**短網址網域**與**管理網址**完全分離（同一個 Worker 處理）：

### 1. URL 變數設定
使用兩個完整 URL 變數取代舊有的 `SITE_ORIGIN`（保留 `SITE_ORIGIN` 作為向下相容：只設它時等同兩者同網域、管理介面在 `/admin`）：
- `SHORT_LINK_URL`：短網址服務公開位置，例如 `https://zl.ink` 或 `https://example.com/s`。
  - `GET <short base>/` → 轉址至首頁短網址 `@root`
  - `GET <short base>/{code}` → 轉址至目標網址
  - API 回傳之 `short_url` 一律由此變數組出。
- `ADMIN_URL`：管理介面位置，例如 `https://admin.example.com`、`https://example.com/zlink`，或預設 `<SHORT_LINK_URL>/admin`。
  - 管理 SPA 在 `<admin base>/`
  - 管理 API 在 `<admin base>/api/*`
  - OpenAPI 互動文件在 `<admin base>/api/docs`

### 2. 請求分派機制（最長前綴優先）
1. **命中 `ADMIN_URL`**（hostname 相同且路徑在 `<admin base>` 底下）：
   - 提供管理 SPA、動態 `config.json`（回傳 `apiBase: "<admin base>/api"`，`Cache-Control: no-store`）與 RESTful API。
   - 前端靜態資產（JS/CSS/字型/i18n）在建置時即依照 `ADMIN_URL` 輸出於 `<admin base>/` 底下，由 Cloudflare Workers Static Assets「直接」回應（不經 Worker 轉發、不計入 Worker 請求配額）。
   - 前端 `index.html` 存放於內部路徑 `/__admin/index.html`，由 Worker 經 `HTMLRewriter` 動態改寫 `<base href>` 回傳。
   - 若存取 `<admin base>`（無結尾斜線），自動回傳 301 轉址至 `<admin base>/`。
   - **Base Path 一致性檢查**：Worker 於處理請求時會讀取建置產生的 `build-meta.json`；若執行時的 `ADMIN_URL` 與建置時的前端 base path 不符，HTML 請求會回傳 500 錯誤並於 console.error 提示「改了 URL 要重新建置前端」。
2. **命中 `SHORT_LINK_URL`**（hostname 相同且路徑在 `<short base>` 底下）：
   - 僅提供短網址轉址功能。在短網址網域上，`/api`、`/admin`、`/__admin` 等不得暴露管理功能（一律回傳 404 頁）。
   - 當 admin base 為空（獨立網域部署）時，建置自動將資產根目錄頂層名稱（如 `i18n`、`favicon.ico` 等）寫入 `build-meta.json` 並納入短碼保留字，避免短碼與靜態資源衝突。
   - 若存取 `<short base>`（無結尾斜線且非根目錄），自動回傳 301 轉址至 `<short base>/`。
   - 短網址轉址路徑絕不設定任何 Cookie。
3. **都不符合**：
   - 回傳 404 頁面。

### 3. 安全與整合規範
- **動態保留字檢查**：系統自動將 `admin base` 在短網址路徑下的第一段（例如 `ADMIN_URL = SHORT_LINK_URL + /manage` 時之 `manage`）以及內部資產目錄 `__admin` 列入保留字清單，在建立或修改短網址時進行防護檢查。
- **身分驗證與 Cookie**：WebAuthn RP ID（預設為 hostname）、WebAuthn Expected Origin、CSRF 允許來源與 Session Cookie 均只依 `ADMIN_URL` 判定；`__Host-zl_at` Access Cookie 維持 `Path=/`，`__Secure-zl_rt` Refresh Cookie 的 Path 自動設為 `<admin base>/api/auth/`。
- **ZLinkLineBot 整合**：LINE Bot 等外部系統透過 `<api_base>` 與 `X-API-Key` 呼叫 API 時，`api_base` 必須設定為 `<ADMIN_URL>/api`（例如 `https://admin.example.com/api` 或 `https://example.com/zlink/api`）。

---

## 四、 本機開發指南 (Local Development)

### 系統需求
- Node.js >= 20
- npm >= 10

### 1. 安裝前後端相依套件
```bash
# 安裝前端相依
cd client && npm install

# 安裝後端 Worker 相依
cd ../server && npm install
```

### 2. 環境變數設定
在 `server/` 資料夾下建立 `.dev.vars`（可由 `.dev.vars.example` 複製）：
```bash
cp server/.dev.vars.example server/.dev.vars
```
重要參數範例：
```env
ENVIRONMENT=development
SECRET_KEY=dev-secret-key-replace-with-at-least-32-characters-for-security
ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200,http://localhost:8787
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=ZLink
SHORT_LINK_URL=http://localhost:8787
ADMIN_URL=http://localhost:8787/admin
# 向下相容：SITE_ORIGIN=http://localhost:8787
```

### 3. 套用本地 D1 資料庫遷移
```bash
cd server
npm run db:migrate
```

### 4. 建立超級管理員帳號

使用專案腳本直接寫入 D1 資料庫（跳過啟用信流程，立即啟用）：

```bash
# 建立超級管理員（superuser：具備所有權限與使用者管理）
npm --prefix server run user:create -- admin --email admin@example.com --superuser

# 建立一般管理員（staff：可管理短網址）
npm --prefix server run user:create -- staffuser --email staff@example.com --staff

# 寫入正式環境 D1（加 --remote）
npm --prefix server run user:create -- admin --email admin@example.com --superuser --remote
```

- **密碼安全詢問**：執行時會以不回顯（不顯示字元）的方式詢問兩次密碼，防範肩窺；在 CI/CD 或自動化腳本等非互動環境中，可改設定環境變數 `CREATE_USER_PASSWORD`。密碼絕對不會出現在指令參數、Shell 歷史紀錄或日誌中。
- **重複執行＝重設密碼**：對同一個使用者名稱（`username`）再次執行指令，即為重設密碼並重新啟用帳號；只有在指令中明確附加角色旗標（`--staff` 或 `--superuser`）時才會變更該使用者的角色，否則維持原先既有角色。
- **一致性雜湊**：密碼雜湊採用與伺服器執行階段完全一致的 [`src/lib/crypto.ts`](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/lib/crypto.ts)（PBKDF2-SHA256），確保本機建立與正式登入檢驗完全吻合。

### 5. 同步建置並啟動服務
```bash
# 本地開發建置（套用 .dev.vars，輸出於正確 base 下）並啟動 Wrangler Worker 開發伺服器
cd server
npm start
```
- 本機建置前端指令：`npm run build:fe:local`（套用 `server/.dev.vars` 中的 URL）
- 正式建置前端指令：`npm run build:fe`（套用 `server/wrangler.jsonc` 中的 URL）
- 管理後台網址：[http://localhost:8787/admin/](http://localhost:8787/admin/)
- API 端點根路徑：[http://localhost:8787/api/](http://localhost:8787/api/)
- OpenAPI 互動文件：[http://localhost:8787/api/docs](http://localhost:8787/api/docs)
- 健康檢查端點：[http://localhost:8787/healthz](http://localhost:8787/healthz)

> [!IMPORTANT]
> **變更 URL 後必須重新建置前端**：
> 前端靜態檔案的路徑落點與 `baseHref` 是在建置階段決定的。若您在 `.dev.vars` 或 `wrangler.jsonc` 中修改了 `ADMIN_URL`，必須重新執行 `npm run build:fe:local` 或 `npm run build:fe`；若未重新建置，Worker 會比對 `build-meta.json` 並回傳 500 錯誤。
> 執行 `npm run deploy` 腳本時會自動先執行 `build:fe`，確保正式環境的前端與設定完全同步。

---

## 五、 測試與程式碼驗證 (Verification)

本專案配置完整的自動化測試與靜態檢查，包含重現舊 Django 單元測試（含 short_code 重複、保留字阻擋、API Key 管理權限、到期檢查、快取清理）與額外安全測試（未授權防護、越權阻擋、Rate Limiting 限流、XSS 惡意 URL 阻絕、CSRF 檢查等）：

```bash
# 後端檢查與 Vitest 測試（56 項測試完整通過）
cd server
npm run typecheck
npm run format:check
npm test

# 前端 Angular 建置檢查
cd ../client
npm run build
```

---

## 六、 生產環境部署指南 (Deployment)

> [!NOTE]
> 部署前請確認已在 Cloudflare Dashboard 或透過 Wrangler 建立正式之 D1 資料庫與 KV Namespace。

### 1. 部署模式與 `wrangler.jsonc` 設定範例

ZLink 支援兩種部署形式，同一份前端與後端建置產物可直接透過 `wrangler.jsonc` 切換，無須重新編譯前端：

#### 範例 A：自訂網域部署（Custom Domain，短網址與管理介面分開）
適用於獨立網域或子網域（如短網址 `https://zl.ink`，管理介面 `https://admin.example.com`）：

```jsonc
{
  "name": "zlink",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../client/dist/browser",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": ["/api/*", "/__admin/*"]
  },
  // 使用 custom_domain: true 綁定各獨立網域
  "routes": [
    { "pattern": "zl.ink", "custom_domain": true },
    { "pattern": "admin.example.com", "custom_domain": true }
  ],
  "vars": {
    "ENVIRONMENT": "production",
    "SHORT_LINK_URL": "https://zl.ink",
    "ADMIN_URL": "https://admin.example.com",
    "WEBAUTHN_RP_NAME": "ZLink"
  }
}
```

#### 範例 B：Workers Route 網域子路徑部署（Zone Route，如掛載於主站路徑）
適用於將短網址與管理後台掛載於既有網站的子路徑下（如短網址 `https://example.com/s/*`，管理介面 `https://example.com/otp/*`）：

```jsonc
{
  "name": "zlink",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../client/dist/browser",
    "binding": "ASSETS",
    "html_handling": "none",
    "not_found_handling": "none",
    "run_worker_first": ["/api/*", "/__admin/*"]
  },
  // 使用 pattern + zone_name 路由至指定子路徑
  "routes": [
    { "pattern": "example.com/s*", "zone_name": "example.com" },
    { "pattern": "example.com/otp*", "zone_name": "example.com" }
  ],
  "vars": {
    "ENVIRONMENT": "production",
    "SHORT_LINK_URL": "https://example.com/s",
    "ADMIN_URL": "https://example.com/otp",
    "WEBAUTHN_RP_NAME": "ZLink"
  }
}
```

> [!TIP]
> **Static Assets 直接回應最佳實踐**：
> 1. **全情境直接回應**：在根網域與子路徑兩種部署模式下，建置腳本皆已將前端檔案打包輸出至符合公開請求的路徑（如 `/otp/main-xxx.js` 實際存放於 `dist/browser/otp/main-xxx.js`），由 Workers Static Assets 於邊緣節點直接回應，**靜態資產請求完全不計入 Worker 請求配額**。
> 2. **資產配置與 Worker 路由**：`wrangler.jsonc` 設定 `html_handling: "none"`、`not_found_handling: "none"` 與 `run_worker_first: ["/api/*", "/__admin/*"]`，確保只有 API 與 SPA 深層路由交由 Worker 處理。

### 2. 建立遠端 Cloudflare 資源
```bash
# 建立 D1 資料庫
npx wrangler d1 create zlink

# 建立 KV Namespace
npx wrangler kv namespace create KV
```
將回傳的 `database_id` 與 `id` 填寫於 Cloudflare 部署設定，或在 GitHub Actions CI/CD 環境變數中綁定。

### 3. 設定正式環境密鑰 (Secrets)
請勿在程式碼中提交真實密鑰，請透過 `wrangler secret put` 依序寫入：
```bash
cd server
npx wrangler secret put SECRET_KEY
npx wrangler secret put ALLOWED_ORIGINS
npx wrangler secret put WEBAUTHN_RP_ID
# 可選：若未於 wrangler.jsonc 設定 URL，亦可透過 secret 設定
# npx wrangler secret put SHORT_LINK_URL
# npx wrangler secret put ADMIN_URL
```

選用設定：`REDIRECT_CACHE_TTL`（秒）讓瀏覽器快取 302 轉址，預設 0（`no-store`，修改連結後立即生效）。可寫在 `wrangler.jsonc` 的 `vars`。

### 4. 正式環境一鍵部署 (Recommended)
`server/package.json` 提供一鍵部署腳本 `npm run deploy`，會依序自動執行前端正式建置（`build:fe`）、遠端資料庫遷移（D1 migrations apply --remote）與 Worker 部署：
```bash
cd server
npm run deploy
```

若需手動逐步執行：
```bash
# 1. 依照 wrangler.jsonc 設定正式建置前端
npm --prefix ../client run build

# 2. 套用正式環境資料庫遷移
npm run db:migrate -- --remote

# 3. 部署單一 Worker（包含 API 與 Static Assets）
npx wrangler deploy
```

---

## 七、 相關文件連結

- [ZLink 遷移與相容性指南 (`docs/migration.md`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/docs/migration.md)
- [後端進入點 (`server/src/index.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/index.ts)
- [資料庫 Schema (`server/src/db/schema.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/db/schema.ts)
- [轉址熱路徑實作 (`server/src/routes/redirect.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/routes/redirect.ts)
