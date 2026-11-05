'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHistoryStore } = require('../lib/storage');

test('history persists PDF metadata and extraction failures', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desturl-pdf-history-'));
  const store = await createHistoryStore({ dataDir, logger: { warn() {} } });
  t.after(async () => { await store.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  if (!store.enabled) return t.skip('sqlite3 is not installed in this test environment');
  await store.initialize();
  const saved = await store.recordTrace({
    created_at: new Date().toISOString(), input_url: 'https://example.com/report.pdf',
    final_url: 'https://example.com/report.pdf', client_type: 'api', request_path: '/trace',
    redirect_count: 0, step_count: 1, threat_types: [], loop_detected: false, chain: [], technologies: [],
    security_status: 'unknown', security_source: 'google_webrisk',
    markdown_content: '# report', content_type: 'application/pdf', pdf_page_count: 2,
    pdf_extraction_error: null
  });
  const loaded = await store.getResultById(saved.result_id);
  assert.equal(loaded.content_type, 'application/pdf');
  assert.equal(loaded.pdf_page_count, 2);
  assert.equal(loaded.pdf_extraction_error, null);
  const failed = await store.recordTrace({
    created_at: new Date().toISOString(), input_url: 'https://example.com/scan.pdf',
    final_url: 'https://example.com/scan.pdf', client_type: 'api', request_path: '/trace',
    redirect_count: 0, step_count: 1, threat_types: [], loop_detected: false, chain: [], technologies: [],
    security_status: 'unknown', security_source: 'google_webrisk', content_type: 'application/pdf',
    pdf_extraction_error: 'Encrypted PDF is not supported'
  });
  assert.equal(failed.pdf_extraction_error, 'Encrypted PDF is not supported');
});
