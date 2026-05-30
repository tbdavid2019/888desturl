const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { chromium } = require('playwright');
const { loadEnvFile } = require('./lib/env');
const { createHistoryStore } = require('./lib/storage');
const { createAdminAuth } = require('./lib/admin-auth');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TRACE_TIMEOUT_MS = 15000;
const SETTLE_WINDOW_MS = 1200;
const MAX_REDIRECT_STEPS = 20;
const MAX_REPEAT_URL_VISITS = 3;
const MAX_REPEAT_TRANSITIONS = 2;
const MAX_LINE_INTERMEDIATE_CLICKS = 2;
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

app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/'
});

app.register(fastifyStatic, {
  root: PREVIEW_DIR,
  prefix: '/previews/',
  decorateReply: false
});

function normalizeUrl(input) {
  try {
    const candidate = new URL(input);
    if (!['http:', 'https:'].includes(candidate.protocol)) {
      return null;
    }

    return candidate.toString();
  } catch {
    return null;
  }
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
  return request.headers['x-888desturl-client'] === 'web' ? 'web' : 'api';
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
  const finalUrlApi = `${baseUrl}/api/final`;
  const shortFinalApi = `${baseUrl}/api/f`;
  const resultPageUrl = `${baseUrl}/result/<result_id>`;

  return `---
name: 888desturl-url-trace
description: Use when you need to trace a URL through HTTP redirects, meta refresh, or JavaScript navigation by calling the live 888desturl API for the current deployment. Supports final destination discovery, LIFF URL inspection, and redirect-chain debugging.
---

# 888desturl URL Trace

## Environment Setup

- **Base URL**: \`${baseUrl}\`
- **Trace Endpoint**: \`${apiUrl}?url=<encoded_target_url>\`
- **Final-Only Endpoint**: \`${finalUrlApi}?url=<encoded_target_url>\`
- **Short CLI Endpoint**: \`${shortFinalApi}?url=<encoded_target_url>\`
- **Result Page Pattern**: \`${resultPageUrl}\`
- **Optional Context**: add \`&context=line\` for LINE-like mobile tracing when a link only works inside the LINE in-app browser
- **Method**: \`GET\`
- **Content Type**: \`application/json\`

## Workflow

1. Validate that the input is a full \`http://\` or \`https://\` URL.
2. URL-encode the target URL.
3. If the URL appears to depend on the LINE app or LIFF, add \`context=line\`.
4. Call \`${shortFinalApi}?url=<encoded_target_url>\` for a short CLI response.
5. Call \`${finalUrlApi}?url=<encoded_target_url>&format=json\` when you need the final URL plus metadata.
6. Call \`${apiUrl}?url=<encoded_target_url>\` when you need the full chain.
7. Read \`final_url\` first and present it as the main answer.
8. Summarize \`redirect_count\`.
9. If present, surface \`security.status\`, \`preview_url\`, and \`result_url\`.

## Response Shape

- \`final_url\`
- \`redirect_count\`
- \`chain\`
- \`preview_url\`
- \`security\`
- \`result_url\`
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
    return new TraceError('invalid_url', 'The URL is invalid. Use a full http(s) URL.', 400);
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
      .waitForLoadState('networkidle', { timeout: 500 })
      .then(() => true)
      .catch(() => false);

    if (idleFor >= SETTLE_WINDOW_MS && networkIdleReached) {
      return true;
    }

    await wait(250);
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
    status: security.status,
    source: security.source,
    checked_url: security.checked_url,
    checked_at: security.checked_at,
    message: security.message
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

  return {
    ...result,
    result_url: buildResultUrl(baseUrl, result.result_id)
  };
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

    navigationResponses.push({
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      method: request.method(),
      startedAt,
      durationMs
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
      observedAt: lastNavigationAt
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
      await page.goto(inputUrl, {
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

      const clicked = await maybeContinueLineIntermediate(page, traceContext);
      if (!clicked) {
        break;
      }

      lineIntermediateClicks += 1;
      lastNavigationAt = Date.now();
      if (lineIntermediateClicks > MAX_LINE_INTERMEDIATE_CLICKS) {
        markTermination(
          'line_intermediate_limit',
          `Stopped after ${MAX_LINE_INTERMEDIATE_CLICKS} LINE-style continuation clicks.`
        );
      }
    }

    if (!stopReason && Date.now() >= deadline) {
      markTermination('timeout', 'The trace timed out before navigation settled.');
    }

    const chain = [];
    let previousUrl = null;
    for (const event of navigationEvents) {
      const response = navigationResponses.find((item) => item.url === event.url) || null;
      const isHttpRedirect =
        response &&
        response.status >= 300 &&
        response.status < 400 &&
        typeof response.statusText === 'string';

      chain.push({
        step: chain.length + 1,
        url: event.url,
        from_url: previousUrl,
        type: chain.length === 0 ? 'initial' : isHttpRedirect ? 'http_redirect' : 'client_redirect',
        status_code: response ? response.status : null,
        status_text: response ? response.statusText : null,
        method: response ? response.method : null,
        duration_ms: response ? response.durationMs : null
      });

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
        duration_ms: null
      });
    }

    const pageTitle = await page.title().catch(() => '');
    const pageExcerpt = await page
      .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim() : ''))
      .then((text) => text.replace(/\s+/g, ' ').slice(0, 240))
      .catch(() => '');
    const previewPath = await capturePreview(page, options.previewDir, inputUrl, finalUrl).catch(() => null);

    return interpretTraceResult({
      final_url: finalUrl,
      input_url: inputUrl,
      trace_context: traceContext,
      redirect_count: Math.max(0, chain.length - 1),
      chain,
      terminated_reason: stopReason || 'completed',
      terminated_message: stopMessage,
      loop_detected: stopReason === 'redirect_loop' || stopReason === 'max_redirect_steps',
      page_title: pageTitle || null,
      page_excerpt: pageExcerpt || null,
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
    security_status: securityCheck.status,
    security_message: securityCheck.message,
    security_checked_url: securityCheck.checked_url,
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
    security_status: 'unknown',
    security_message: null,
    security_checked_url: null,
    threat_types: [],
    loop_detected: false,
    chain: []
  });
}

app.get('/api/trace', async (request, reply) => {
  const targetUrl = normalizeUrl(request.query.url);
  const traceContext = normalizeTraceContext(request.query.context);

  if (!targetUrl) {
    reply.code(400);
    return {
      error: 'Invalid or missing url query parameter. Use a full http(s) URL.',
      error_code: 'invalid_url',
      error_message: 'Invalid or missing url query parameter. Use a full http(s) URL.',
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
});

async function handleFinalLookup(request, reply) {
  const targetUrl = normalizeUrl(request.query.url);
  const format = typeof request.query.format === 'string' ? request.query.format.toLowerCase() : 'text';
  const traceContext = normalizeTraceContext(request.query.context);

  if (!targetUrl) {
    reply.code(400);
    if (format === 'json') {
      return {
        error: 'Invalid or missing url query parameter. Use a full http(s) URL.',
        error_code: 'invalid_url',
        error_message: 'Invalid or missing url query parameter. Use a full http(s) URL.',
        trace_context: traceContext
      };
    }

    reply.type('text/plain; charset=utf-8');
    return 'Invalid or missing url query parameter. Use a full http(s) URL.\n';
  }

  try {
    const result = await buildTracePayload(request, targetUrl, traceContext);

    if (format === 'json') {
      return {
        result_id: result.result_id || null,
        result_url: result.result_url || null,
        final_url: result.final_url,
        input_url: result.input_url,
        trace_context: result.trace_context,
        redirect_count: result.redirect_count,
        terminated_reason: result.terminated_reason,
        terminated_message: result.terminated_message,
        loop_detected: result.loop_detected,
        preview_url: result.preview_url,
        security: result.security
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
app.get('/api/f', handleFinalLookup);

app.get('/api/results/:resultId', async (request, reply) => {
  if (!historyStore || !historyStore.enabled) {
    reply.code(503);
    return {
      error: 'Result pages are not available until SQLite storage is enabled in the deployment environment.'
    };
  }

  const result = await historyStore.getResultById(request.params.resultId);
  if (!result) {
    reply.code(404);
    return {
      error: 'Result not found.'
    };
  }

  return enrichResultWithPublicUrls(result, getBaseUrl(request));
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

app.get('/admin', async (request, reply) => {
  return reply.sendFile('admin.html');
});

app.get('/result/:resultId', async (request, reply) => {
  if (!historyStore || !historyStore.enabled) {
    reply.code(503).type('text/html; charset=utf-8');
    return renderResultPageHtml(null, getBaseUrl(request));
  }

  const result = await historyStore.getResultById(request.params.resultId);
  if (!result) {
    reply.code(404).type('text/html; charset=utf-8');
    return renderResultPageHtml(null, getBaseUrl(request));
  }

  reply.type('text/html; charset=utf-8');
  return renderResultPageHtml(result, getBaseUrl(request));
});

app.get('/r/:resultId', async (request, reply) => {
  return reply.redirect(`/result/${encodeURIComponent(request.params.resultId)}`);
});

app.get('/health', async () => ({
  ok: true,
  storage_enabled: Boolean(historyStore && historyStore.enabled),
  web_risk_enabled: Boolean(WEB_RISK_API_KEY)
}));

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url && request.raw.url.startsWith('/api/')) {
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
