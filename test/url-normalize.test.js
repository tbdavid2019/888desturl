'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeUrl } = require('../lib/url-cleaner');

test('normalizeUrl keeps valid http and https URLs intact', () => {
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('https://example.com/test?foo=bar#section'), 'https://example.com/test?foo=bar#section');
  assert.equal(normalizeUrl('http://example.com/path'), 'http://example.com/path');
  assert.equal(normalizeUrl('https://aiurl.tw/104'), 'https://aiurl.tw/104');
});

test('normalizeUrl automatically prepends https:// to domain names without scheme', () => {
  assert.equal(normalizeUrl('david888.com'), 'https://david888.com/');
  assert.equal(normalizeUrl('david888.com/some/path?a=1&b=2'), 'https://david888.com/some/path?a=1&b=2');
  assert.equal(normalizeUrl('www.google.com'), 'https://www.google.com/');
  assert.equal(normalizeUrl('bit.ly/3XYZ'), 'https://bit.ly/3XYZ');
  assert.equal(normalizeUrl('sub.domain.example.co.uk/page'), 'https://sub.domain.example.co.uk/page');
});

test('normalizeUrl supports protocol-relative URLs', () => {
  assert.equal(normalizeUrl('//example.com/image.png'), 'https://example.com/image.png');
});

test('normalizeUrl handles localhost with or without port', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeUrl('localhost:3000/api/health'), 'http://localhost:3000/api/health');
  assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000/');
});

test('normalizeUrl rejects invalid or non-URL strings', () => {
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('   '), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(undefined), null);
  assert.equal(normalizeUrl(123), null);
  assert.equal(normalizeUrl('not-a-domain'), null);
  assert.equal(normalizeUrl('foo bar'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('ftp://example.com'), null);
});
