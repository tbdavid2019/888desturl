const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeUrl } = require('./url-cleaner');

test('removes Threads tracking parameters from the supplied final URL', () => {
  const result = analyzeUrl(
    'https://www.threads.com/@haneko0912/post/DbWbVBZE5l3?xmt=AQG0j5crXbV2eeukRLag1htO2brfmlACvTYVJ0zNgIeia8TkU6begh2ovw8G_F3B78SJvfH5&slof=1'
  );

  assert.equal(result.clean_url, 'https://www.threads.com/@haneko0912/post/DbWbVBZE5l3');
  assert.deepEqual(result.removed_tracking_parameters, ['xmt', 'slof']);
});

test('removes common tracking parameters and preserves functional parameters and fragments', () => {
  const result = analyzeUrl(
    'https://example.com/path?utm_source=newsletter&gclid=abc&id=42&state=keep#details'
  );

  assert.equal(result.clean_url, 'https://example.com/path?id=42&state=keep#details');
  assert.deepEqual(result.removed_tracking_parameters, ['utm_source', 'gclid']);
});

test('does not remove Threads-only parameters on other hosts', () => {
  const result = analyzeUrl('https://example.com/path?xmt=keep&slof=keep');

  assert.equal(result.clean_url, 'https://example.com/path?xmt=keep&slof=keep');
  assert.deepEqual(result.removed_tracking_parameters, []);
});

test('returns an empty analysis when the final URL is missing or invalid', () => {
  assert.deepEqual(analyzeUrl(null), {
    clean_url: null,
    removed_tracking_parameters: []
  });
  assert.deepEqual(analyzeUrl('not a URL'), {
    clean_url: null,
    removed_tracking_parameters: []
  });
});
