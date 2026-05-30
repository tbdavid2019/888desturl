# 888desturl

`888desturl` 是一個用來追蹤網址最終目的地的工具，基於 Node.js、Fastify 與 Playwright（Headless Chromium）建構。它不只追蹤傳統 HTTP 3xx，還能處理 `meta refresh` 與 JavaScript 導向，現在也支援：

- final-only Google Web Risk 檢查
- final 頁面截圖預覽
- 每次 trace 的獨立結果頁
- 7 天預覽圖保留與自動清理
- browser localStorage 最近查詢紀錄
- SQLite server history / usage stats
- admin login 與 admin dashboard

![alt text](image-1.png)
![alt text](image-2.png)
![alt text](image-3.png)
Live site:

- `https://url.david888.com`


## Stack

- Backend: Node.js, Fastify, Playwright
- Storage: SQLite
- Frontend: HTML, Vanilla JavaScript, Tailwind CSS via CDN
- Deployment: Docker, Docker Compose

## First-Time Setup

### 1. Prepare env

複製 `.env.example` 成 `.env`，再填入你的設定值：

```bash
cp .env.example .env
```

必要欄位：

- `GOOGLE_WEB_RISK_API_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

建議欄位：

- `DATA_DIR=./data`
- `PREVIEW_RETENTION_DAYS=7`
- `HISTORY_RETENTION_DAYS=90`

### 2. Install dependencies

```bash
npm install
```

這一步會安裝 `playwright` 與 `sqlite3`。

### 3. Install Playwright Chromium locally if needed

```bash
npx playwright install chromium
```

### 4. Start the app

```bash
npm start
```

Open `http://localhost:3000`.

## Docker

Build and run:

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

Full redirect diagnostics plus final-only security check and preview URL.

Query:

- `url`: required full `http://` or `https://` URL
- `context`: optional, supports `line`

Response highlights:

```json
{
  "final_url": "https://example.com/final",
  "input_url": "https://example.com/start",
  "result_id": "AbCdEf123456",
  "result_url": "https://url.david888.com/result/AbCdEf123456",
  "redirect_count": 2,
  "preview_url": "/previews/2026/05/30/abcd1234.jpg",
  "security": {
    "status": "safe",
    "source": "google_webrisk",
    "checked_url": "https://example.com/final",
    "checked_at": "2026-05-30T08:00:00.000Z",
    "message": "No Google Web Risk match was found for the final destination."
  },
  "chain": []
}
```

If the browser UI calls this endpoint, it sets header `x-888desturl-client: web`. Other callers are stored as `api` traffic in server history by default.

### `GET /api/final`

Final destination only.

Query:

- `url`: required full `http://` or `https://` URL
- `format`: optional, default `text`, supports `json`
- `context`: optional, supports `line`

`format=json` also includes:

- `result_id`
- `result_url`
- `preview_url`
- `security`

### `GET /api/f`

Short CLI alias for `/api/final`.

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
- `preview_url`
- `security_status`
- `chain`

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
- preview images may disappear after the preview retention window
- the result row itself remains available until history retention removes it
- if the history record expires, the result page returns not found

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
│   └── storage.js
├── package.json
├── public/
│   ├── admin.html
│   ├── index.html
│   └── result.html
└── server.js
```
