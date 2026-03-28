/**
 * server/insertion/verificationEngine.js
 * ----------------------------------------
 * Phase 9: Read-back verification at the Node.js layer.
 *
 * Calls agent /read-field endpoints and compares the result
 * against the formatted text that was sent.
 *
 * Persists both raw and normalized comparison values.
 */

/**
 * Verify a single field insertion by reading back from the agent.
 *
 * @param {Object} params
 * @param {string} params.fieldId - Canonical field ID
 * @param {string} params.agentFieldKey - Key in the agent's field map
 * @param {string} params.formattedText - The text that was sent to the agent
 * @param {'aci' | 'real_quantum'} params.targetSoftware
 * @param {string} params.agentBaseUrl - Agent base URL
 * @param {string} [params.verificationMode] - Verification method
 * @param {number} [params.timeout=10000] - Request timeout in ms
 * @returns {Promise<import('./types.js').VerificationResult>}
 */
export async function verifyInsertion({
  fieldId,
  agentFieldKey,
  formattedText,
  formType,
  targetSoftware,
  agentBaseUrl,
  section = null,
  verificationMode = null,
  targetRect = null,
  timeout = 10000,
}) {
  const startTime = Date.now();

  // If no agent field key, we can't verify
  if (!agentFieldKey) {
    return {
      status: 'not_supported',
      rawValue: null,
      normalizedValue: null,
      expectedNormalized: normalizeForComparison(formattedText, targetSoftware),
      similarityScore: null,
      mismatchDetail: 'No agent field key available for read-back',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const rawValue = await readFieldFromAgent({
      fieldId: agentFieldKey,
      formType,
      agentBaseUrl,
      section,
      targetRect,
      timeout,
    });

    if (rawValue === null || rawValue === undefined) {
      return {
        status: 'unreadable',
        rawValue: null,
        normalizedValue: null,
        expectedNormalized: normalizeForComparison(formattedText, targetSoftware),
        similarityScore: null,
        mismatchDetail: 'Agent returned null/empty for read-back',
        durationMs: Date.now() - startTime,
      };
    }

    const normalizedActual = normalizeForComparison(String(rawValue), targetSoftware);
    const normalizedExpected = normalizeForComparison(formattedText, targetSoftware);

    const similarity = computeSimilarity(normalizedActual, normalizedExpected);

    // Threshold: 0.90 similarity = pass (allows minor whitespace/encoding differences)
    const passed = similarity >= 0.90;

    return {
      status: passed ? 'passed' : 'mismatch',
      rawValue: String(rawValue).slice(0, 5000), // Cap stored raw value
      normalizedValue: normalizedActual.slice(0, 5000),
      expectedNormalized: normalizedExpected.slice(0, 5000),
      similarityScore: similarity,
      mismatchDetail: passed ? null : buildMismatchDetail(normalizedExpected, normalizedActual),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      status: 'failed',
      rawValue: null,
      normalizedValue: null,
      expectedNormalized: normalizeForComparison(formattedText, targetSoftware),
      similarityScore: null,
      mismatchDetail: `Verification error: ${err.message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Agent Communication ───────────────────────────────────────────────────────

/**
 * Read a field value from the agent.
 *
 * @param {string} agentFieldKey
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @param {string} agentBaseUrl
 * @param {number} timeout
 * @returns {Promise<string|null>}
 */
async function readFieldFromAgent({
  fieldId,
  formType,
  agentBaseUrl,
  section = null,
  targetRect = null,
  timeout,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${agentBaseUrl}/read-field`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldId,
        formType,
        ...(section ? { section } : {}),
        targetRect,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Agent returned ${response.status}: ${errText}`);
    }

    const data = await response.json();

    // ACI agent returns { success, value, ... }
    // RQ agent returns { success, value, ... }
    if (data.success && data.value !== undefined) {
      return data.value;
    }

    // Some agents return the text directly
    if (typeof data.text === 'string') {
      return data.text;
    }

    return data.value || null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Normalize text for comparison purposes.
 * Strips formatting differences that don't affect content.
 *
 * @param {string} text
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @returns {string}
 */
export function normalizeForComparison(text, targetSoftware) {
  if (!text) return '';

  let normalized = text;

  // Strip HTML tags for comparison
  normalized = normalized.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  normalized = normalized
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Normalize all whitespace (spaces, tabs, newlines) to single space
  normalized = normalized.replace(/\s+/g, ' ');

  // Normalize quotes
  normalized = normalized
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'");

  // Normalize dashes
  normalized = normalized
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-');

  // Trim
  normalized = normalized.trim();

  // Lowercase for comparison
  normalized = normalized.toLowerCase();

  return normalized;
}

// ── Similarity ────────────────────────────────────────────────────────────────

/**
 * Compute similarity between two normalized strings.
 * Uses a simple approach: ratio of matching characters.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 similarity score
 */
function computeSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  // For very long texts, compare first N chars + last N chars
  const maxLen = 2000;
  let compA = a;
  let compB = b;
  if (a.length > maxLen || b.length > maxLen) {
    const half = Math.floor(maxLen / 2);
    compA = a.slice(0, half) + a.slice(-half);
    compB = b.slice(0, half) + b.slice(-half);
  }

  // Simple Levenshtein-based similarity for shorter texts
  if (compA.length < 500 && compB.length < 500) {
    const dist = levenshteinDistance(compA, compB);
    const maxDist = Math.max(compA.length, compB.length);
    return maxDist === 0 ? 1.0 : 1.0 - (dist / maxDist);
  }

  // For longer texts, use token overlap
  const tokensA = new Set(compA.split(/\s+/));
  const tokensB = new Set(compB.split(/\s+/));
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 1.0 : overlap / union;
}

/**
 * Levenshtein distance (for short strings).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Build a human-readable mismatch detail.
 * @param {string} expected
 * @param {string} actual
 * @returns {string}
 */
function buildMismatchDetail(expected, actual) {
  const expLen = expected.length;
  const actLen = actual.length;

  if (actLen === 0) {
    return 'Read-back returned empty text — field may not have been populated';
  }

  if (Math.abs(expLen - actLen) > expLen * 0.5) {
    return `Significant length difference: expected ~${expLen} chars, got ~${actLen} chars`;
  }

  // Find first divergence point
  let divergeAt = 0;
  const minLen = Math.min(expLen, actLen, 200);
  for (let i = 0; i < minLen; i++) {
    if (expected[i] !== actual[i]) {
      divergeAt = i;
      break;
    }
    divergeAt = i + 1;
  }

  if (divergeAt >= minLen) {
    return `Text matches for first ${minLen} chars but diverges after`;
  }

  const context = expected.slice(Math.max(0, divergeAt - 20), divergeAt + 40);
  return `Content diverges at position ${divergeAt}: "...${context}..."`;
}
