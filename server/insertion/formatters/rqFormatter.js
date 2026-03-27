/**
 * server/insertion/formatters/rqFormatter.js
 * --------------------------------------------
 * Phase 9: Real Quantum (TinyMCE) destination formatter.
 *
 * Real Quantum uses TinyMCE rich-text editors that accept HTML.
 * This formatter:
 *   - Wraps plain text in proper HTML paragraphs
 *   - Sanitizes existing HTML (strip unsafe tags, normalize structure)
 *   - Normalizes whitespace and paragraph breaks
 *   - Converts smart quotes to HTML-safe equivalents
 *   - Preserves substantive narrative content
 *
 * Does NOT silently over-trim substantive narrative.
 */

/**
 * Format canonical text for Real Quantum TinyMCE insertion.
 *
 * @param {import('../types.js').FormatInput} input
 * @returns {import('../types.js').FormatOutput}
 */
export function formatForRq(input) {
  const { canonicalText, fieldId } = input;
  const warnings = [];

  if (!canonicalText || canonicalText.trim().length === 0) {
    return {
      formattedText: '',
      mode: 'html',
      warnings: ['Empty canonical text'],
      truncated: false,
      originalLength: 0,
      formattedLength: 0,
    };
  }

  let text = canonicalText;

  // Determine if input is already HTML or plain text
  const isHtml = /<[^>]+>/.test(text);

  if (isHtml) {
    // Input is HTML — sanitize and normalize
    text = sanitizeHtml(text, warnings);
  } else {
    // Input is plain text — convert to HTML paragraphs
    text = plainTextToHtml(text);
  }

  // Normalize smart quotes and special characters for HTML
  text = normalizeSpecialChars(text);

  // Final cleanup
  text = text.trim();

  if (text.length > 100000) {
    warnings.push(`HTML length ${text.length} is very large — may cause TinyMCE performance issues`);
  }

  return {
    formattedText: text,
    mode: 'html',
    warnings,
    truncated: false,
    originalLength: canonicalText.length,
    formattedLength: text.length,
  };
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Convert plain text to HTML paragraphs.
 * Double newlines become paragraph breaks.
 * Single newlines become <br> tags.
 *
 * @param {string} text
 * @returns {string}
 */
function plainTextToHtml(text) {
  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split on double newlines (paragraph breaks)
  const paragraphs = text.split(/\n{2,}/);

  const htmlParagraphs = paragraphs
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      // Convert single newlines within a paragraph to <br>
      const inner = escapeHtml(p).replace(/\n/g, '<br>');
      return `<p>${inner}</p>`;
    });

  return htmlParagraphs.join('\n');
}

/**
 * Sanitize existing HTML for TinyMCE.
 * Allows safe formatting tags, strips dangerous ones.
 *
 * @param {string} html
 * @param {string[]} warnings
 * @returns {string}
 */
function sanitizeHtml(html, warnings) {
  let text = html;

  // Allowed tags (TinyMCE safe)
  const allowedTags = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'blockquote', 'pre', 'code', 'span', 'div',
    'sub', 'sup', 'hr',
  ]);

  // Strip script, style, iframe, object, embed tags entirely (with content)
  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'];
  for (const tag of dangerousTags) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    if (regex.test(text)) {
      warnings.push(`Stripped dangerous <${tag}> tag`);
      text = text.replace(regex, '');
    }
  }

  // Strip event handler attributes (onclick, onerror, etc.)
  text = text.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Strip javascript: URLs
  text = text.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // Remove tags not in allowlist (keep content)
  text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
    if (allowedTags.has(tagName.toLowerCase())) {
      return match;
    }
    return ''; // Strip the tag but keep surrounding content
  });

  // Normalize empty paragraphs
  text = text.replace(/<p>\s*<\/p>/g, '');

  // Collapse excessive whitespace between tags
  text = text.replace(/>\s{3,}</g, '>\n<');

  return text;
}

/**
 * Escape HTML special characters in plain text.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalize smart quotes and special characters for HTML output.
 * Unlike ACI formatter, we keep Unicode but ensure they're HTML-safe.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeSpecialChars(text) {
  return text
    // Smart double quotes → straight (more reliable in TinyMCE)
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Smart single quotes → straight
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Non-breaking space → regular space
    .replace(/\u00A0/g, ' ');
}
