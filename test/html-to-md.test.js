'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { htmlToMarkdown } = require('../lib/html-to-md');

test('htmlToMarkdown converts headings, paragraphs, bold, and links', () => {
  const html = `
    <html>
      <head><title>Test Page</title><style>body { color: red; }</style></head>
      <body>
        <script>console.log("hello");</script>
        <h1>Main Heading</h1>
        <p>This is a <strong>bold</strong> statement with a <a href="https://example.com">link</a>.</p>
        <h2>Sub Heading</h2>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
        <blockquote>A wise quote here.</blockquote>
      </body>
    </html>
  `;

  const md = htmlToMarkdown(html);

  assert.ok(md.includes('# Main Heading'));
  assert.ok(md.includes('This is a **bold** statement with a [link](https://example.com).'));
  assert.ok(md.includes('## Sub Heading'));
  assert.ok(md.includes('- Item 1'));
  assert.ok(md.includes('- Item 2'));
  assert.ok(md.includes('> A wise quote here.'));
  assert.ok(!md.includes('console.log'));
  assert.ok(!md.includes('color: red'));
});

test('htmlToMarkdown handles empty or null input gracefully', () => {
  assert.equal(htmlToMarkdown(''), '');
  assert.equal(htmlToMarkdown(null), '');
  assert.equal(htmlToMarkdown(undefined), '');
});
