# 888desturl

`888desturl` 是一個用來追蹤網址最終目的地的工具，基於 Node.js、Fastify 與 Playwright（Headless Chromium）建構。它不只追蹤傳統 HTTP 3xx，還能處理 `meta refresh` 與 JavaScript 導向。

Live site:

- `https://url.create360.ai`

## Features

- Trace HTTP redirects, `meta refresh`, and JavaScript navigation
- Return the final destination URL quickly for CLI usage
- Provide the full redirect chain for debugging
- Serve a bilingual web UI with browser-language detection
- Generate an AI-agent skill document dynamically from the current host

## Stack

- Backend: Node.js, Fastify, Playwright
- Frontend: HTML, Vanilla JavaScript, Tailwind CSS via CDN
- Deployment: Docker, Docker Compose

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Install Playwright Chromium locally if needed:

```bash
npx playwright install chromium
```

3. Start the app:

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

## API

### `GET /api/trace`

Full redirect diagnostics.

Query:

- `url`: required full `http://` or `https://` URL
- `context`: optional, supports `line` for LINE-like mobile tracing

Response:

```json
{
  "final_url": "https://example.com/final",
  "input_url": "https://example.com/start",
  "redirect_count": 2,
  "terminated_reason": "completed",
  "terminated_message": null,
  "loop_detected": false,
  "chain": [
    {
      "step": 1,
      "url": "https://example.com/start",
      "from_url": null,
      "type": "initial",
      "status_code": 200,
      "status_text": "OK",
      "method": "GET",
      "duration_ms": 18
    }
  ]
}
```

Use this when you need the full chain.

LINE context example:

```bash
curl -s "https://url.create360.ai/api/trace?url=https://maac.io/6oqDe/jNGkx&context=line"
```

Safety behavior:

- Invalid URLs are rejected before tracing starts
- Tracing stops after 15 seconds
- Tracing stops after 20 navigation steps
- Repeating URL visits and repeating redirect transitions are treated as loop signals
- Partial results include:
  - `terminated_reason`
  - `terminated_message`
  - `loop_detected`

Common termination and error codes:

- `completed`
- `timeout`
- `redirect_loop`
- `max_redirect_steps`
- `invalid_url`
- `dns_error`
- `connection_refused`
- `ssl_error`
- `trace_failed`

### `GET /api/final`

Final destination only.

Query:

- `url`: required full `http://` or `https://` URL
- `format`: optional, default `text`, supports `json`
- `context`: optional, supports `line`

Examples:

```bash
curl -s "https://url.create360.ai/api/final?url=https://aiurl.tw/104"
```

```text
https://calendly.com/david360ai/45min?month=2026-05
```

```bash
curl -s "https://url.create360.ai/api/final?url=https://aiurl.tw/104&format=json"
```

```bash
curl -s "https://url.create360.ai/api/final?url=https://maac.io/6oqDe/jNGkx&context=line&format=json"
```

```json
{
  "final_url": "https://calendly.com/david360ai/45min?month=2026-05",
  "input_url": "https://aiurl.tw/104",
  "redirect_count": 2,
  "terminated_reason": "completed",
  "terminated_message": null,
  "loop_detected": false
}
```

Use this when you want a cleaner CLI response.

If tracing stops early but still has a best-known destination, text mode returns the final URL and a warning line explaining why the trace stopped.

### `GET /api/f`

Short CLI alias for `/api/final`.

Examples:

```bash
curl -s "https://url.create360.ai/api/f?url=https://aiurl.tw/104"
```

```bash
curl -s "https://url.create360.ai/api/f?url=https://aiurl.tw/104&format=json"
```

```bash
curl -s "https://url.create360.ai/api/f?url=https://maac.io/6oqDe/jNGkx&context=line"
```

### `GET /ai-agent-skill`

Returns a dynamic markdown skill document generated from the current request host.

Example:

- On `https://url.create360.ai`, the generated skill uses `https://url.create360.ai`
- On `https://url.david888.com`, the generated skill will automatically use `https://url.david888.com`

This avoids hardcoded deployment domains.

### `GET /health`

Health check:

```json
{ "ok": true }
```

## UI Notes

- The web UI auto-detects the browser language
- Traditional Chinese is selected for `zh-*` browsers
- English is selected otherwise
- The footer `AI Agent Skills` link opens the live dynamic skill in a new tab

## Main Files

```text
├── CHANGELOG.md
├── Dockerfile
├── docker-compose.yml
├── package.json
├── public/
│   └── index.html
└── server.js
```
