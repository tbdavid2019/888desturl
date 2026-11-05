'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicIp(normalized.slice(7));
    return normalized !== '::' && normalized !== '::1' &&
      !/^f[cd]/.test(normalized) && !/^fe[89ab]/.test(normalized) && !/^ff/.test(normalized);
  }
  return false;
}

function resolvePublic(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('PDF host resolves to a non-public IP address');
    return Promise.resolve(hostname);
  }
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return reject(error);
      if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
        return reject(new Error('PDF host resolves to a non-public IP address'));
      }
      resolve(addresses[0].address);
    });
  });
}

function resolvePublicWithTimeout(hostname, timeoutMs) {
  let timer;
  return Promise.race([
    resolvePublic(hostname),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('PDF download timed out')), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function getOnce(url, { maxBytes, deadlineAt, redirectsLeft }) {
  const remainingMs = deadlineAt - Date.now();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (remainingMs <= 0) return Promise.reject(new Error('PDF download timed out'));
  return resolvePublicWithTimeout(hostname, remainingMs).then((address) => new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const req = transport.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/pdf, application/octet-stream;q=0.9, */*;q=0.1',
        'Accept-Encoding': 'identity',
        'User-Agent': '888desturl PDF extractor'
      },
      lookup: (_hostname, _options, callback) => callback(null, address, net.isIP(address)),
      servername: net.isIP(hostname) ? undefined : hostname
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.destroy();
        if (redirectsLeft <= 0 || !res.headers.location) return finish(new Error('PDF redirect limit exceeded'));
        const next = new URL(res.headers.location, url);
        if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) {
          return finish(new Error('Unsupported or unsafe PDF redirect URL'));
        }
        return finish(null, getOnce(next, { maxBytes, deadlineAt, redirectsLeft: redirectsLeft - 1 }));
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        return finish(new Error(`PDF download returned HTTP ${status}`));
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        return finish(new Error(`PDF exceeds the ${maxBytes}-byte limit`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy(new Error(`PDF exceeds the ${maxBytes}-byte limit`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(null, Buffer.concat(chunks, total)));
      res.on('error', finish);
    });
    const timer = setTimeout(() => req.destroy(new Error('PDF download timed out')), Math.max(1, deadlineAt - Date.now()));
    timer.unref?.();
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    req.on('error', finish);
    req.end();
  }));
}

async function downloadPdfBytes(rawUrl, { maxBytes, timeoutMs = 10_000, maxRedirects = 8 }) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported or unsafe PDF URL');
  }
  return getOnce(url, { maxBytes, deadlineAt: Date.now() + timeoutMs, redirectsLeft: maxRedirects });
}

module.exports = { downloadPdfBytes, isPublicIp };
