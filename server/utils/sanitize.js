/**
 * server/utils/sanitize.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Input sanitization utilities for user-generated content.
 *
 * Prevents XSS, path traversal, and injection attacks in content that
 * gets stored in the database or rendered in HTML responses.
 *
 * Note: This is defense-in-depth — Zod validation catches type/shape issues,
 * these utilities handle content-level sanitization.
 */

/**
 * Strip HTML tags from a string.
 * Preserves the text content between tags.
 *
 * @param {string} input
 * @returns {string}
 */
export function stripHtml(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Escape HTML special characters for safe rendering.
 * Use when content will be inserted into HTML context.
 *
 * @param {string} input
 * @returns {string}
 */
export function escapeHtml(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize a filename — remove path traversal and special characters.
 *
 * @param {string} filename
 * @returns {string}
 */
export function sanitizeFilename(filename) {
  if (typeof filename !== 'string') return 'unnamed';
  return filename
    .replace(/\.\./g, '')            // no path traversal
    .replace(/[/\\]/g, '')           // no directory separators
    .replace(/[\x00-\x1f\x7f]/g, '') // no control characters
    .replace(/[<>:"|?*]/g, '')       // no Windows-reserved chars
    .trim()
    || 'unnamed';
}

/**
 * Sanitize a string for safe SQL LIKE pattern use.
 * Escapes %, _, and \ which are LIKE wildcards.
 *
 * @param {string} input
 * @returns {string}
 */
export function escapeSqlLike(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Sanitize user-generated narrative content.
 * Strips dangerous HTML but preserves appraisal-safe characters.
 *
 * @param {string} text
 * @param {number} [maxLength=10000]
 * @returns {string}
 */
export function sanitizeNarrative(text, maxLength = 10000) {
  if (typeof text !== 'string') return '';
  let clean = stripHtml(text);
  // Remove null bytes
  clean = clean.replace(/\0/g, '');
  // Normalize whitespace (preserve single newlines for paragraphs)
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Collapse excessive newlines (max 2)
  clean = clean.replace(/\n{3,}/g, '\n\n');
  // Trim and cap length
  return clean.trim().slice(0, maxLength);
}

/**
 * Sanitize a search query string.
 * Removes characters that could be used for injection.
 *
 * @param {string} query
 * @param {number} [maxLength=200]
 * @returns {string}
 */
export function sanitizeSearchQuery(query, maxLength = 200) {
  if (typeof query !== 'string') return '';
  return query
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/[<>]/g, '')             // HTML brackets
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and sanitize a URL.
 * Returns null if the URL is invalid or uses a disallowed protocol.
 *
 * @param {string} url
 * @param {string[]} [allowedProtocols=['http:', 'https:']]
 * @returns {string|null}
 */
export function sanitizeUrl(url, allowedProtocols = ['http:', 'https:']) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!allowedProtocols.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export default {
  stripHtml,
  escapeHtml,
  sanitizeFilename,
  escapeSqlLike,
  sanitizeNarrative,
  sanitizeSearchQuery,
  sanitizeUrl,
};
