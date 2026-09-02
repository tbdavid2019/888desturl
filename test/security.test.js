'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createAdminAuth } = require('../lib/admin-auth');
const { htmlToMarkdown } = require('../lib/html-to-md');

test('admin auth uses timing-safe hashed comparison for credentials', () => {
  const auth = createAdminAuth({
    username: 'admin',
    password: 'secret-password-123'
  });

  const valid = auth.authenticate({ ip: '127.0.0.1', headers: {} }, 'admin', 'secret-password-123');
  assert.equal(valid.ok, true);
  assert.equal(valid.statusCode, 200);

  const invalidPassword = auth.authenticate({ ip: '127.0.0.1', headers: {} }, 'admin', 'wrong');
  assert.equal(invalidPassword.ok, false);
  assert.equal(invalidPassword.statusCode, 401);

  const invalidUser = auth.authenticate({ ip: '127.0.0.1', headers: {} }, 'hacker', 'secret-password-123');
  assert.equal(invalidUser.ok, false);
  assert.equal(invalidUser.statusCode, 401);

  const emptyCredentials = auth.authenticate({ ip: '127.0.0.1', headers: {} }, '', '');
  assert.equal(emptyCredentials.ok, false);
});

test('htmlToMarkdown sanitizes javascript: pseudo-protocols in links', () => {
  const dangerousHtml = `
    <div>
      <a href="javascript:alert('xss')">Malicious Link</a>
      <a href="https://safe-domain.com">Safe Link</a>
      <script>alert(1)</script>
    </div>
  `;

  const md = htmlToMarkdown(dangerousHtml);
  assert.ok(!md.includes('javascript:'));
  assert.ok(!md.includes('alert(1)'));
  assert.ok(md.includes('[Safe Link](https://safe-domain.com)'));
});

test('server.js defines cloud metadata SSRF protection and security headers', () => {
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.ok(serverJs.includes('169.254.169.254'), 'server.js must block AWS/GCP cloud metadata IP');
  assert.ok(serverJs.includes('metadata.google.internal'), 'server.js must block Google cloud metadata hostname');
  assert.ok(serverJs.includes('X-Content-Type-Options'), 'server.js must set X-Content-Type-Options');
  assert.ok(serverJs.includes('nosniff'), 'server.js must specify nosniff');
  assert.ok(serverJs.includes('X-Frame-Options'), 'server.js must set X-Frame-Options');
  assert.ok(serverJs.includes('Referrer-Policy'), 'server.js must set Referrer-Policy');
  assert.ok(serverJs.includes('Permissions-Policy'), 'server.js must set Permissions-Policy');
});

test('frontend HTML files implement escapeHtml and sanitizeHref defenses', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'result.html'), 'utf8');

  assert.ok(adminHtml.includes('function escapeHtml'), 'admin.html must define escapeHtml');
  assert.ok(adminHtml.includes('function sanitizeHref'), 'admin.html must define sanitizeHref');
  assert.ok(indexHtml.includes('function escapeHtml'), 'index.html must define escapeHtml');
  assert.ok(indexHtml.includes('function sanitizeHref'), 'index.html must define sanitizeHref');
  assert.ok(resultHtml.includes('function escapeHtml'), 'result.html must define escapeHtml');
  assert.ok(resultHtml.includes('function sanitizeHref'), 'result.html must define sanitizeHref');
});
