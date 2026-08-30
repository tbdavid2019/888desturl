'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

function readPublicFile(fileName) {
  return fs.readFileSync(path.join(publicDir, fileName), 'utf8');
}

test('homepage implements Chrome WebMCP Declarative API annotations on form and inputs', () => {
  const indexHtml = readPublicFile('index.html');

  assert.match(indexHtml, /toolname="trace_url"/);
  assert.match(indexHtml, /tooldescription="Trace the real final destination/);
  assert.match(indexHtml, /toolparamdescription="Target URL or bare domain to trace/);
});

test('homepage implements Chrome WebMCP Imperative API tool registration', () => {
  const indexHtml = readPublicFile('index.html');

  assert.match(indexHtml, /document\.modelContext/);
  assert.match(indexHtml, /navigator\.modelContext/);
  assert.match(indexHtml, /registerWebMcpTools/);
  assert.match(indexHtml, /name:\s*'trace_url'/);
  assert.match(indexHtml, /name:\s*'clean_url'/);
});
