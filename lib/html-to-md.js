'use strict';

/**
 * Lightweight and robust HTML to Markdown converter and in-browser DOM extractor.
 */

function htmlToMarkdown(htmlString) {
  if (typeof htmlString !== 'string' || !htmlString.trim()) {
    return '';
  }

  let text = htmlString;

  // Strip script, style, noscript, svg, nav, header, footer tags and their contents
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  // Convert headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n\n##### $1\n\n');
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n\n###### $1\n\n');

  // Convert links [text](href)
  text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
    return cleanLabel ? `[${cleanLabel}](${href})` : href;
  });

  // Convert images ![alt](src)
  text = text.replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, '![$2]($1)');
  text = text.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, '![$1]($2)');
  text = text.replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)');

  // Convert bold and italic
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // Convert blockquotes
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    const lines = content.replace(/<[^>]+>/g, '').trim().split('\n');
    return '\n\n' + lines.map(l => `> ${l.trim()}`).join('\n') + '\n\n';
  });

  // Convert lists
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<\/(?:ul|ol)>/gi, '\n\n');

  // Convert linebreaks & paragraphs
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&copy;/g, '©');

  // Normalize excessive newlines and spaces
  text = text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Extracts clean markdown from an active Playwright page DOM.
 */
async function extractPageMarkdown(page) {
  if (!page) {
    return '';
  }

  try {
    const markdown = await page.evaluate(() => {
      // Clone document body to avoid mutating active page
      const clone = document.body.cloneNode(true);

      // Remove non-content elements
      const toRemove = clone.querySelectorAll(
        'script, style, noscript, iframe, svg, nav, footer, header, [role="navigation"], [aria-hidden="true"]'
      );
      toRemove.forEach((el) => el.remove());

      // Helper function to convert a DOM node to Markdown
      function nodeToMarkdown(node) {
        if (!node) return '';

        // Text node
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }

        const tag = node.tagName.toLowerCase();
        let inner = Array.from(node.childNodes).map(nodeToMarkdown).join('');

        switch (tag) {
          case 'h1':
            return `\n\n# ${inner.trim()}\n\n`;
          case 'h2':
            return `\n\n## ${inner.trim()}\n\n`;
          case 'h3':
            return `\n\n### ${inner.trim()}\n\n`;
          case 'h4':
            return `\n\n#### ${inner.trim()}\n\n`;
          case 'h5':
            return `\n\n##### ${inner.trim()}\n\n`;
          case 'h6':
            return `\n\n###### ${inner.trim()}\n\n`;
          case 'p':
            return inner.trim() ? `\n\n${inner.trim()}\n\n` : '';
          case 'blockquote':
            return `\n\n> ${inner.trim().replace(/\n+/g, '\n> ')}\n\n`;
          case 'a': {
            const href = node.getAttribute('href') || '';
            const label = inner.trim();
            if (!href || href.startsWith('javascript:')) return label;
            return label ? `[${label}](${href})` : href;
          }
          case 'img': {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            return src ? `![${alt}](${src})` : '';
          }
          case 'strong':
          case 'b':
            return inner.trim() ? ` **${inner.trim()}** ` : '';
          case 'em':
          case 'i':
            return inner.trim() ? ` *${inner.trim()}* ` : '';
          case 'code':
            return ` \`${inner.trim()}\` `;
          case 'pre':
            return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
          case 'li':
            return `\n- ${inner.trim()}`;
          case 'ul':
          case 'ol':
            return `\n\n${inner.trim()}\n\n`;
          case 'br':
            return '\n';
          case 'hr':
            return '\n\n---\n\n';
          case 'div':
          case 'section':
          case 'article':
          case 'main':
            return `\n${inner}\n`;
          default:
            return inner;
        }
      }

      const rawMd = nodeToMarkdown(clone);
      return rawMd
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    });

    return markdown || '';
  } catch (err) {
    return '';
  }
}

module.exports = {
  htmlToMarkdown,
  extractPageMarkdown
};
