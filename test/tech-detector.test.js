'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  detectTechnologies,
  extractPageTechSignals,
  parsePattern,
  resolveBackreferences,
  evaluatePattern
} = require('../lib/tech-detector');

test('pattern parser handles static regex, version substitution, ternaries, and confidence', () => {
  // 1. Version extraction
  const p1 = parsePattern('nginx(?:/([\\d.]+))?\\;version:\\1');
  assert.equal(p1.confidence, 100);
  assert.equal(p1.versionPattern, '\\1');
  const res1 = evaluatePattern(p1, 'nginx/1.24.0');
  assert.equal(res1.match, true);
  assert.equal(res1.version, '1.24.0');
  assert.equal(res1.confidence, 100);

  // Match without version group
  const res1b = evaluatePattern(p1, 'nginx');
  assert.equal(res1b.match, true);
  assert.equal(res1b.version, null);

  // 2. Ternary conditional version
  const p2 = parsePattern('^(next)?.*$\\;version:\\1?Next:Classic');
  const res2True = evaluatePattern(p2, 'next-gen-runtime');
  assert.equal(res2True.match, true);
  assert.equal(res2True.version, 'Next');

  const res2False = evaluatePattern(p2, 'legacy-runtime');
  assert.equal(res2False.match, true);
  assert.equal(res2False.version, 'Classic');

  // 3. Custom confidence
  const p3 = parsePattern('custom-header\\;confidence:65');
  assert.equal(p3.confidence, 65);
  const res3 = evaluatePattern(p3, 'custom-header');
  assert.equal(res3.match, true);
  assert.equal(res3.confidence, 65);

  // 4. Empty regex (matches on presence)
  const p4 = parsePattern('\\;confidence:50');
  assert.equal(p4.regex, null);
  assert.equal(p4.confidence, 50);
  const res4 = evaluatePattern(p4, 'any-value');
  assert.equal(res4.match, true);
  assert.equal(res4.confidence, 50);

  const res4Null = evaluatePattern(p4, null);
  assert.equal(res4Null, null);
});

test('detectTechnologies matches server headers and extracts version', () => {
  const signals = {
    headers: {
      server: 'nginx/1.24.0',
      'x-powered-by': 'PHP/8.2.14'
    }
  };

  const detected = detectTechnologies(signals);
  const nginx = detected.find((t) => t.name === 'Nginx');
  assert.ok(nginx, 'Should detect Nginx from Server header');
  assert.equal(nginx.version, '1.24.0');
  assert.ok(nginx.categories.some((c) => c.name === 'Web servers'));

  const php = detected.find((t) => t.name === 'PHP');
  assert.ok(php, 'Should detect PHP from X-Powered-By header');
  assert.equal(php.version, '8.2.14');
  assert.ok(php.categories.some((c) => c.name === 'Programming languages'));
});

test('detectTechnologies matches meta tags and recursively resolves implies', () => {
  const signals = {
    meta: [
      { name: 'generator', content: 'WordPress 6.5.2' }
    ]
  };

  const detected = detectTechnologies(signals);
  const wp = detected.find((t) => t.name === 'WordPress');
  assert.ok(wp, 'Should detect WordPress from meta generator');
  assert.equal(wp.version, '6.5.2');
  assert.ok(wp.categories.some((c) => c.name === 'CMS'));

  // WordPress implies PHP and MySQL
  const php = detected.find((t) => t.name === 'PHP');
  assert.ok(php, 'WordPress should imply PHP');

  const mysql = detected.find((t) => t.name === 'MySQL');
  assert.ok(mysql, 'WordPress should imply MySQL');
});

test('detectTechnologies handles circular implies safely', () => {
  const customDb = {
    categories: {
      '1': { name: 'Category 1' }
    },
    technologies: {
      TechA: {
        cats: [1],
        headers: { 'x-test': 'techa' },
        implies: ['TechB']
      },
      TechB: {
        cats: [1],
        implies: ['TechA']
      }
    }
  };

  const detected = detectTechnologies({ headers: { 'x-test': 'techa' } }, customDb);
  assert.equal(detected.length, 2);
  assert.ok(detected.some((t) => t.name === 'TechA'));
  assert.ok(detected.some((t) => t.name === 'TechB'));
});

test('detectTechnologies matches scriptSrc, cookies, and JS globals', () => {
  const signals = {
    cookies: {
      NEXT_LOCALE: 'en'
    },
    scriptSrc: [
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
      'https://code.jquery.com/jquery-3.6.0.min.js'
    ],
    js: {
      'jQuery.fn.jquery': '3.6.0'
    }
  };

  const detected = detectTechnologies(signals);
  const bootstrap = detected.find((t) => t.name === 'Bootstrap');
  assert.ok(bootstrap, 'Should detect Bootstrap from scriptSrc');

  const jquery = detected.find((t) => t.name === 'jQuery');
  assert.ok(jquery, 'Should detect jQuery from scriptSrc or JS');

  const nextjs = detected.find((t) => t.name === 'Next.js');
  assert.ok(nextjs, 'Should detect Next.js from cookie');
});

test('detectTechnologies handles null, undefined, and malformed inputs gracefully', () => {
  assert.deepEqual(detectTechnologies(null), []);
  assert.deepEqual(detectTechnologies(undefined), []);
  assert.deepEqual(detectTechnologies('not-an-object'), []);
  assert.deepEqual(detectTechnologies({}), []);
  assert.deepEqual(
    detectTechnologies({
      headers: null,
      cookies: 'invalid-string',
      meta: 'invalid-meta',
      scriptSrc: null,
      js: null,
      html: null,
      dom: null
    }),
    []
  );
});

test('extractPageTechSignals extracts headers from navigationResponses and cookies from context', async () => {
  const mockResponses = [
    {
      url: 'https://example.com/initial',
      headers: {
        Server: 'nginx/1.24.0',
        'X-Cache': 'HIT'
      }
    },
    {
      url: 'https://example.com/final',
      headers: async () => ({
        Server: 'Apache/2.4.52',
        'X-Powered-By': 'PHP/8.1.0'
      })
    }
  ];

  const mockContext = {
    cookies: async () => [
      { name: 'PHPSESSID', value: 'session123' },
      { name: 'theme', value: 'dark' }
    ]
  };

  const signals = await extractPageTechSignals(null, mockResponses, mockContext);
  assert.equal(signals.headers.server, 'Apache/2.4.52');
  assert.equal(signals.headers['x-powered-by'], 'PHP/8.1.0');
  assert.equal(signals.headers['x-cache'], 'HIT');
  assert.equal(signals.cookies.PHPSESSID, 'session123');
  assert.equal(signals.cookies.theme, 'dark');
});

test('result.html includes Web Technologies section with DOM XSS defenses', () => {
  const resultPath = path.join(__dirname, '..', 'public', 'result.html');
  const resultHtml = fs.readFileSync(resultPath, 'utf8');

  // Verify UI section elements exist
  assert.ok(resultHtml.includes('id="tech-section"'), 'result.html must include tech-section');
  assert.ok(resultHtml.includes('id="tech-list"'), 'result.html must include tech-list container');
  assert.ok(resultHtml.includes('id="tech-empty"'), 'result.html must include tech-empty state');
  assert.ok(resultHtml.includes('id="tech-count-text"'), 'result.html must include tech-count-text badge');

  // Verify renderTechnologies function and XSS escaping
  assert.ok(resultHtml.includes('function renderTechnologies'), 'result.html must define renderTechnologies');
  assert.ok(resultHtml.includes('escapeHtml(tech.name)'), 'tech.name must be escaped with escapeHtml');
  assert.ok(resultHtml.includes('sanitizeHref(tech.website)'), 'tech.website must be sanitized with sanitizeHref');
});

test('index.html includes Web Technologies section with DOM XSS defenses', () => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  assert.ok(indexHtml.includes('id="tech-section"'), 'index.html must include tech-section');
  assert.ok(indexHtml.includes('id="tech-list"'), 'index.html must include tech-list container');
  assert.ok(indexHtml.includes('id="tech-empty"'), 'index.html must include tech-empty state');
  assert.ok(indexHtml.includes('function renderTechnologies'), 'index.html must define renderTechnologies');
  assert.ok(indexHtml.includes('escapeHtml(tech.name)'), 'tech.name must be escaped with escapeHtml');
  assert.ok(indexHtml.includes('sanitizeHref(tech.website)'), 'tech.website must be sanitized with sanitizeHref');
});

test('storage maps technologies_json to array and handles empty/corrupted JSON safely', () => {
  const { mapHistoryRow } = require('../lib/storage');

  // Valid technologies_json
  const sampleTechs = [
    { name: 'Nginx', version: '1.24.0', categories: [{ id: 22, name: 'Web servers' }] }
  ];
  const rowWithTech = {
    id: 1,
    public_result_id: 'abc123xyz',
    created_at: new Date().toISOString(),
    input_url: 'https://example.com',
    final_url: 'https://example.com/final',
    client_type: 'web',
    request_path: '/api/trace',
    redirect_count: 1,
    step_count: 2,
    technologies_json: JSON.stringify(sampleTechs)
  };

  const mapped1 = mapHistoryRow(rowWithTech);
  assert.equal(Array.isArray(mapped1.technologies), true);
  assert.equal(mapped1.technologies.length, 1);
  assert.equal(mapped1.technologies[0].name, 'Nginx');
  assert.equal(mapped1.technologies[0].version, '1.24.0');

  // Null technologies_json
  const rowNull = { ...rowWithTech, technologies_json: null };
  const mapped2 = mapHistoryRow(rowNull);
  assert.deepEqual(mapped2.technologies, []);

  // Corrupted technologies_json
  const rowCorrupt = { ...rowWithTech, technologies_json: 'not-valid-json{{' };
  const mapped3 = mapHistoryRow(rowCorrupt);
  assert.deepEqual(mapped3.technologies, []);
});

test('server.js defines /trace and /api/final-url endpoints and integrates tech-detector', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverJs = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverJs.includes("require('./lib/tech-detector')"), 'server.js must require tech-detector');
  assert.ok(serverJs.includes("app.get('/trace'"), 'server.js must define /trace route');
  assert.ok(serverJs.includes("app.get('/api/final-url'"), 'server.js must define /api/final-url route');
  assert.ok(serverJs.includes('technologies:'), 'server.js storage integration must reference technologies');
});
