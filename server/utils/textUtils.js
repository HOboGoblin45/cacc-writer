/**
 * server/utils/textUtils.js
 * --------------------------
 * Text processing, JSON extraction, and response normalization utilities.
 *
 * Narrow purpose: string trimming, array coercion, AI response text extraction,
 * balanced-JSON parsing, and field normalization helpers.
 * No business logic — no AI calls, no appraisal decisions.
 */

import log from '../logger.js';

// ── String helpers ────────────────────────────────────────────────────────────

/**
 * trimText(v, max)
 * Trims a value to a string, optionally capped at max characters.
 *
 * @param {*}      v   — value to trim
 * @param {number} max — optional character limit
 * @returns {string}
 */
export function trimText(v, max) {
  const s = String(v || '').trim();
  return typeof max === 'number' ? s.slice(0, max) : s;
}

/**
 * asArray(v)
 * Coerces a value to an array.
 * - Array → returned as-is
 * - Comma-separated string → split and trimmed
 * - Other → wrapped in array (empty string → empty array)
 *
 * @param {*} v
 * @returns {any[]}
 */
export function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const parts = v.split(',').map(s => s.trim()).filter(Boolean);
    return parts;
  }
  return v ? [v] : [];
}

/**
 * aiText(response)
 * Extracts the text string from an OpenAI Responses API result object.
 * Handles both the top-level output_text shortcut and the nested output array.
 *
 * @param {object} response — raw OpenAI response object
 * @returns {string}
 */
export function aiText(response) {
  if (!response) return '';
  return (
    response.output_text ||
    response.output?.[0]?.content?.[0]?.text ||
    ''
  );
}

// ── JSON extraction helpers ───────────────────────────────────────────────────

/**
 * extractBalancedJSON(src, open, close)
 * Finds the first balanced JSON structure (object or array) in a string.
 * Handles nested structures by counting open/close characters.
 *
 * @param {string} src   — source string (may contain surrounding text)
 * @param {string} open  — opening character: '{' or '['
 * @param {string} close — closing character: '}' or ']'
 * @returns {string|null} — the extracted JSON substring, or null if not found
 */
export function extractBalancedJSON(src, open, close) {
  const start = src.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open)  depth++;
    if (ch === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

/**
 * parseJSONObject(text)
 * Extracts and parses the first JSON object from a string.
 * Returns null on failure.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function parseJSONObject(text) {
  try {
    const raw = extractBalancedJSON(String(text || ''), '{', '}');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    log.debug('textUtils:parseJSONObject', { error: e.message, preview: String(text || '').slice(0, 120) });
    return null;
  }
}

/**
 * parseJSONArray(text)
 * Extracts and parses the first JSON array from a string.
 * Returns null on failure.
 *
 * @param {string} text
 * @returns {any[]|null}
 */
export function parseJSONArray(text) {
  try {
    const raw = extractBalancedJSON(String(text || ''), '[', ']');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    log.debug('textUtils:parseJSONArray', { error: e.message, preview: String(text || '').slice(0, 120) });
    return null;
  }
}

// ── Field normalization helpers ───────────────────────────────────────────────

/**
 * normSev(value, fallback)
 * Normalizes a severity string to 'high' | 'medium' | 'low'.
 * Returns fallback (default 'medium') for unrecognized values.
 *
 * @param {string} value
 * @param {string} fallback
 * @returns {'high'|'medium'|'low'}
 */
export function normSev(value, fallback = 'medium') {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'high' || v === 'critical') return 'high';
  if (v === 'low'  || v === 'minor')    return 'low';
  if (v === 'medium' || v === 'moderate') return 'medium';
  return fallback;
}

/**
 * normalizeQuestions(raw)
 * Normalizes an AI-generated questionnaire response into a clean array of
 * { question, reason, confidence } objects.
 *
 * @param {string|object[]|null} raw — raw AI output (string or parsed array)
 * @returns {{ question: string, reason: string, confidence: string }[]}
 */
export function normalizeQuestions(raw) {
  if (!raw) return [];
  let arr = Array.isArray(raw) ? raw : parseJSONArray(String(raw));
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(q => q && typeof q === 'object')
    .map(q => ({
      question:   trimText(q.question   || q.q || '', 500),
      reason:     trimText(q.reason     || q.r || '', 300),
      confidence: trimText(q.confidence || q.c || 'medium', 20),
    }))
    .filter(q => q.question.length > 0);
}

/**
 * normalizeGrade(raw)
 * Normalizes an AI-generated grade response into a structured object.
 *
 * @param {string|object|null} raw — raw AI output
 * @returns {{ score: number, label: string, issues: string[], suggestions: string[] }}
 */
export function normalizeGrade(raw) {
  const fallback = { score: 0, label: 'unknown', issues: [], suggestions: [] };
  if (!raw) return fallback;
  const obj = typeof raw === 'object' ? raw : parseJSONObject(String(raw));
  if (!obj) return fallback;
  return {
    score:       Number(obj.score ?? obj.grade ?? 0),
    label:       trimText(obj.label || obj.rating || 'unknown', 50),
    issues:      Array.isArray(obj.issues)      ? obj.issues.map(s => trimText(s, 300))      : [],
    suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.map(s => trimText(s, 300)) : [],
  };
}
