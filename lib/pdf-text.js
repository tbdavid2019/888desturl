'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TEXT_BYTES = 1_000_000;
const DEFAULT_MAX_PAGES = 200;
const DEFAULT_PARSER_TIMEOUT_MS = 10_000;

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const MAX_PDF_BYTES = positiveIntegerEnv('PDF_MAX_BYTES', DEFAULT_MAX_PDF_BYTES);
const MAX_TEXT_BYTES = positiveIntegerEnv('PDF_MAX_OUTPUT_BYTES', DEFAULT_MAX_TEXT_BYTES);
const MAX_PAGES = positiveIntegerEnv('PDF_MAX_PAGES', DEFAULT_MAX_PAGES);
const PARSER_TIMEOUT_MS = positiveIntegerEnv('PDF_PARSER_TIMEOUT_MS', DEFAULT_PARSER_TIMEOUT_MS);

function extractPdfText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PDF_BYTES) {
    return Promise.reject(new Error(`PDF is empty or exceeds the ${MAX_PDF_BYTES}-byte limit`));
  }
  const executable = process.env.PDF_TEXT_BIN || path.resolve(__dirname, '../rust/pdf-text/target/release/pdf-text');

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const chunks = [];
    let outputSize = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('PDF parser timed out'));
    }, PARSER_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (error) => finish(error));
    child.stdout.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_TEXT_BYTES + 4096) {
        child.kill('SIGKILL');
        finish(new Error('PDF parser output exceeded limit'));
        return;
      }
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return finish(new Error('PDF parser returned invalid output')); }
      if (code !== 0 || result.error) return finish(new Error(result.error || 'PDF parsing failed'));
      if (typeof result.markdown !== 'string' || result.markdown.length > MAX_TEXT_BYTES ||
          !Number.isInteger(result.page_count) || result.page_count > MAX_PAGES) {
        return finish(new Error('PDF parser returned invalid or oversized text'));
      }
      finish(null, result);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

module.exports = { extractPdfText, MAX_PDF_BYTES, MAX_TEXT_BYTES, MAX_PAGES, PARSER_TIMEOUT_MS };
