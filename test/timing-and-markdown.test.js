'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('index.html and result.html include total time, timing log, and 2md markdown section', () => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  const resultPath = path.join(__dirname, '..', 'public', 'result.html');

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const resultHtml = fs.readFileSync(resultPath, 'utf8');

  // Index HTML checks
  assert.ok(indexHtml.includes('id="total-duration"'), 'index.html should have total-duration element');
  assert.ok(indexHtml.includes('id="markdown-section"'), 'index.html should have markdown-section element');
  assert.ok(indexHtml.includes('id="markdown-viewer"'), 'index.html should have markdown-viewer element');
  assert.ok(indexHtml.includes('id="copy-markdown-button"'), 'index.html should have copy-markdown-button element');
  assert.ok(indexHtml.includes('id="open-2md-link"'), 'index.html should have open-2md-link element');
  assert.ok(indexHtml.includes('2md 雙路線') || indexHtml.includes('2md.aiurl.tw'), 'index.html should mention 2md dual-route');
  assert.ok(indexHtml.includes('totalTimeStat'), 'index.html should have totalTimeStat translation key');

  // Result HTML checks
  assert.ok(resultHtml.includes('id="total-duration"'), 'result.html should have total-duration element');
  assert.ok(resultHtml.includes('id="markdown-section"'), 'result.html should have markdown-section element');
  assert.ok(resultHtml.includes('id="markdown-viewer"'), 'result.html should have markdown-viewer element');
  assert.ok(resultHtml.includes('id="copy-markdown-button"'), 'result.html should have copy-markdown-button element');
  assert.ok(resultHtml.includes('id="open-2md-link"'), 'result.html should have open-2md-link element');
});
