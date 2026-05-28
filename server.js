const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TRACE_TIMEOUT_MS = 15000;
const SETTLE_WINDOW_MS = 1200;
const MAX_REDIRECT_STEPS = 20;
const MAX_REPEAT_URL_VISITS = 3;
const MAX_REPEAT_TRANSITIONS = 2;
const MAX_LINE_INTERMEDIATE_CLICKS = 2;
const LINE_IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.8.0';

const app = Fastify({
  logger: true,
  trustProxy: true
});

app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
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
- **Optional Context**: add \`&context=line\` for LINE-like mobile tracing when a link only works inside the LINE in-app browser
- **LINE CTA Assist**: in \`context=line\`, the tracer also attempts to click obvious "continue/open page" buttons on LINE-style intermediary pages
- **Method**: \`GET\`
- **Content Type**: \`application/json\`

## When To Use

Use this skill when the user wants to:

- find the final destination of a shortened or redirected URL
- inspect LIFF URLs or frontend-driven redirect flows
- verify whether a redirect is HTTP-based or browser-driven
- debug a redirect chain with status codes and timing details

## Workflow

1. Validate that the input is a full \`http://\` or \`https://\` URL.
2. URL-encode the target URL.
3. If the URL appears to depend on the LINE app or LIFF, add \`context=line\`.
4. If the user is in a shell or wants the shortest possible response, call:
   \`${shortFinalApi}?url=<encoded_target_url>\`
5. If the user only wants the destination, call:
   \`${finalUrlApi}?url=<encoded_target_url>\`
6. If the user wants the full redirect chain, call:
   \`${apiUrl}?url=<encoded_target_url>\`
7. Read \`final_url\` first and present it as the main answer.
8. Summarize \`redirect_count\` when using the trace endpoint.
9. If the user wants more detail, explain the ordered \`chain\`.

## Response Shape

Top-level fields:

- \`final_url\`
- \`input_url\`
- \`redirect_count\`
- \`chain\`

Each \`chain\` item may contain:

- \`step\`
- \`url\`
- \`from_url\`
- \`type\`
- \`status_code\`
- \`status_text\`
- \`method\`
- \`duration_ms\`

Trace responses may also include:

- \`terminated_reason\`
- \`terminated_message\`
- \`loop_detected\`

Error responses may include:

- \`error_code\`
- \`error_message\`
- \`trace_context\`

## Output Guidance

- Lead with \`final_url\`.
- Treat \`client_redirect\` as an important signal that the redirect happened in the browser, such as \`meta refresh\` or JavaScript navigation.
- If \`terminated_reason\` is not \`completed\`, explain that the result is partial and surface \`terminated_message\`.
- If the API returns an error, surface the error clearly and do not invent redirect results.

## Example

\`\`\`text
GET ${apiUrl}?url=https%3A%2F%2Fliff.line.me%2F1654038149-8ALRMLrb%2Fhuc7r%2F%3Furl%3Dstore
\`\`\`

## CLI Shortcut Example

\`\`\`text
curl -s "${shortFinalApi}?url=https://aiurl.tw/104"
\`\`\`

## LINE Context Example

\`\`\`text
GET ${apiUrl}?url=https%3A%2F%2Fmaac.io%2Fexample&context=line
\`\`\`
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

async function traceUrl(inputUrl, traceContext = 'default') {
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

      if (lineIntermediateClicks >= MAX_LINE_INTERMEDIATE_CLICKS) {
        break;
      }

      const clickedIntermediate = await maybeContinueLineIntermediate(page, traceContext);
      if (!clickedIntermediate) {
        break;
      }

      lineIntermediateClicks += 1;
      lastNavigationAt = Date.now();
    }

    if (!stopReason && Date.now() >= deadline) {
      stopReason = 'timeout';
      stopMessage = `Stopped tracing after ${TRACE_TIMEOUT_MS / 1000} seconds before navigation settled.`;
    }

    const seen = new Set();
    const responses = [...navigationResponses];
    const chain = [];
    let previousUrl = null;

    for (const event of navigationEvents) {
      const normalizedEventUrl = event.url.split('#')[0];
      const dedupeKey = `${previousUrl || 'root'}->${event.url}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const responseIndex = responses.findIndex(
        (entry) => entry.url.split('#')[0] === normalizedEventUrl
      );
      const response = responseIndex >= 0 ? responses.splice(responseIndex, 1)[0] : null;
      const isHttpRedirect = response && response.status >= 300 && response.status < 400;

      chain.push({
        step: chain.length + 1,
        url: event.url,
        from_url: previousUrl,
        type:
          chain.length === 0 ? 'initial' : isHttpRedirect ? 'http_redirect' : 'client_redirect',
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
      page_excerpt: pageExcerpt || null
    });
  } finally {
    await context.close();
    await browser.close();
  }
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
    return await traceUrl(targetUrl, traceContext);
  } catch (error) {
    const classified = classifyTraceError(error);
    request.log.error({ err: error, classified, targetUrl }, 'Trace failed');
    reply.code(classified.statusCode);
    return {
      error: classified.message,
      error_code: classified.code,
      error_message: classified.message,
      input_url: targetUrl,
      trace_context: traceContext,
      final_url: null,
      redirect_count: 0,
      chain: [],
      details: error.message
    };
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
    const result = await traceUrl(targetUrl, traceContext);

    if (format === 'json') {
      return {
        final_url: result.final_url,
        input_url: result.input_url,
        trace_context: result.trace_context,
        redirect_count: result.redirect_count,
        terminated_reason: result.terminated_reason,
        terminated_message: result.terminated_message,
        loop_detected: result.loop_detected
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
    reply.code(classified.statusCode);

    if (format === 'json') {
      return {
        error: classified.message,
        error_code: classified.code,
        error_message: classified.message,
        input_url: targetUrl,
        trace_context: traceContext,
        final_url: null,
        details: error.message
      };
    }

    reply.type('text/plain; charset=utf-8');
    return `Final URL lookup failed: ${classified.message}\n`;
  }
}

app.get('/api/final', handleFinalLookup);

app.get('/api/f', handleFinalLookup);

app.get('/ai-agent-skill', async (request, reply) => {
  const baseUrl = getBaseUrl(request);
  const markdown = buildSkillMarkdown(baseUrl);

  reply
    .type('text/markdown; charset=utf-8')
    .header('content-disposition', 'inline; filename="888desturl-url-trace.SKILL.md"');

  return markdown;
});

app.get('/health', async () => ({
  ok: true
}));

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url && request.raw.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }

  reply.sendFile('index.html');
});

app.listen({ port: PORT, host: HOST }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
