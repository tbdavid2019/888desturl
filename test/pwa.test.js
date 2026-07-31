const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

function readPublicFile(fileName) {
  return fs.readFileSync(path.join(publicDir, fileName), 'utf8');
}

test('web app manifest contains the required install metadata and icons', () => {
  const manifest = JSON.parse(readPublicFile('manifest.webmanifest'));

  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0f766e');
  assert.equal(manifest.background_color, '#f8fafc');

  const iconSizes = new Set(manifest.icons.map((icon) => icon.sizes));
  assert.ok(iconSizes.has('192x192'));
  assert.ok(iconSizes.has('512x512'));

  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(publicDir, icon.src.replace(/^\//, ''))));
  }

  assert.deepEqual(manifest.share_target, {
    action: '/',
    method: 'GET',
    params: {
      title: 'shared_title',
      text: 'shared_text',
      url: 'shared_url'
    }
  });
});

test('service worker precaches the offline shell and never caches API requests', () => {
  const serviceWorker = readPublicFile('service-worker.js');

  assert.match(serviceWorker, /offline\.html/);
  assert.match(serviceWorker, /request\.method !== 'GET'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /caches\.delete/);
});

test('public pages expose PWA metadata and register the service worker', () => {
  const indexHtml = readPublicFile('index.html');
  const resultHtml = readPublicFile('result.html');

  for (const html of [indexHtml, resultHtml]) {
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /name="theme-color" content="#0f766e"/);
  }

  for (const html of [indexHtml, resultHtml]) {
    assert.match(html, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/);
  }
  assert.match(indexHtml, /beforeinstallprompt/);
  assert.match(indexHtml, /id="install-button"/);
  assert.match(indexHtml, /id="install-dialog"/);
  assert.match(indexHtml, /showInstallDialog\(\)/);
  assert.match(indexHtml, /id="install-dialog-confirm"/);
});

test('homepage presents the 888 URL mark and traces URLs received from Android share sheets', () => {
  const indexHtml = readPublicFile('index.html');

  assert.match(indexHtml, /aria-label="888 URL"/);
  assert.match(indexHtml, />888<\/span>/);
  assert.match(indexHtml, />URL<\/span>/);
  assert.match(indexHtml, /searchParams\.get\('shared_url'\)/);
  assert.match(indexHtml, /searchParams\.get\('shared_text'\)/);
  assert.match(indexHtml, /form\.requestSubmit\(\)/);
  assert.match(indexHtml, /window\.history\.replaceState/);
});
