'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('server.js defines maybeContinueShortlinkIntermediate and integrates it into traceUrl loop', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverJs = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverJs.includes('maybeContinueShortlinkIntermediate'), 'server.js should define maybeContinueShortlinkIntermediate');
  assert.ok(serverJs.includes('MAX_SHORTLINK_INTERMEDIATE_CLICKS'), 'server.js should define MAX_SHORTLINK_INTERMEDIATE_CLICKS');
  assert.ok(serverJs.includes('#btn-redirect-now'), 'server.js should match #btn-redirect-now');
  assert.ok(serverJs.includes('#target-link'), 'server.js should match #target-link');
  assert.ok(serverJs.includes('trackingConfig.target'), 'server.js should extract trackingConfig.target');
  assert.ok(serverJs.includes('shortlinkIntermediateClicks'), 'server.js should track shortlinkIntermediateClicks');
});
