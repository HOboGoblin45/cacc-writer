/**
 * server/insertion/formatters/aciFormatter.js
 * ---------------------------------------------
 * Phase 9: ACI desktop destination formatter.
 *
 * ACI uses TX32 rich-edit controls that accept plain text.
 * This formatter:
 *   - Strips HTML tags
 *   - Normalizes line endings to \r\n (Windows)
 *   - Normalizes repeated whitespace
 *   - Converts smart quotes to straight quotes
 *   - Normalizes paragraph breaks
 *   - Preserves substantive narrative content
 *
 * Does NOT silently over-trim substantive narrative.
 */

/**
 * Format canonical text for ACI insertion.
 *
 * @param {import('../types.js').FormatInput} input
 * @returns {import('../types.js').FormatOutput}
 */
export function formatForAci(input) {
  const { canonicalText, fieldId } = input;
  const warnings = [];

  if (!canonicalText || canonicalText.trim().length === 0) {
    return {
      formattedText: '',
      mode: 'plain_text',
      warnings: ['Empty canonical text'],
      truncated: false,
      originalLength: 0,
      formattedLength: 0,
    };
  }

  let text = canonicalText;

  // 1. Strip HTML tags if present
  if (/<[^>]+>/.test(text)) {
    text = stripHtml(text);
    warnings.push('HTML tags stripped for ACI plain text');
  }

  // 2. Decode HTML entities
  text = decodeHtmlEntities(text);

  // 3. Convert smart quotes and special characters
  text = normalizeQuotes(text);

  // 4. Normalize whitespace (preserve paragraph breaks)
  text = normalizeWhitespace(text);

  // 5. Normalize line endings to Windows \r\n
  text = normalizeLineEndings(text);

  // 6. Trim leading/trailing whitespace
  text = text.trim();

  // Check for potential issues
  if (text.length > 32000) {
    warnings.push(`Text length ${text.length} may exceed ACI TX32 field capacity`);
  }

  return {
    formattedText: text,
    mode: 'plain_text',
    warnings,
    truncated: false,
    originalLength: canonicalText.length,
    formattedLength: text.length,
  };
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Strip HTML tags, converting block elements to line breaks.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  let text = html;

  // Convert block-level elements to double newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(td|th)>/gi, '\t');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  return text;
}

/**
 * Decode common HTML entities.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&bull;': '•',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&frac12;': '½',
    '&frac14;': '¼',
    '&frac34;': '¾',
    '&deg;': '°',
    '&plusmn;': '±',
    '&times;': '×',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replaceAll(entity, char);
  }

  // Numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => {
    const num = parseInt(code, 10);
    return num > 0 && num < 65536 ? String.fromCharCode(num) : '';
  });

  return result;
}

/**
 * Convert smart quotes and other problematic characters to ASCII equivalents.
 * @param {string} text
 * @returns {string}
 */
function normalizeQuotes(text) {
  return text
    // Smart double quotes → straight
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    // Smart single quotes → straight
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    // Em dash → double hyphen
    .replace(/\u2014/g, '--')
    // En dash → hyphen
    .replace(/\u2013/g, '-')
    // Ellipsis → three dots
    .replace(/\u2026/g, '...')
    // Non-breaking space → regular space
    .replace(/\u00A0/g, ' ');
}

/**
 * Normalize whitespace while preserving intentional paragraph breaks.
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  // Collapse runs of 3+ newlines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // Collapse runs of spaces/tabs within a line (not newlines)
  text = text.replace(/[^\S\n]{2,}/g, ' ');

  // Remove trailing spaces on each line
  text = text.replace(/[ \t]+$/gm, '');

  // Remove leading spaces on each line (but preserve indentation intent)
  // Only strip if it's just spaces before text, not tabs
  text = text.replace(/^ +/gm, (match) => {
    // Preserve indentation of 2+ spaces (likely intentional)
    return match.length >= 4 ? '  ' : '';
  });

  return text;
}

/**
 * Normalize line endings to Windows \r\n for ACI.
 * @param {string} text
 * @returns {string}
 */
function normalizeLineEndings(text) {
  // First normalize to \n, then convert to \r\n
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
}
