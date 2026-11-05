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

test('extractPdfText successfully parses valid PDF and returns markdown and page_count', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const bin = process.env.PDF_TEXT_BIN || path.resolve(__dirname, '../rust/pdf-text/target/release/pdf-text');
  if (!fs.existsSync(bin)) {
    return t.skip('pdf-text binary not built yet; run npm run build:pdf first');
  }

  const minimalValidPdf = Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n' +
    '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello World 888) Tj ET\nendstream\nendobj\n' +
    'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000305 00000 n \n' +
    'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n398\n%%EOF'
  );

  const result = await extractPdfText(minimalValidPdf);
  assert.equal(result.page_count, 1);
  assert.match(result.markdown, /Hello World 888/);
});
