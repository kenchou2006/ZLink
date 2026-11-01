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

## 三、 管理介面路徑設計理由 (`/admin/*`)

在整合後的單一 Worker 架構中，我們將 Angular 管理介面配置於 `/admin/*`，而非根目錄 `/`：

1. **避免短網址短碼命名衝突**：
   短網址的轉址核心熱路徑為 `GET /{code}` 與根目錄 `GET /`（自動對齊首頁短網址 `@root`）。若前端掛載於根目錄，前端的所有內部頁面路由（例如 `/login`, `/dashboard`, `/links`, `/users`, `/profile`）皆會與使用者自訂之短網址產生歧義衝突。
2. **靜態資產與動態轉址的最佳效能分離**：
   Angular 設定 `baseHref: "/admin/"`，打包成果輸出至 `dist/browser/admin/`。前端所需的各類靜態檔案（JS、CSS、i18n 多國語系 JSON 等）會被 Cloudflare 邊緣靜態快取直接命中回傳，完全不消耗 Worker 的 CPU 運算配額；若使用者在瀏覽器直接重新整理 SPA 路由，Worker 會將其優雅回退（Fallback）至 `/admin/index.html`。
3. **保留字安全防護**：
   系統已將 `admin`、`api`、`healthz`、`assets` 等字元列入保留字清單，任何試圖註冊保留字作為短網址別名的請求皆會被安全攔截。

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
SITE_ORIGIN=http://localhost:8787
```

### 3. 套用本地 D1 資料庫遷移
```bash
cd server
npm run db:migrate
```

### 4. 建立初始超級管理員帳號
使用專案腳本快速建立管理員：
```bash
cd server
npm run user:create admin admin@example.com MyAdminPassword123! -- --superuser
```

### 5. 同步建置並啟動服務
```bash
# 建置前端 SPA 並啟動本地 Wrangler Worker 開發伺服器（預設 Port 8787）
cd server
npm start
```
- 管理後台網址：[http://localhost:8787/admin/](http://localhost:8787/admin/)
- API 端點根路徑：[http://localhost:8787/api/](http://localhost:8787/api/)
- OpenAPI 互動文件：[http://localhost:8787/api/docs](http://localhost:8787/api/docs)（採用固定確切版本 `swagger-ui-dist@5.18.2` 並嚴格啟用 SHA-384 Subresource Integrity (SRI) 與 `crossorigin="anonymous"`，防範第三方 CDN 資源篡改風險）
- 健康檢查端點：[http://localhost:8787/healthz](http://localhost:8787/healthz)

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

### 1. 建立遠端 Cloudflare 資源
```bash
# 建立 D1 資料庫
npx wrangler d1 create zlink

# 建立 KV Namespace
npx wrangler kv namespace create KV
```
將回傳的 `database_id` 與 `id` 填寫於 Cloudflare 部署設定，或在 GitHub Actions CI/CD 環境變數中綁定。

### 2. 設定正式環境密鑰 (Secrets)
請勿在程式碼中提交真實密鑰，請透過 `wrangler secret put` 依序寫入：
```bash
cd server
npx wrangler secret put SECRET_KEY
npx wrangler secret put ALLOWED_ORIGINS
npx wrangler secret put WEBAUTHN_RP_ID
npx wrangler secret put SITE_ORIGIN
```

### 3. 套用正式環境資料庫遷移
```bash
cd server
npx wrangler d1 migrations apply zlink --remote
```

### 4. 建置前端並執行部署
```bash
# 建置前端 SPA 產物至 client/dist/browser
npm --prefix client run build

# 部署單一 Worker（包含 API 與 Static Assets）
cd server
npx wrangler deploy
```

---

## 七、 相關文件連結

- [ZLink 遷移與相容性指南 (`docs/migration.md`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/docs/migration.md)
- [後端進入點 (`server/src/index.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/index.ts)
- [資料庫 Schema (`server/src/db/schema.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/db/schema.ts)
- [轉址熱路徑實作 (`server/src/routes/redirect.ts`)](file:///Users/kenchou2006/Documents/GitHub/ZLink/ZLink/server/src/routes/redirect.ts)
