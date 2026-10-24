const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { chromium } = require('playwright');
const { loadEnvFile } = require('./lib/env');
const { createHistoryStore } = require('./lib/storage');
const { createAdminAuth } = require('./lib/admin-auth');
const { analyzeUrl, normalizeUrl } = require('./lib/url-cleaner');
const { extractPageMarkdown } = require('./lib/html-to-md');
const { createMcpHandler } = require('./lib/mcp');
const { detectTechnologies, extractPageTechSignals } = require('./lib/tech-detector');
loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TRACE_TIMEOUT_MS = 15000;
const SETTLE_WINDOW_MS = 1200;
const MAX_REDIRECT_STEPS = 20;
const MAX_REPEAT_URL_VISITS = 3;
const MAX_REPEAT_TRANSITIONS = 2;
const MAX_LINE_INTERMEDIATE_CLICKS = 2;
const MAX_SHORTLINK_INTERMEDIATE_CLICKS = 3;
const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PREVIEW_RETENTION_DAYS = Number(process.env.PREVIEW_RETENTION_DAYS || 7);
const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS || 90);
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || './data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PREVIEW_DIR = path.join(DATA_DIR, 'previews');
const WEB_RISK_API_KEY = process.env.GOOGLE_WEB_RISK_API_KEY || '';
const WEB_RISK_THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const LINE_IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.8.0';

const app = Fastify({
  logger: true,
  trustProxy: true
});

let historyStore = null;
const resultTemplatePath = path.join(PUBLIC_DIR, 'result.html');

fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const adminAuth = createAdminAuth({
  username: process.env.ADMIN_USERNAME || '',
  password: process.env.ADMIN_PASSWORD || '',
  sessionTtlMs: Number(process.env.ADMIN_SESSION_TTL_HOURS || 24) * 60 * 60 * 1000
});

app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  if (request.raw.url && request.raw.url.startsWith('/admin')) {
    reply.header('X-Frame-Options', 'DENY');
  } else {
    reply.header('X-Frame-Options', 'SAMEORIGIN');
  }
});

app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/'
});

app.register(fastifyStatic, {
  root: PREVIEW_DIR,
  prefix: '/previews/',
  decorateReply: false
});

function isBlockedTarget(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();

    if (
      host === '169.254.169.254' ||
      host === '169.254.170.2' ||
      host === '100.100.100.200' ||
      host === 'metadata.google.internal' ||
      host === 'metadata.internal' ||
      host === '[fd00:ec2::254]' ||
      host === 'fd00:ec2::254'
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isValidResultId(resultId) {
  return typeof resultId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(resultId);
}

function unwrapRedirectUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    // YouTube redirect
    if ((hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) && parsed.pathname === '/redirect') {
      const q = parsed.searchParams.get('q');
      if (q && (q.startsWith('http://') || q.startsWith('https://'))) {
        return q;
      }
    }

    // Facebook redirect
    if ((hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) && parsed.pathname === '/l.php') {
      const u = parsed.searchParams.get('u');
      if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
        return u;
      }
    }

    // Google redirect
    if ((hostname === 'google.com' || hostname.endsWith('.google.com')) && parsed.pathname === '/url') {
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (q && (q.startsWith('http://') || q.startsWith('https://'))) {
        return q;
      }
    }

    // Slack redirect
    if (hostname === 'slack-redir.net' && parsed.pathname === '/link') {
      const urlParam = parsed.searchParams.get('url');
      if (urlParam && (urlParam.startsWith('http://') || urlParam.startsWith('https://'))) {
        return urlParam;
      }
    }
  } catch {
    // Ignore URL parsing errors
  }
  return null;
}

function unwrapRedirectUrlRecursively(urlStr) {
  let currentUrl = urlStr;
  let depth = 0;
  while (depth < 5) {
    const unwrapped = unwrapRedirectUrl(currentUrl);
    if (!unwrapped) {
      break;
    }
    currentUrl = unwrapped;
    depth++;
  }
  return currentUrl;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TraceError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = 'TraceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function getBaseUrl(request) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || request.protocol || 'http';
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || request.headers.host;

  return `${protocol}://${host}`;
}

function getRequestPath(request) {
  return request.raw.url ? request.raw.url.split('?')[0] : '/';
}

function getClientType(request) {
  if (request.headers['x-888desturl-client'] === 'web') {
    return 'web';
  }
  if (request.raw.url && request.raw.url.startsWith('/mcp')) {
    return 'mcp';
  }
  return 'api';
}

function normalizeTraceContext(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return 'default';
  }

  const normalized = input.trim().toLowerCase();
  if (normalized === 'line') {
    return 'line';
  }

  return 'default';
}

function buildSkillMarkdown(baseUrl) {
  const apiUrl = `${baseUrl}/api/trace`;
  const finalUrlApi = `${baseUrl}/api/final-url`;
  const shortFinalApi = `${baseUrl}/api/f`;
  const mcpUrl = `${baseUrl}/mcp`;
  const resultPageUrl = `${baseUrl}/result/<result_id>`;
  const llmsTxtUrl = `${baseUrl}/llms.txt`;

  return `---
name: 888desturl-url-trace
description: Use when you need to trace a URL through HTTP redirects, meta refresh, or JavaScript navigation, detect web technologies and server frameworks (7,600+ fingerprints via enthec/webappanalyzer), inspect LIFF URLs, check Google Web Risk security, extract 2md Markdown, or call the live 888desturl API or MCP/WebMCP endpoints.
---

# 888desturl URL Trace & Web Technology Intelligence

## Environment Setup

- **Base URL**: \`${baseUrl}\`
- **MCP Endpoint**: \`${mcpUrl}\` (JSON-RPC 2.0 / WebMCP compatible)
- **Trace Endpoint**: \`${apiUrl}?url=<encoded_target_url>\`
- **Final-Only Endpoint**: \`${finalUrlApi}?url=<encoded_target_url>&format=json\`
- **Short CLI Endpoint**: \`${shortFinalApi}?url=<encoded_target_url>\`
- **LLMs Guide**: \`${llmsTxtUrl}\`
- **Result Page Pattern**: \`${resultPageUrl}\`
- **Optional Context**: add \`&context=line\` for LINE-like mobile tracing when a link only works inside the LINE in-app browser
- **Method**: \`GET\` (REST) / \`POST\` (MCP)
- **Content Type**: \`application/json\`

## Workflow

1. Validate that the input is a full \`http://\` or \`https://\` URL.
2. URL-encode the target URL.
3. If the URL appears to depend on the LINE app or LIFF, add \`context=line\`.
4. Call \`${shortFinalApi}?url=<encoded_target_url>\` for a quick text response of the final URL.
5. Call \`${finalUrlApi}?url=<encoded_target_url>&format=json\` when you need the final URL, security status, clean URL, and detected web technologies.
6. Call \`${apiUrl}?url=<encoded_target_url>\` when you need the full redirect chain, timing stats, and 2md markdown content.
7. Read \`final_url\` first and present it as the traced destination.
8. If \`removed_tracking_parameters\` is non-empty, present \`clean_url\` as the copy-friendly URL without marketing tags.
9. Summarize \`redirect_count\` and chain transitions.
10. If present, surface \`security.status\` (safe, flagged, or unknown) and any threat types.
11. Inspect \`technologies\` to discover the destination site's tech stack (CMS, Web servers, JavaScript frameworks, CDN, analytics, and software versions).
12. If \`markdown_content\` or \`markdown_url\` is present, use it for document extraction and reading.

## Response Shape

- \`final_url\`: string (The destination URL)
- \`input_url\`: string (The initial target URL or domain requested)
- \`clean_url\`: string (Destination URL stripped of marketing parameters)
- \`removed_tracking_parameters\`: Array<string> (Names of stripped tracking parameters)
- \`redirect_count\`: number (Number of redirect steps encountered)
- \`trace_context\`: "default" | "line" (Active tracing context emulation)
- \`terminated_reason\`: string (e.g. "completed", "timeout", "redirect_loop")
- \`page_title\`: string | null (Document title of destination page)
- \`page_excerpt\`: string | null (Brief textual excerpt from destination page)
- \`total_duration_ms\`: number (Total milliseconds elapsed across entire trace)
- \`chain\`: Array of redirect hop objects (step, url, from_url, type, status_code, status_text, duration_ms)
- \`technologies\`: Array of detected technology objects:
  - \`name\`: string (e.g. "WordPress", "Nginx", "React")
  - \`version\`: string | null (e.g. "6.5.2", "1.24.0")
  - \`categories\`: Array<{ id: number, name: string }> (e.g. [{"id": 1, "name": "CMS"}])
  - \`confidence\`: number (0-100)
  - \`icon\`: string | null
  - \`website\`: string | null
  - \`description\`: string | null
- \`security\`: object
  - \`status\`: "safe" | "flagged" | "unknown"
  - \`source\`: "google_webrisk"
  - \`checked_url\`: string
  - \`message\`: string
  - \`threat_types\`: Array<string>
- \`preview_url\`: string | null (Public preview screenshot URL)
- \`final_image_url\`: string | null (Alternative preview image URL)
- \`markdown_content\`: string | null (Extracted clean article/page Markdown)
- \`markdown_url\`: string | null (2md reader URL)
- \`result_id\`: string (Unique identifier for the trace result permalink)
- \`result_url\`: string | null (Permanent shareable web result URL)
`;
}

function buildLlmsTxt(baseUrl) {
  return `# 888desturl - URL Redirect Tracer & Web Technology Intelligence

> High-speed URL redirect tracer, Google Web Risk safety inspector, 7,600+ Web Technology & CMS fingerprint detector, and 2md HTML-to-Markdown extractor. Built with Node.js, Fastify, and Playwright.

## Core Services & Endpoints

- [Web Interface](${baseUrl}/): Interactive tracer with visual preview, redirect chain logs, web technologies badges, and 2md markdown reader.
- [Trace API](${baseUrl}/trace?url=https://example.com): Full JSON trace including redirects, status codes, timing, Google Web Risk, web technologies, and markdown.
- [Final URL Lookup](${baseUrl}/api/final-url?url=https://example.com&format=json): Lightweight endpoint returning final destination, clean URL, security status, and technologies.
- [Model Context Protocol (MCP)](${baseUrl}/mcp): Standard JSON-RPC 2.0 MCP endpoint supporting \`trace_url\` and \`clean_url\`. Compatible with Cursor, Claude Desktop, and Cloudflare WebMCP.
- [AI Agent Skill](${baseUrl}/ai-agent-skill): Machine-readable skill specification for autonomous coding agents and LLMs.
- [Detailed LLMs Documentation](${baseUrl}/llms-full.txt): Complete technical reference, API schemas, and sample outputs.
- [2md HTML-to-Markdown Reader](https://2md.aiurl.tw): Direct web reader transforming destination HTML into clean LLM-ready markdown.

## Key Capabilities

1. **Deep Redirect Tracing**: Follows HTTP 3xx, meta refresh, JavaScript location changes, wrapped links (YouTube, Facebook, Google, Line), and intermediate shortlink countdowns.
2. **Web Technology Fingerprinting**: Powered by the \`enthec/webappanalyzer\` database with 7,600+ technologies across 109 categories (CMS, Web servers, JavaScript frameworks, CDN, Analytics). Extracts versions and confidence scores.
3. **Google Web Risk Security Audit**: Real-time evaluation against malware, social engineering/phishing, and unwanted software threats.
4. **Marketing Tracker Scrubbing**: Automatically removes \`utm_*\`, \`fbclid\`, \`gclid\`, and tracking parameters to produce clean shareable URLs.
5. **Chrome WebMCP Integration**: Supports client-side browser agent invocation via declarative annotations and \`navigator.modelContext\` imperative API.

## Project & Maintainer Information

- GitHub Repository: https://github.com/tbdavid2019/888desturl
- Author & Maintainer: DAVID888 / GLSOFT (https://github.com/tbdavid2019)
- License: MIT
`;
}

function buildLlmsFullTxt(baseUrl) {
  return `# 888desturl - Full Technical Reference & API Manual

> Complete documentation for 888desturl: URL Redirect Tracer, Google Web Risk Inspector, 7,600+ Web Technology Detector, and 2md Markdown Extractor.

## 1. Overview
888desturl is an enterprise-grade redirect tracer and web intelligence service. When an agent or user submits a URL or bare domain, 888desturl spins up an isolated Headless Chromium browser context via Playwright, executes the full navigation lifecycle (including HTTP 3xx, HTML meta refresh, JavaScript redirection, and shortlink countdown bypasses), captures a screenshot, runs Google Web Risk validation, fingerprints the destination site's technologies against 7,600+ rules from enthec/webappanalyzer, and converts the destination page HTML to clean Markdown.

## 2. API Endpoints

### 2.1 GET /trace or /api/trace
Query parameters:
- \`url\` (required): Target URL or domain to trace (e.g. \`david888.com\` or \`https://bit.ly/xyz\`).
- \`context\` (optional): Set to \`line\` to emulate the LINE mobile in-app browser user agent.

Response Schema (JSON):
\`\`\`json
{
  "input_url": "https://bit.ly/example",
  "final_url": "https://example.com/dest",
  "clean_url": "https://example.com/dest",
  "removed_tracking_parameters": ["utm_source", "fbclid"],
  "redirect_count": 2,
  "terminated_reason": "completed",
  "total_duration_ms": 1280,
  "security": {
    "status": "safe",
    "source": "google_webrisk",
    "checked_url": "https://example.com/dest",
    "threat_types": []
  },
  "technologies": [
    {
      "name": "WordPress",
      "version": "6.5.2",
      "confidence": 100,
      "categories": [{ "id": 1, "name": "CMS" }, { "id": 11, "name": "Blogs" }],
      "icon": "WordPress.svg",
      "website": "https://wordpress.org",
      "description": "WordPress is a free and open-source content management system."
    },
    {
      "name": "Nginx",
      "version": "1.24.0",
      "confidence": 100,
      "categories": [{ "id": 22, "name": "Web servers" }],
      "website": "https://nginx.org"
    }
  ],
  "chain": [
    { "step": 1, "url": "https://bit.ly/example", "type": "initial", "status_code": 301, "duration_ms": 120 },
    { "step": 2, "url": "https://example.com/dest", "type": "http_redirect", "status_code": 200, "duration_ms": 350 }
  ],
  "markdown_content": "# Example Destination\\n\\nWelcome to the destination page...",
  "markdown_url": "https://2md.aiurl.tw/https://example.com/dest",
  "preview_url": "/previews/2026/10/24/example.jpg",
  "result_url": "${baseUrl}/result/xyz123"
}
\`\`\`

### 2.2 GET /api/final-url or /api/final
Query parameters:
- \`url\` (required): Target URL.
- \`format\` (optional): Set to \`json\` for structured metadata including \`technologies\`, or omit for plain text \`final_url\`.

### 2.3 POST /mcp (Model Context Protocol)
Standard JSON-RPC 2.0 protocol endpoint. Tools provided:
1. \`trace_url\`: Parameters \`{ url: string, context?: "default" | "line" }\`. Returns full redirect chain, Google Web Risk audit, and web technologies.
2. \`clean_url\`: Parameters \`{ url: string }\`. Pure URL string sanitizer removing tracking parameters without network calls.

### 2.4 GET /ai-agent-skill
Returns agent skill markdown for LLMs and autonomous coders.

## 3. Web Technology Detection Engine
The detection engine is built into \`lib/tech-detector.js\` and compiled against \`enthec/webappanalyzer\`:
- Over 7,647 technology signatures across 109 categories.
- Extracts signals from HTTP Response Headers, Cookies, Meta tags, Script sources, HTML snippets, DOM selectors, and JS global objects.
- Supports version extraction and recursive implied technologies (e.g. WordPress implies PHP and MySQL).

## 4. Client-side Chrome WebMCP
The web frontend (\`public/index.html\`) implements:
- Declarative WebMCP annotations on the form.
- Imperative registration: \`navigator.modelContext.registerTool('trace_url')\` providing instant in-browser agent tool calling with \`technologies\`.
`;
}

function classifyTraceError(error) {
  const message = error && error.message ? error.message : 'Unknown trace error';
  const lower = message.toLowerCase();

  if (error instanceof TraceError) {
    return error;
  }

  if (lower.includes('err_name_not_resolved') || lower.includes('name not resolved')) {
    return new TraceError('dns_error', 'The domain name could not be resolved.', 502);
  }

  if (lower.includes('err_connection_refused') || lower.includes('connection refused')) {
    return new TraceError('connection_refused', 'The target server refused the connection.', 502);
  }

  if (lower.includes('err_cert') || lower.includes('ssl') || lower.includes('tls')) {
    return new TraceError('ssl_error', 'The target site failed SSL/TLS validation.', 502);
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new TraceError('timeout', 'The trace timed out before navigation settled.', 504);
  }

  if (lower.includes('invalid url')) {
    return new TraceError('invalid_url', 'The URL is invalid. Please enter a valid URL or domain (e.g. david888.com or https://example.com).', 400);
  }

  return new TraceError('trace_failed', message, 500);
}

function interpretTraceResult(result) {
  const firstStep = result.chain[0] || null;
  const statusCode = firstStep ? firstStep.status_code : null;

  if (result.terminated_reason !== 'completed') {
    return result;
  }

  if (result.redirect_count === 0 && statusCode === 403) {
    return {
      ...result,
      terminated_reason: 'access_denied',
      terminated_message:
        'The target site returned 403 Access Denied. It may be blocking bots, non-browser traffic, or requests without the expected cookies, headers, or app context.'
    };
  }

  if (result.redirect_count === 0 && statusCode === 404) {
    return {
      ...result,
      terminated_reason: 'invalid_target',
      terminated_message:
        'The target site returned 404 Not Found. The short link may be invalid, expired, or only usable in a specific app context.'
    };
  }

  if (result.redirect_count === 0 && statusCode >= 400 && statusCode < 500) {
    return {
      ...result,
      terminated_reason: 'client_error_response',
      terminated_message: `The target site returned HTTP ${statusCode} before any redirect was observed.`
    };
  }

  if (result.redirect_count === 0 && statusCode >= 500) {
    return {
      ...result,
      terminated_reason: 'upstream_server_error',
      terminated_message: `The target site returned HTTP ${statusCode} before any redirect was observed.`
    };
  }

  return result;
}

function buildTraceContextOptions(traceContext) {
  if (traceContext !== 'line') {
    return {
      browserContextOptions: {
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true
      },
      extraHTTPHeaders: {}
    };
  }

  return {
    browserContextOptions: {
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      userAgent: LINE_IOS_USER_AGENT,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-TW'
    },
    extraHTTPHeaders: {
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  };
}

async function waitForPageToSettle(page, getLastNavigationAt, deadline, shouldStop) {
  while (Date.now() < deadline) {
    if (shouldStop()) {
      return false;
    }

    const idleFor = Date.now() - getLastNavigationAt();

    const networkIdleReached = await page
      .waitForLoadState('networkidle', { timeout: 300 })
      .then(() => true)
      .catch(() => false);

    const loadReached = await page
      .waitForLoadState('load', { timeout: 300 })
      .then(() => true)
      .catch(() => false);

    if (
      (networkIdleReached && idleFor >= SETTLE_WINDOW_MS) ||
      (loadReached && idleFor >= SETTLE_WINDOW_MS) ||
      idleFor >= Math.max(SETTLE_WINDOW_MS * 2, 2500)
    ) {
      return true;
    }

    await wait(200);
  }

  return false;
}

async function maybeContinueLineIntermediate(page, traceContext) {
  if (traceContext !== 'line') {
    return false;
  }

  const title = await page.title().catch(() => '');
  const bodyText = await page
    .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim() : ''))
    .catch(() => '');
  const snapshot = `${title}\n${bodyText}`.replace(/\s+/g, ' ');
  const isLikelyLineIntermediate =
    snapshot.includes('前往你的頁面') ||
    snapshot.includes('點擊下方按鈕前往頁面') ||
    snapshot.includes('返回 LINE') ||
    snapshot.includes('Open the page') ||
    snapshot.includes('Continue in LINE');

  if (!isLikelyLineIntermediate) {
    return false;
  }

  const ctaPatterns = [/前往頁面/i, /打開頁面/i, /繼續/i, /\bopen\b/i, /\bcontinue\b/i];
  const selectors = ['a', 'button', 'input[type="button"]', 'input[type="submit"]'];

  for (const selector of selectors) {
    const elements = await page.locator(selector).elementHandles();
    for (const element of elements) {
      const text = (
        (await element.textContent().catch(() => '')) ||
        (await element.getAttribute('value').catch(() => '')) ||
        ''
      ).trim();

      if (!text || !ctaPatterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      const visible = await element.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      await element.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function maybeContinueYoutubeIntermediate(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page
    .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim() : ''))
    .catch(() => '');
  const snapshot = `${title}\n${bodyText}`.replace(/\s+/g, ' ');

  const isLikelyYoutubeIntermediate =
    snapshot.includes('leave YouTube') ||
    snapshot.includes('離開 YouTube') ||
    snapshot.includes('離開YouTube') ||
    snapshot.includes('leave_youtube');

  if (!isLikelyYoutubeIntermediate) {
    return false;
  }

  const ctaPatterns = [
    /go to site/i,
    /前往網站/i,
    /繼續前往/i,
    /繼續/i,
    /離開/i
  ];
  const selectors = ['a', 'button', 'input[type="button"]', 'input[type="submit"]'];

  for (const selector of selectors) {
    const elements = await page.locator(selector).elementHandles();
    for (const element of elements) {
      const text = (
        (await element.textContent().catch(() => '')) ||
        (await element.getAttribute('value').catch(() => '')) ||
        ''
      ).trim();

      if (!text || !ctaPatterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      const visible = await element.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      await element.click({ timeout: 2000 }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function maybeContinueShortlinkIntermediate(page) {
  const currentUrl = page.url();

  // 1. Direct explicit button/element matches (e.g. #btn-redirect-now, #target-link)
  const explicitSelectors = [
    '#btn-redirect-now',
    '#target-link',
    'a.redirect-now',
    'button.redirect-now',
    '#btn-proceed',
    '#btn-continue',
    '#btn-go',
    '#redirect-btn',
    'a[id*="redirect"]',
    'button[id*="redirect"]',
    'a.btn-redirect',
    'button.btn-redirect'
  ];

  for (const selector of explicitSelectors) {
    try {
      const element = await page.locator(selector).first();
      const count = await element.count().catch(() => 0);
      if (count > 0) {
        const href = await element.getAttribute('href').catch(() => null);
        if (href && /^https?:\/\//i.test(href) && href !== currentUrl && href !== `${currentUrl}#`) {
          await element.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
        const visible = await element.isVisible().catch(() => false);
        if (visible) {
          await element.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  // 2. Check if page has countdown or intermediate redirect keywords in title / body
  const title = await page.title().catch(() => '');
  const bodyText = await page
    .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim() : ''))
    .catch(() => '');
  const snapshot = `${title}\n${bodyText}`.replace(/\s+/g, ' ');

  const isLikelyIntermediate =
    /redirecting in/i.test(snapshot) ||
    /redirect now/i.test(snapshot) ||
    /即將在/i.test(snapshot) ||
    /秒後跳轉/i.test(snapshot) ||
    /幫您跳轉/i.test(snapshot) ||
    /正在為您跳轉/i.test(snapshot) ||
    /短網址系統/i.test(snapshot) ||
    /Destination URL/i.test(snapshot) ||
    /目標網址/i.test(snapshot) ||
    /目的地網址/i.test(snapshot) ||
    /跳轉中/i.test(snapshot) ||
    /正在跳轉/i.test(snapshot) ||
    /即將離開/i.test(snapshot) ||
    /外部連結/i.test(snapshot) ||
    /External link/i.test(snapshot) ||
    /Safe redirect/i.test(snapshot) ||
    /Security check/i.test(snapshot) ||
    /Please wait/i.test(snapshot);

  if (isLikelyIntermediate) {
    // 2.1 Check for CTA buttons/links matching standard redirect text
    const ctaPatterns = [
      /redirect now/i,
      /立即跳轉/i,
      /立即前往/i,
      /現在跳轉/i,
      /前往網站/i,
      /前往目的地/i,
      /繼續前往/i,
      /點此前往/i,
      /點擊前往/i,
      /直接前往/i,
      /go to (site|destination|link)/i,
      /get link/i,
      /skip/i,
      /skip ad/i,
      /跳過/i,
      /proceed/i,
      /continue/i
    ];

    const generalSelectors = ['a', 'button', 'input[type="button"]', 'input[type="submit"]'];
    for (const selector of generalSelectors) {
      const elements = await page.locator(selector).elementHandles();
      for (const element of elements) {
        const text = (
          (await element.textContent().catch(() => '')) ||
          (await element.getAttribute('value').catch(() => '')) ||
          ''
        ).trim();

        if (!text || !ctaPatterns.some((pattern) => pattern.test(text))) {
          continue;
        }

        const href = await element.getAttribute('href').catch(() => null);
        if (href && /^https?:\/\//i.test(href) && href !== currentUrl && href !== `${currentUrl}#`) {
          await element.click({ timeout: 2000 }).catch(() => {});
          return true;
        }

        const visible = await element.isVisible().catch(() => false);
        if (visible) {
          await element.click({ timeout: 2000 }).catch(() => {});
          return true;
        }
      }
    }

    // 2.2 Check if there is an in-page script variable or destination link in DOM
    const extractedDestination = await page.evaluate(() => {
      if (window.trackingConfig && typeof window.trackingConfig.target === 'string' && /^https?:\/\//i.test(window.trackingConfig.target)) {
        return window.trackingConfig.target;
      }
      if (typeof window.target === 'string' && /^https?:\/\//i.test(window.target)) {
        return window.target;
      }
      const metaRefresh = document.querySelector('meta[http-equiv="refresh" i]');
      if (metaRefresh) {
        const content = metaRefresh.getAttribute('content') || '';
        const match = content.match(/url=([^;]+)/i);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      return null;
    }).catch(() => null);

    if (extractedDestination && /^https?:\/\//i.test(extractedDestination) && extractedDestination !== currentUrl) {
      await page.goto(extractedDestination, { timeout: 10000, waitUntil: 'domcontentloaded' }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function capturePreview(page, previewDir, inputUrl, finalUrl) {
  if (!previewDir || !finalUrl || !/^https?:/i.test(finalUrl)) {
    return null;
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const digest = crypto
    .createHash('sha256')
    .update(`${inputUrl}|${finalUrl}|${now.toISOString()}`)
    .digest('hex')
    .slice(0, 16);
  const relativePath = path.join(year, month, day, `${digest}.jpg`);
  const absolutePath = path.join(previewDir, relativePath);

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await page.screenshot({
    path: absolutePath,
    type: 'jpeg',
    quality: 72,
    fullPage: false,
    animations: 'disabled'
  });

  return relativePath;
}

async function lookupWebRisk(finalUrl) {
  if (!finalUrl) {
    return {
      status: 'unknown',
      source: 'google_webrisk',
      checked_url: null,
      checked_at: new Date().toISOString(),
      message: 'No final URL was available for a Web Risk lookup.',
      threat_types: []
    };
  }

  if (!WEB_RISK_API_KEY) {
    return {
      status: 'unknown',
      source: 'google_webrisk',
      checked_url: finalUrl,
      checked_at: new Date().toISOString(),
      message: 'Google Web Risk is not configured.',
      threat_types: []
    };
  }

  const query = new URLSearchParams({
    uri: finalUrl,
    key: WEB_RISK_API_KEY
  });
  for (const threatType of WEB_RISK_THREAT_TYPES) {
    query.append('threatTypes', threatType);
  }

  try {
    const response = await fetch(`https://webrisk.googleapis.com/v1/uris:search?${query.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: 'unknown',
        source: 'google_webrisk',
        checked_url: finalUrl,
        checked_at: new Date().toISOString(),
        message: payload.error && payload.error.message ? payload.error.message : 'Web Risk lookup failed.',
        threat_types: []
      };
    }

    const threatTypes = Array.isArray(payload?.threat?.threatTypes)
      ? payload.threat.threatTypes
      : [];

    if (threatTypes.length > 0) {
      return {
        status: 'flagged',
        source: 'google_webrisk',
        checked_url: finalUrl,
        checked_at: new Date().toISOString(),
        message: 'The final destination matched a Google Web Risk list.',
        threat_types: threatTypes
      };
    }

    return {
      status: 'safe',
      source: 'google_webrisk',
      checked_url: finalUrl,
      checked_at: new Date().toISOString(),
      message: 'No Google Web Risk match was found for the final destination.',
      threat_types: []
    };
  } catch (error) {
    return {
      status: 'unknown',
      source: 'google_webrisk',
      checked_url: finalUrl,
      checked_at: new Date().toISOString(),
      message: error.message || 'Web Risk lookup failed.',
      threat_types: []
    };
  }
}

function toPublicSecurity(security) {
  return {
    status: security && security.status ? security.status : 'unknown',
    source: security && security.source ? security.source : 'google_webrisk',
    checked_url: security && security.checked_url ? security.checked_url : null,
    checked_at: security && security.checked_at ? security.checked_at : null,
    message: security && security.message ? security.message : null,
    threat_types:
      security && Array.isArray(security.threat_types) ? security.threat_types : []
  };
}

function buildResultUrl(baseUrl, resultId) {
  if (!resultId) {
    return null;
  }

  return `${baseUrl}/result/${encodeURIComponent(resultId)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toAbsoluteUrl(baseUrl, maybeRelativeUrl) {
  if (!maybeRelativeUrl) {
    return null;
  }

  try {
    return new URL(maybeRelativeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function getSecuritySummary(status) {
  if (status === 'safe') {
    return '✓ 安全';
  }

  if (status === 'flagged') {
    return '⚠ 已知風險';
  }

  return '？ 無法判斷';
}

function buildResultMeta(result, baseUrl) {
  if (!result) {
    const title = '888desturl Result';
    const description = 'Trace result not found.';
    return {
      title,
      description,
      canonicalUrl: baseUrl,
      ogImageUrl: '',
      resultJson: 'null'
    };
  }

  const securitySummary = getSecuritySummary(result.security_status);
  const title = `${securitySummary} | 888desturl`;
  const description = `${result.final_url || 'N/A'} | Redirects ${result.redirect_count || 0} | Result ${result.result_id || ''}`.trim();
  const canonicalUrl = buildResultUrl(baseUrl, result.result_id) || baseUrl;
  const ogImageUrl = toAbsoluteUrl(baseUrl, result.preview_url) || '';

  return {
    title,
    description,
    canonicalUrl,
    ogImageUrl,
    resultJson: JSON.stringify(enrichResultWithPublicUrls(result, baseUrl)).replaceAll('</script', '<\\/script')
  };
}

function renderResultPageHtml(result, baseUrl) {
  const template = fs.readFileSync(resultTemplatePath, 'utf8');
  const meta = buildResultMeta(result, baseUrl);
  const ogImageMeta = meta.ogImageUrl
    ? `  <meta property="og:image" content="${escapeHtml(meta.ogImageUrl)}" />\n  <meta name="twitter:image" content="${escapeHtml(meta.ogImageUrl)}" />`
    : '';

  return template
    .replaceAll('__META_TITLE__', escapeHtml(meta.title))
    .replaceAll('__META_DESCRIPTION__', escapeHtml(meta.description))
    .replaceAll('__CANONICAL_URL__', escapeHtml(meta.canonicalUrl))
    .replaceAll('__OG_IMAGE_META__', ogImageMeta)
    .replaceAll('__RESULT_JSON__', meta.resultJson);
}

function enrichResultWithPublicUrls(result, baseUrl) {
  if (!result) {
    return result;
  }

  const urlAnalysis = analyzeUrl(result.final_url);
  const previewUrl = result.final_image_url || result.preview_url || null;
  const markdownUrl = result.final_url ? `https://2md.aiurl.tw/${result.final_url}` : null;
  const security = toPublicSecurity(
    result.security || {
      status: result.security_status,
      source: result.security_source,
      checked_url: result.security_checked_url,
      checked_at: result.security_checked_at,
      message: result.security_message,
      threat_types: result.threat_types
    }
  );

  return {
    ...result,
    total_duration_ms: typeof result.total_duration_ms === 'number' ? result.total_duration_ms : null,
    preview_url: previewUrl,
    final_image_url: previewUrl,
    clean_url: urlAnalysis.clean_url,
    removed_tracking_parameters: urlAnalysis.removed_tracking_parameters,
    markdown_url: result.markdown_url || markdownUrl,
    markdown_content: result.markdown_content || null,
    technologies: Array.isArray(result.technologies) ? result.technologies : [],
    security_status: result.security_status || security.status,
    security_source: result.security_source || security.source,
    security_message: result.security_message || security.message,
    security_checked_url: result.security_checked_url || security.checked_url,
    security_checked_at: result.security_checked_at || security.checked_at,
    threat_types: Array.isArray(result.threat_types) ? result.threat_types : security.threat_types,
    security,
    result_url: buildResultUrl(baseUrl, result.result_id)
  };
}

function buildResultImagePayload(result) {
  const finalImageUrl = result.final_image_url || result.preview_url || null;

  return {
    result_id: result.result_id || null,
    available: Boolean(finalImageUrl),
    status: finalImageUrl ? 'available' : 'unavailable',
    final_image_url: finalImageUrl,
    image_url: finalImageUrl,
    mime_type: finalImageUrl ? 'image/jpeg' : null
  };
}

function buildResultWebRiskPayload(result) {
  return {
    result_id: result.result_id || null,
    security: toPublicSecurity(result.security)
  };
}

async function getStoredResultOrReply(request, reply) {
  const { resultId } = request.params;
  if (!isValidResultId(resultId)) {
    reply.code(400);
    return {
      error: 'Invalid result ID format.'
    };
  }

  if (!historyStore || !historyStore.enabled) {
    reply.code(503);
    return {
      error: 'Result pages are not available until SQLite storage is enabled in the deployment environment.'
    };
  }

  const result = await historyStore.getResultById(resultId);
  if (!result) {
    reply.code(404);
    return {
      error: 'Result not found.'
    };
  }

  return enrichResultWithPublicUrls(result, getBaseUrl(request));
}

async function persistTraceRecord(record) {
  if (!historyStore) {
    return null;
  }

  try {
    return await historyStore.recordTrace(record);
  } catch (error) {
    app.log.error({ err: error, record }, 'Failed to persist trace record');
    return null;
  }
}

async function traceUrl(inputUrl, traceContext = 'default', options = {}) {
  const traceStartedAt = Date.now();
  const unwrappedUrl = unwrapRedirectUrlRecursively(inputUrl);

  if (isBlockedTarget(unwrappedUrl) || isBlockedTarget(inputUrl)) {
    throw new TraceError('ssrf_blocked', 'Access to internal cloud metadata addresses is forbidden.', 403);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--disable-audio-output',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--no-first-run',
      '--no-service-autorun'
    ]
  });

  const traceContextOptions = buildTraceContextOptions(traceContext);
  const context = await browser.newContext(traceContextOptions.browserContextOptions);
  if (Object.keys(traceContextOptions.extraHTTPHeaders).length > 0) {
    await context.setExtraHTTPHeaders(traceContextOptions.extraHTTPHeaders);
  }
  const page = await context.newPage();

  const navigationResponses = [];
  const navigationEvents = [];
  const requestStartedAt = new WeakMap();
  const urlVisitCounts = new Map();
  const transitionVisitCounts = new Map();
  let lastNavigationAt = Date.now();
  let stopReason = null;
  let stopMessage = null;
  let lineIntermediateClicks = 0;
  let shortlinkIntermediateClicks = 0;

  function markTermination(reason, message) {
    if (!stopReason) {
      stopReason = reason;
      stopMessage = message;
      page
        .evaluate(() => window.stop())
        .catch(() => {});
    }
  }

  await page.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    if (isBlockedTarget(reqUrl)) {
      await route.abort();
      return;
    }

    const resourceType = route.request().resourceType();

    if (['image', 'media', 'font'].includes(resourceType)) {
      await route.abort();
      return;
    }

    await route.continue();
  });

  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      requestStartedAt.set(request, Date.now());
    }
  });

  page.on('response', async (response) => {
    const request = response.request();
    const frame = request.frame();

    if (!request.isNavigationRequest() || frame !== page.mainFrame()) {
      return;
    }

    const startedAt = requestStartedAt.get(request) || null;
    const durationMs = startedAt === null ? null : Math.max(0, Date.now() - startedAt);

    let headers = {};
    try {
      headers = response.headers();
    } catch {}

    navigationResponses.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      method: request.method(),
      startedAt,
      durationMs,
      headers
    });
  });

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    lastNavigationAt = Date.now();
    const currentUrl = frame.url();
    const normalizedUrl = currentUrl.split('#')[0];
    const previousEvent = navigationEvents[navigationEvents.length - 1];
    const previousNormalizedUrl = previousEvent ? previousEvent.url.split('#')[0] : null;

    const nextUrlVisitCount = (urlVisitCounts.get(normalizedUrl) || 0) + 1;
    urlVisitCounts.set(normalizedUrl, nextUrlVisitCount);

    if (nextUrlVisitCount > MAX_REPEAT_URL_VISITS) {
      markTermination(
        'redirect_loop',
        `Stopped tracing because the same URL was visited more than ${MAX_REPEAT_URL_VISITS} times.`
      );
    }

    if (previousNormalizedUrl) {
      const transitionKey = `${previousNormalizedUrl}->${normalizedUrl}`;
      const nextTransitionCount = (transitionVisitCounts.get(transitionKey) || 0) + 1;
      transitionVisitCounts.set(transitionKey, nextTransitionCount);

      if (nextTransitionCount > MAX_REPEAT_TRANSITIONS) {
        markTermination(
          'redirect_loop',
          'Stopped tracing because the redirect pattern repeated and appears to be a loop.'
        );
      }
    }

    navigationEvents.push({
      url: currentUrl,
      observedAt: lastNavigationAt,
      elapsedMs: Math.max(0, lastNavigationAt - traceStartedAt)
    });

    if (navigationEvents.length > MAX_REDIRECT_STEPS) {
      markTermination(
        'max_redirect_steps',
        `Stopped tracing after ${MAX_REDIRECT_STEPS} navigation steps to avoid an infinite redirect loop.`
      );
    }
  });

  try {
    try {
      await page.goto(unwrappedUrl, {
        timeout: TRACE_TIMEOUT_MS,
        waitUntil: 'domcontentloaded'
      });
    } catch (error) {
      if (navigationEvents.length === 0) {
        throw error;
      }
    }

    const deadline = Date.now() + TRACE_TIMEOUT_MS;
    while (Date.now() < deadline && !stopReason) {
      const settled = await waitForPageToSettle(
        page,
        () => lastNavigationAt,
        deadline,
        () => Boolean(stopReason)
      );

      if (stopReason) {
        break;
      }

      if (!settled) {
        break;
      }

      const clickedLine = await maybeContinueLineIntermediate(page, traceContext);
      if (clickedLine) {
        lineIntermediateClicks += 1;
        lastNavigationAt = Date.now();
        if (lineIntermediateClicks > MAX_LINE_INTERMEDIATE_CLICKS) {
          markTermination(
            'line_intermediate_limit',
            `Stopped after ${MAX_LINE_INTERMEDIATE_CLICKS} LINE-style continuation clicks.`
          );
        }
        continue;
      }

      const clickedYoutube = await maybeContinueYoutubeIntermediate(page);
      if (clickedYoutube) {
        lastNavigationAt = Date.now();
        continue;
      }

      const clickedShortlink = await maybeContinueShortlinkIntermediate(page);
      if (clickedShortlink) {
        shortlinkIntermediateClicks += 1;
        lastNavigationAt = Date.now();
        if (shortlinkIntermediateClicks > MAX_SHORTLINK_INTERMEDIATE_CLICKS) {
          markTermination(
            'shortlink_intermediate_limit',
            `Stopped after ${MAX_SHORTLINK_INTERMEDIATE_CLICKS} intermediate shortlink continuation clicks.`
          );
        }
        continue;
      }

      break;
    }

    if (!stopReason && Date.now() >= deadline) {
      markTermination('timeout', 'The trace timed out before navigation settled.');
    }

    const chain = [];
    let previousUrl = null;
    let lastEventTime = traceStartedAt;

    if (unwrappedUrl !== inputUrl) {
      chain.push({
        step: 1,
        url: inputUrl,
        from_url: null,
        type: 'initial',
        status_code: 302,
        status_text: 'Found (Static Unwrap)',
        method: 'GET',
        duration_ms: 0,
        elapsed_ms: 0,
        timestamp: new Date(traceStartedAt).toISOString()
      });
      previousUrl = inputUrl;
    }

    for (let i = 0; i < navigationEvents.length; i++) {
      const event = navigationEvents[i];
      const response = navigationResponses.find((item) => item.url === event.url) || null;
      const isHttpRedirect =
        response &&
        response.status >= 300 &&
        response.status < 400 &&
        typeof response.statusText === 'string';

      const durationMs =
        response && typeof response.durationMs === 'number'
          ? response.durationMs
          : Math.max(0, event.observedAt - lastEventTime);

      chain.push({
        step: chain.length + 1,
        url: event.url,
        from_url: previousUrl,
        type: chain.length === 0 ? 'initial' : isHttpRedirect ? 'http_redirect' : 'client_redirect',
        status_code: response ? response.status : null,
        status_text: response ? response.statusText : null,
        method: response ? response.method : null,
        duration_ms: durationMs,
        elapsed_ms: event.elapsedMs !== undefined ? event.elapsedMs : Math.max(0, event.observedAt - traceStartedAt),
        timestamp: new Date(event.observedAt || Date.now()).toISOString()
      });

      lastEventTime = event.observedAt || lastEventTime;
      previousUrl = event.url;
    }

    const finalUrl = page.url();
    if (chain.length === 0 || chain[chain.length - 1].url !== finalUrl) {
      chain.push({
        step: chain.length + 1,
        url: finalUrl,
        from_url: previousUrl,
        type: chain.length === 0 ? 'initial' : 'client_redirect',
        status_code: null,
        status_text: null,
        method: null,
        duration_ms: Math.max(0, Date.now() - lastEventTime),
        elapsed_ms: Math.max(0, Date.now() - traceStartedAt),
        timestamp: new Date().toISOString()
      });
    }

    const pageTitle = await page.title().catch(() => '');
    const pageExcerpt = await page
      .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim() : ''))
      .then((text) => text.replace(/\s+/g, ' ').slice(0, 240))
      .catch(() => '');
    const markdownContent = await extractPageMarkdown(page).catch(() => '');
    const markdownUrl = finalUrl ? `https://2md.aiurl.tw/${finalUrl}` : null;
    const techSignals = await extractPageTechSignals(page, navigationResponses, context).catch(() => null);
    const technologies = techSignals ? detectTechnologies(techSignals) : [];
    const previewPath = await capturePreview(page, options.previewDir, inputUrl, finalUrl).catch(() => null);
    const totalDurationMs = Math.max(0, Date.now() - traceStartedAt);

    return interpretTraceResult({
      final_url: finalUrl,
      input_url: inputUrl,
      trace_context: traceContext,
      redirect_count: Math.max(0, chain.length - 1),
      chain,
      total_duration_ms: totalDurationMs,
      terminated_reason: stopReason || 'completed',
      terminated_message: stopMessage,
      loop_detected: stopReason === 'redirect_loop' || stopReason === 'max_redirect_steps',
      page_title: pageTitle || null,
      page_excerpt: pageExcerpt || null,
      markdown_content: markdownContent || null,
      markdown_url: markdownUrl,
      technologies,
      preview_path: previewPath,
      preview_url: options.toPublicPreviewUrl ? options.toPublicPreviewUrl(previewPath) : null
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function buildTracePayload(request, targetUrl, traceContext) {
  const baseUrl = getBaseUrl(request);
  const traceResult = await traceUrl(targetUrl, traceContext, {
    previewDir: historyStore ? historyStore.previewDir : PREVIEW_DIR,
    toPublicPreviewUrl: historyStore ? historyStore.toPublicPreviewUrl : null
  });
  const securityCheck = await lookupWebRisk(traceResult.final_url);

  const persisted = await persistTraceRecord({
    created_at: new Date().toISOString(),
    input_url: traceResult.input_url,
    final_url: traceResult.final_url,
    client_type: getClientType(request),
    request_path: getRequestPath(request),
    redirect_count: traceResult.redirect_count,
    step_count: traceResult.chain.length,
    terminated_reason: traceResult.terminated_reason,
    terminated_message: traceResult.terminated_message,
    trace_context: traceResult.trace_context,
    page_title: traceResult.page_title,
    page_excerpt: traceResult.page_excerpt,
    preview_path: traceResult.preview_path,
    total_duration_ms: traceResult.total_duration_ms,
    markdown_content: traceResult.markdown_content,
    technologies: traceResult.technologies || [],
    security_status: securityCheck.status,
    security_source: securityCheck.source,
    security_message: securityCheck.message,
    security_checked_url: securityCheck.checked_url,
    security_checked_at: securityCheck.checked_at,
    threat_types: securityCheck.threat_types,
    loop_detected: traceResult.loop_detected,
    chain: traceResult.chain
  });

  return enrichResultWithPublicUrls({
    ...traceResult,
    result_id: persisted ? persisted.result_id : null,
    security: toPublicSecurity(securityCheck)
  }, baseUrl);
}

async function persistFailure(request, targetUrl, traceContext, classified) {
  return persistTraceRecord({
    created_at: new Date().toISOString(),
    input_url: targetUrl,
    final_url: null,
    client_type: getClientType(request),
    request_path: getRequestPath(request),
    redirect_count: 0,
    step_count: 0,
    terminated_reason: classified.code,
    terminated_message: classified.message,
    trace_context: traceContext,
    page_title: null,
    page_excerpt: null,
    preview_path: null,
    technologies: [],
    security_status: 'unknown',
    security_source: 'google_webrisk',
    security_message: null,
    security_checked_url: null,
    security_checked_at: null,
    threat_types: [],
    loop_detected: false,
    chain: []
  });
}

async function handleTraceRequest(request, reply) {
  const targetUrl = normalizeUrl(request.query.url);
  const traceContext = normalizeTraceContext(request.query.context);

  if (!targetUrl) {
    reply.code(400);
    return {
      error: 'Invalid or missing url query parameter. Please provide a valid URL or domain (e.g. david888.com or https://example.com).',
      error_code: 'invalid_url',
      error_message: 'Invalid or missing url query parameter. Please provide a valid URL or domain (e.g. david888.com or https://example.com).',
      trace_context: traceContext
    };
  }

  try {
    return await buildTracePayload(request, targetUrl, traceContext);
  } catch (error) {
    const classified = classifyTraceError(error);
    request.log.error({ err: error, classified, targetUrl }, 'Trace failed');
    const persisted = await persistFailure(request, targetUrl, traceContext, classified);
    reply.code(classified.statusCode);
    return enrichResultWithPublicUrls({
      error: classified.message,
      error_code: classified.code,
      error_message: classified.message,
      input_url: targetUrl,
      trace_context: traceContext,
      final_url: null,
      redirect_count: 0,
      chain: [],
      preview_url: null,
      result_id: persisted ? persisted.result_id : null,
      security: toPublicSecurity({
        status: 'unknown',
        source: 'google_webrisk',
        checked_url: null,
        checked_at: new Date().toISOString(),
        message: 'Trace failed before a final URL could be checked.'
      }),
      details: error.message
    }, getBaseUrl(request));
  }
}

app.get('/api/trace', handleTraceRequest);
app.get('/trace', handleTraceRequest);

async function handleFinalLookup(request, reply) {
  const targetUrl = normalizeUrl(request.query.url);
  const format = typeof request.query.format === 'string' ? request.query.format.toLowerCase() : 'text';
  const traceContext = normalizeTraceContext(request.query.context);

  if (!targetUrl) {
    reply.code(400);
    if (format === 'json') {
      return {
        error: 'Invalid or missing url query parameter. Please provide a valid URL or domain (e.g. david888.com or https://example.com).',
        error_code: 'invalid_url',
        error_message: 'Invalid or missing url query parameter. Please provide a valid URL or domain (e.g. david888.com or https://example.com).',
        trace_context: traceContext
      };
    }

    reply.type('text/plain; charset=utf-8');
    return 'Invalid or missing url query parameter. Please provide a valid URL or domain (e.g. david888.com or https://example.com).\n';
  }

  try {
    const result = await buildTracePayload(request, targetUrl, traceContext);

    if (format === 'json') {
      return {
        result_id: result.result_id || null,
        result_url: result.result_url || null,
        final_url: result.final_url,
        clean_url: result.clean_url,
        removed_tracking_parameters: result.removed_tracking_parameters,
        input_url: result.input_url,
        trace_context: result.trace_context,
        redirect_count: result.redirect_count,
        terminated_reason: result.terminated_reason,
        terminated_message: result.terminated_message,
        loop_detected: result.loop_detected,
        preview_url: result.preview_url,
        final_image_url: result.final_image_url,
        security: result.security,
        technologies: result.technologies || []
      };
    }

    reply.type('text/plain; charset=utf-8');
    if (result.terminated_reason !== 'completed' && result.terminated_message) {
      return `${result.final_url}\n# Warning: ${result.terminated_message}\n`;
    }

    return `${result.final_url}\n`;
  } catch (error) {
    const classified = classifyTraceError(error);
    request.log.error({ err: error, classified, targetUrl }, 'Final URL lookup failed');
    const persisted = await persistFailure(request, targetUrl, traceContext, classified);
    reply.code(classified.statusCode);

    if (format === 'json') {
      return enrichResultWithPublicUrls({
        result_id: persisted ? persisted.result_id : null,
        error: classified.message,
        error_code: classified.code,
        error_message: classified.message,
        input_url: targetUrl,
        trace_context: traceContext,
        final_url: null,
        preview_url: null,
        result_id: persisted ? persisted.result_id : null,
        technologies: [],
        security: toPublicSecurity({
          status: 'unknown',
          source: 'google_webrisk',
          checked_url: null,
          checked_at: new Date().toISOString(),
          message: 'Final URL lookup failed before a Web Risk check could run.'
        }),
        details: error.message
      }, getBaseUrl(request));
    }

    reply.type('text/plain; charset=utf-8');
    return `Final URL lookup failed: ${classified.message}\n`;
  }
}

app.get('/api/final', handleFinalLookup);
app.get('/api/final-url', handleFinalLookup);
app.get('/api/f', handleFinalLookup);

app.get('/api/results/:resultId', async (request, reply) => {
  return getStoredResultOrReply(request, reply);
});

app.get('/api/results/:resultId/final-image', async (request, reply) => {
  const result = await getStoredResultOrReply(request, reply);
  if (reply.statusCode >= 400) {
    return result;
  }

  return buildResultImagePayload(result);
});

app.get('/api/results/:resultId/web-risk', async (request, reply) => {
  const result = await getStoredResultOrReply(request, reply);
  if (reply.statusCode >= 400) {
    return result;
  }

  return buildResultWebRiskPayload(result);
});

app.get('/api/admin/session', async (request) => {
  const session = adminAuth.getSession(request);
  return {
    enabled: adminAuth.enabled,
    authenticated: Boolean(session),
    session,
    storage_enabled: Boolean(historyStore && historyStore.enabled),
    login_rate_limit: {
      max_attempts: adminAuth.maxAttempts,
      window_ms: adminAuth.windowMs,
      remaining_attempts: adminAuth.getRemainingAttempts(adminAuth.getClientIp(request))
    }
  };
});

app.post('/api/admin/login', async (request, reply) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const result = adminAuth.authenticate(request, body.username, body.password);

  if (!result.ok) {
    reply.code(result.statusCode);
    return {
      error: result.message,
      remaining_attempts: result.remaining_attempts
    };
  }

  adminAuth.createSession(reply, request);
  return {
    ok: true,
    username: process.env.ADMIN_USERNAME
  };
});

app.post('/api/admin/logout', async (request, reply) => {
  adminAuth.clearSession(reply, request);
  return { ok: true };
});

app.get('/api/admin/stats', async (request, reply) => {
  const session = adminAuth.requireSession(request, reply);
  if (!session) {
    return { error: 'Authentication required.' };
  }

  if (!historyStore || !historyStore.enabled) {
    reply.code(503);
    return {
      error: 'Server history is not available until the sqlite3 dependency is installed in the deployment environment.'
    };
  }

  return historyStore.getStats();
});

app.get('/api/admin/history', async (request, reply) => {
  const session = adminAuth.requireSession(request, reply);
  if (!session) {
    return { error: 'Authentication required.' };
  }

  if (!historyStore || !historyStore.enabled) {
    reply.code(503);
    return {
      error: 'Server history is not available until the sqlite3 dependency is installed in the deployment environment.'
    };
  }

  return historyStore.getHistory({
    client_type: request.query.client_type,
    limit: request.query.limit,
    offset: request.query.offset
  });
});

app.get('/ai-agent-skill', async (request, reply) => {
  const baseUrl = getBaseUrl(request);
  const markdown = buildSkillMarkdown(baseUrl);

  reply
    .type('text/markdown; charset=utf-8')
    .header('content-disposition', 'inline; filename="888desturl-url-trace.SKILL.md"');

  return markdown;
});

app.get('/llms.txt', async (request, reply) => {
  const baseUrl = getBaseUrl(request);
  reply.type('text/plain; charset=utf-8');
  return buildLlmsTxt(baseUrl);
});

app.get('/llms-full.txt', async (request, reply) => {
  const baseUrl = getBaseUrl(request);
  reply.type('text/plain; charset=utf-8');
  return buildLlmsFullTxt(baseUrl);
});

app.get('/admin', async (request, reply) => {
  return reply.sendFile('admin.html');
});

app.get('/result/:resultId', async (request, reply) => {
  const { resultId } = request.params;
  if (!isValidResultId(resultId)) {
    reply.code(400).type('text/html; charset=utf-8');
    return renderResultPageHtml(null, getBaseUrl(request));
  }

  if (!historyStore || !historyStore.enabled) {
    reply.code(503).type('text/html; charset=utf-8');
    return renderResultPageHtml(null, getBaseUrl(request));
  }

  const result = await historyStore.getResultById(resultId);
  if (!result) {
    reply.code(404).type('text/html; charset=utf-8');
    return renderResultPageHtml(null, getBaseUrl(request));
  }

  reply.type('text/html; charset=utf-8');
  return renderResultPageHtml(result, getBaseUrl(request));
});

app.get('/r/:resultId', async (request, reply) => {
  const { resultId } = request.params;
  if (!isValidResultId(resultId)) {
    reply.code(400);
    return { error: 'Invalid result ID format.' };
  }
  return reply.redirect(`/result/${encodeURIComponent(resultId)}`);
});

app.get('/health', async () => ({
  ok: true,
  storage_enabled: Boolean(historyStore && historyStore.enabled),
  web_risk_enabled: Boolean(WEB_RISK_API_KEY)
}));

const mcpHandler = createMcpHandler({
  onTrace: async (args, req) => {
    const targetUrl = normalizeUrl(args && args.url);
    const traceContext = normalizeTraceContext(args && args.context);
    if (!targetUrl) {
      throw new Error('Invalid or missing url argument. Please provide a valid URL or domain (e.g. david888.com or https://example.com).');
    }
    try {
      return await buildTracePayload(req, targetUrl, traceContext);
    } catch (error) {
      const classified = classifyTraceError(error);
      req.log.error({ err: error, classified, targetUrl }, 'MCP Trace failed');
      const persisted = await persistFailure(req, targetUrl, traceContext, classified);
      const baseUrl = getBaseUrl(req);
      return enrichResultWithPublicUrls({
        error: classified.message,
        error_code: classified.code,
        error_message: classified.message,
        input_url: targetUrl,
        trace_context: traceContext,
        final_url: null,
        redirect_count: 0,
        chain: [],
        preview_url: null,
        result_id: persisted ? persisted.result_id : null,
        security: toPublicSecurity({
          status: 'unknown',
          source: 'google_webrisk',
          checked_url: null,
          checked_at: new Date().toISOString(),
          message: 'Trace failed before a final URL could be checked.'
        }),
        details: error.message
      }, baseUrl);
    }
  },
  onClean: async (args) => {
    if (!args || typeof args.url !== 'string' || !args.url.trim()) {
      throw new Error('Invalid or missing url argument. Please provide a valid URL or domain (e.g. david888.com or https://example.com).');
    }
    const targetUrl = normalizeUrl(args.url.trim());
    if (!targetUrl) {
      throw new Error('Invalid or missing url argument. Please provide a valid URL or domain (e.g. david888.com or https://example.com).');
    }
    const cleaned = analyzeUrl(targetUrl);
    return {
      input_url: targetUrl,
      clean_url: cleaned.clean_url,
      has_tracking: (cleaned.removed_tracking_parameters || []).length > 0,
      removed_tracking_parameters: cleaned.removed_tracking_parameters || []
    };
  }
});

app.options('/mcp', async (request, reply) => {
  reply
    .header('access-control-allow-origin', '*')
    .header('access-control-allow-methods', 'GET, POST, OPTIONS')
    .header('access-control-allow-headers', 'content-type, authorization, x-888desturl-client')
    .code(204);
  return '';
});

app.get('/mcp', async (request, reply) => {
  reply
    .header('access-control-allow-origin', '*')
    .type('application/json; charset=utf-8');
  return {
    name: '888desturl-mcp',
    version: '1.0.0',
    protocolVersion: '2024-11-05',
    transport: 'HTTP JSON-RPC 2.0',
    endpoint: `${getBaseUrl(request)}/mcp`,
    description: 'Model Context Protocol (MCP) server for 888desturl URL tracing and cleaning, compatible with Cloudflare WebMCP and MCP clients.',
    tools: mcpHandler.getTools()
  };
});

app.post('/mcp', async (request, reply) => {
  reply
    .header('access-control-allow-origin', '*')
    .type('application/json; charset=utf-8');

  const response = await mcpHandler.handleJsonRpc(request.body, request);
  if (response === null) {
    reply.code(204);
    return '';
  }
  return response;
});

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url && (request.raw.url.startsWith('/api/') || request.raw.url.startsWith('/mcp'))) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }

  reply.sendFile('index.html');
});

async function start() {
  await fs.promises.mkdir(PREVIEW_DIR, { recursive: true });
  historyStore = await createHistoryStore({
    dataDir: DATA_DIR,
    logger: app.log,
    previewRetentionDays: PREVIEW_RETENTION_DAYS,
    historyRetentionDays: HISTORY_RETENTION_DAYS
  });
  await historyStore.initialize();
  await historyStore.cleanup().catch((error) => {
    app.log.error({ err: error }, 'Initial history cleanup failed');
  });

  setInterval(() => {
    historyStore.cleanup().catch((error) => {
      app.log.error({ err: error }, 'Scheduled history cleanup failed');
    });
  }, CLEANUP_INTERVAL_MS).unref();

  await app.listen({ port: PORT, host: HOST });
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
