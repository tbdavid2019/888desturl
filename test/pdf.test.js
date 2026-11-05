'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadPdfBytes, isPublicIp } = require('../lib/pdf-download');
const { extractPdfText, MAX_PDF_BYTES } = require('../lib/pdf-text');

test('PDF downloader rejects private and loopback destinations before connecting', async () => {
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('10.0.0.1'), false);
  assert.equal(isPublicIp('::1'), false);
  assert.equal(isPublicIp('8.8.8.8'), true);
  await assert.rejects(downloadPdfBytes('http://127.0.0.1/file.pdf', { maxBytes: MAX_PDF_BYTES }), /non-public/);
});

test('PDF parser wrapper rejects non-PDF and oversized buffers before spawning', async () => {
  await assert.rejects(extractPdfText(Buffer.from('not pdf')), /PDF/);
  await assert.rejects(extractPdfText(Buffer.alloc(MAX_PDF_BYTES + 1)), /limit/);
});
