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
  assert.match(indexHtml, /web technologies/i);
  assert.match(indexHtml, /toolparamdescription="Target URL or bare domain to trace/);
});

test('homepage implements Chrome WebMCP Imperative API tool registration with technologies', () => {
  const indexHtml = readPublicFile('index.html');

  assert.match(indexHtml, /document\.modelContext/);
  assert.match(indexHtml, /navigator\.modelContext/);
  assert.match(indexHtml, /registerWebMcpTools/);
  assert.match(indexHtml, /name:\s*'trace_url'/);
  assert.match(indexHtml, /name:\s*'clean_url'/);
  assert.match(indexHtml, /technologies:\s*payload\.technologies/);
});

test('homepage and result page display Chrome WebMCP support badge, llms.txt, and REST API in footer', () => {
  const indexHtml = readPublicFile('index.html');
  const resultHtml = readPublicFile('result.html');

  assert.match(indexHtml, /支援 Chrome WebMCP/);
  assert.match(indexHtml, /href="\/llms\.txt"/);
  assert.match(indexHtml, /href="\/trace\?url=/);
  assert.match(indexHtml, /id="features-overview"/);
  assert.match(indexHtml, /https:\/\/developer\.chrome\.com\/docs\/ai\/webmcp/);

  assert.match(resultHtml, /支援 Chrome WebMCP/);
  assert.match(resultHtml, /href="\/llms\.txt"/);
  assert.match(resultHtml, /href="\/trace\?url=/);
  assert.match(resultHtml, /https:\/\/developer\.chrome\.com\/docs\/ai\/webmcp/);
});
