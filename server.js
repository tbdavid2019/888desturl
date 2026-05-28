const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TRACE_TIMEOUT_MS = 15000;
const SETTLE_WINDOW_MS = 1200;

const app = Fastify({
  logger: true
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

async function traceUrl(inputUrl) {
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

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true
  });
  const page = await context.newPage();

  const navigationResponses = [];
  const navigationEvents = [];
  const requestStartedAt = new WeakMap();
  let lastNavigationAt = Date.now();

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
    navigationEvents.push({
      url: frame.url(),
      observedAt: lastNavigationAt
    });
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
    while (Date.now() < deadline) {
      const idleFor = Date.now() - lastNavigationAt;
      const networkIdleReached = await page
        .waitForLoadState('networkidle', { timeout: 500 })
        .then(() => true)
        .catch(() => false);

      if (idleFor >= SETTLE_WINDOW_MS && networkIdleReached) {
        break;
      }

      await wait(250);
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

    return {
      final_url: finalUrl,
      input_url: inputUrl,
      redirect_count: Math.max(0, chain.length - 1),
      chain
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

app.get('/api/trace', async (request, reply) => {
  const targetUrl = normalizeUrl(request.query.url);

  if (!targetUrl) {
    reply.code(400);
    return {
      error: 'Invalid or missing url query parameter. Use a full http(s) URL.'
    };
  }

  try {
    return await traceUrl(targetUrl);
  } catch (error) {
    request.log.error({ err: error, targetUrl }, 'Trace failed');
    reply.code(500);
    return {
      error: 'Trace failed',
      input_url: targetUrl,
      final_url: null,
      redirect_count: 0,
      chain: [],
      details: error.message
    };
  }
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
