# 888desturl

`888desturl` 是一個用來追蹤網址最終目的地的工具，基於 Node.js、Fastify 與 Playwright（Headless Chromium）建構。它不只追蹤傳統 HTTP 3xx，還能處理 `meta refresh` 與 JavaScript 導向，現在也支援：

- 靜態轉址網址自動解包 (YouTube, Facebook, Google, Slack) 以加速追蹤並避免機器人阻擋
- YouTube 中介警告頁面（"Are you sure you want to leave YouTube?"）自動點擊繞過機制
- 短網址倒數中介頁面（如 888短網址系統、Sink、"Redirecting in X seconds..."、"Redirect Now"、"立即前往"）自動偵測與點擊穿透機制
- final-only Google Web Risk 檢查
- final 頁面截圖預覽
- 每次 trace 的獨立結果頁
- 可分享的結果頁 metadata 與結果頁連結複製
- 追蹤參數分析與可分享的乾淨網址（保留原始最終網址）
- **雙路線偵測 (Dual-Route Detection)**：
  - **路線 A**：Redirect Chain 追蹤、去追蹤參數（Clean URL）、安全檢查與即時截圖預覽。
  - **路線 B**：HTML to Markdown 頁面內容解析，直接提取最終頁面的純淨 Markdown 內文，支援一鍵複製與 [`2md.aiurl.tw`](https://2md.aiurl.tw) 深度閱讀。
- **毫秒（ms）時間記錄**：全鏈路記錄 `total_duration_ms` 總耗時，並在 Redirect Chain 的每一步標註單步耗時 `duration_ms` 與累計時間 `elapsed_ms`。
- 7 天預覽圖保留與自動清理
- browser localStorage 最近查詢紀錄
- SQLite server history / usage stats
- admin login 與 admin dashboard
- 可安裝的 PWA（Web App Manifest、桌面／行動裝置圖示、Service Worker）
- 支援純網域名稱自動補全（不需手動輸入 `http://` 或 `https://`，如 `david888.com`）
- 支援 Chrome WebMCP（Declarative HTML 表單標註與 `document.modelContext` / `navigator.modelContext` 命令式 API）
- 支援 Model Context Protocol (MCP) 與 Cloudflare WebMCP 整合（提供 `/mcp` 端點）
- 瀏覽器 AI Agent 直接調用（`trace_url`、`clean_url` 工具）
- GitHub Actions CI/CD 自動構建 Multi-Arch 映像檔（`linux/amd64`, `linux/arm64`）並推送至 Docker Hub (`tbdavid2019/888desturl`)，由 Watchtower 自動熱更新。

![alt text](image-1.png)
![alt text](image-2.png)
![alt text](image-3.png)
Live sites:

- `https://url.david888.com` (git.glsoft.ai)
- `https://url.create360.ai` (office.fanpokka.ai)


## 🚀 Docker 快速安裝與使用 (Docker Quickstart)

開發者可直接從 Docker Hub 拉取官方 Multi-Arch 映像檔（原生支援 `linux/amd64` 與 `linux/arm64`）：

### 1. 單行 Docker 指令啟動 (One-liner Run)

```bash
docker run -d \
  --name redirect-tracer \
  -p 3000:3000 \
  --shm-size=1gb \
  --restart unless-stopped \
  -v $(pwd)/data:/app/data \
  -e PORT=3000 \
  -e GOOGLE_WEB_RISK_API_KEY="" \
  -e ADMIN_USERNAME="admin" \
  -e ADMIN_PASSWORD="your-strong-password" \
  tbdavid2019/888desturl:latest
```

啟動後即可在瀏覽器開啟 `http://localhost:3000`。

### 2. 使用 Docker Compose 啟動

建立 `docker-compose.yml`：

```yaml
services:
  redirect-tracer:
    image: tbdavid2019/888desturl:latest
    container_name: redirect-tracer
    restart: unless-stopped
    ports:
      - "3000:3000"
    shm_size: 1gb
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - DATA_DIR=/app/data
      - PREVIEW_RETENTION_DAYS=7
      - HISTORY_RETENTION_DAYS=90
      - GOOGLE_WEB_RISK_API_KEY=${GOOGLE_WEB_RISK_API_KEY:-}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin_password}
    volumes:
      - ./data:/app/data

  watchtower:
    image: containrrr/watchtower:latest
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_POLL_INTERVAL=60
      - WATCHTOWER_CLEANUP=true
```

執行啟動：

```bash
docker compose up -d
```

### 3. 本地原始碼建置 (Build from Source)

```bash
docker compose up -d --build
```

Stop:

```bash
docker compose down
```

Current `docker-compose.yml` behavior:

- loads variables from `.env`
- mounts `./data` to `/app/data`
- keeps preview images and SQLite data outside the container layer

## Environment Variables

Example:

```dotenv
PORT=3000
HOST=0.0.0.0
DATA_DIR=./data
PREVIEW_RETENTION_DAYS=7
HISTORY_RETENTION_DAYS=90
GOOGLE_WEB_RISK_API_KEY=replace-with-your-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_SESSION_TTL_HOURS=24
```

Notes:

- `.env` is ignored by git
- `.env` is excluded from Docker build context
- preview images are stored under `DATA_DIR/previews`
- SQLite database is stored under `DATA_DIR/history.sqlite`

## API

### `GET /api/trace`

Full redirect diagnostics plus final-only security check and final-image preview URL.

Query:

- `url`: required full `http://` or `https://` URL
- `context`: optional, supports `line`

Response highlights:

```json
{
  "final_url": "https://example.com/final",
  "clean_url": "https://example.com/final",
  "removed_tracking_parameters": ["utm_source"],
  "input_url": "https://example.com/start",
  "result_id": "AbCdEf123456",
  "result_url": "https://url.david888.com/result/AbCdEf123456",
  "redirect_count": 2,
  "preview_url": "/previews/2026/05/30/abcd1234.jpg",
  "final_image_url": "/previews/2026/05/30/abcd1234.jpg",
  "security": {
    "status": "safe",
    "source": "google_webrisk",
    "checked_url": "https://example.com/final",
    "checked_at": "2026-05-30T08:00:00.000Z",
    "message": "No Google Web Risk match was found for the final destination.",
    "threat_types": []
  },
  "chain": []
}
```

If the browser UI calls this endpoint, it sets header `x-888desturl-client: web`. Other callers are stored as `api` traffic in server history by default.

### Final URL tracking-parameter analysis

Every JSON trace result provides both the literal final destination and an optional copy-friendly version:

- `final_url`: the exact final URL observed by Playwright. It remains the trace record and the URL used for Google Web Risk checks.
- `clean_url`: the same URL with only recognised tracking parameters removed. It is `null` when no final URL is available.
- `removed_tracking_parameters`: names of parameters removed from `clean_url`; values are intentionally not returned. It is an empty array when nothing was removed.

The cleaner is deliberately conservative. It removes common identifiers such as `utm_*`, `fbclid`, `gclid`, `dclid`, `msclkid`, `_ga`, `_gl`, `igshid`, `mibextid`, `mc_cid`, and `mc_eid`. For `threads.com` it also removes `xmt` and `slof`. Other parameters, including `id`, `token`, `state`, and `ref`, are preserved because they can affect destination behaviour.

When tracking parameters were removed, the web UI presents `clean_url` as the single recommended share action. The original final URL remains visible and can still be opened for diagnostics.

### `GET /api/final`

Final destination only.

Query:

- `url`: required full `http://` or `https://` URL
- `format`: optional, default `text`, supports `json`
- `context`: optional, supports `line`

`format=json` also includes:

- `result_id`
- `result_url`
- `clean_url`
- `removed_tracking_parameters`
- `preview_url`
- `final_image_url`
- `security`

The default `text` response remains the literal `final_url` for CLI compatibility.

### `GET /api/f`

Short CLI alias for `/api/final`.

### `GET /ai-agent-skill`

Returns a Markdown skill document for the current deployment host. It documents the trace endpoints and instructs agents to present `clean_url` as the copy-friendly URL whenever `removed_tracking_parameters` is non-empty.

### `GET /api/results/:resultId`

Public result lookup for one previously recorded trace result.

Use this when:

- you want to render a standalone result page
- you want to revisit one trace later
- you want a shareable detail URL without re-running the trace

Response includes:

- `result_id`
- `result_url`
- `created_at`
- `input_url`
- `final_url`
- `clean_url` and `removed_tracking_parameters` (the copy-friendly URL analysis; the literal final URL is preserved)
- `preview_url`
- `final_image_url`
- `security`
- `security_status`
- `chain`

Compatibility note:

- `security_status`, `security_message`, `security_checked_url`, and `threat_types` are still returned for existing clients
- new clients should prefer the nested `security` object

### `GET /api/results/:resultId/final-image`

Public final-image lookup for one stored trace result.

Response includes:

- `result_id`
- `available`
- `status`
- `final_image_url`
- `image_url`
- `mime_type`

If the trace result still exists but the preview image has already expired, this endpoint returns `available: false` and `status: "unavailable"`.

### `GET /api/results/:resultId/web-risk`

Public Web Risk lookup result for one stored trace result.

Response includes:

- `result_id`
- `security`

### `GET /health`

Health check:

```json
{
  "ok": true,
  "storage_enabled": true,
  "web_risk_enabled": true
}
```

## Admin

Admin page:

- `GET /admin`

Admin APIs:

- `GET /api/admin/session`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/stats`
- `GET /api/admin/history`

Security behavior:

- login is controlled by `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- login attempts are limited to 3 per 5 minutes per IP
- authenticated admin access uses an HttpOnly cookie session

Current limitation:

- admin sessions are stored in memory
- restarting the service logs out admin users
- multi-instance deployments would need shared session storage later

## Result Pages

Every stored trace result now gets a stable `result_id`.

Public result URLs:

- `GET /result/:resultId`
- `GET /r/:resultId`

Behavior:

- the page reads data from `GET /api/results/:resultId`
- the result page includes shareable metadata for social previews
- the result page can copy its own standalone URL
- admin history links directly to the standalone result page
- preview images may disappear after the preview retention window
- the result row itself remains available until history retention removes it
- if the history record expires, the result page returns not found

## Model Context Protocol (MCP) & WebMCP

`888desturl` 提供符合 MCP JSON-RPC 2.0 規範的 `/mcp` 端點，支援 Cloudflare WebMCP 自動化橋接與外部 MCP 用戶端。

- **Endpoint**: `POST /mcp`、`GET /mcp`、`OPTIONS /mcp`
- **Protocol Version**: `2024-11-05`
- **Cloudflare WebMCP**: 於 Cloudflare Dashboard 開啟 WebMCP 後，`mcp-server-client` pack 會自動將此端點的工具註冊至訪客瀏覽器的 `document.modelContext`。

### 支援的 MCP 工具 (Tools)

1. `trace_url`:
   - 完整追蹤網址轉址歷程（HTTP 3xx、meta refresh、JavaScript 導向）
   - 自動解包 YouTube/FB/Google/Slack 靜態轉址、Google Web Risk 安全檢查、清理追蹤參數
   - 參數：`url` (string, 必要), `context` (string: `"default"` | `"line"`, 選填)
2. `clean_url`:
   - 快速解析並移除行銷/追蹤參數（如 `utm_*`、`fbclid`、`gclid`、`xmt` 等）
   - 參數：`url` (string, 必要)

### 呼叫範例

```bash
# 查詢 MCP 工具清單
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 調用 trace_url 工具
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trace_url","arguments":{"url":"https://short.link/xyz"}}}'
```

## Retention

- preview screenshots: 7 days by default
- server history: 90 days by default
- cleanup runs at startup and every 12 hours

When a preview expires:

- the image file is deleted
- the history row remains, but `preview_url` is cleared

## Main Files

```text
├── .env.example
├── CHANGELOG.md
├── Dockerfile
├── docker-compose.yml
├── lib/
│   ├── admin-auth.js
│   ├── env.js
│   ├── mcp.js
│   ├── storage.js
│   └── url-cleaner.js
├── package.json
├── public/
│   ├── admin.html
│   ├── index.html
│   └── result.html
├── test/
│   ├── mcp.test.js
│   └── pwa.test.js
└── server.js
```
