/**
 * server/insertion/diffEngine.js
 * --------------------------------
 * Priority 5: Post-insert diff engine.
 *
 * Builds structured diffs for insertion runs, comparing:
 *   canonical text -> formatted text -> verification readback
 *
 * Uses similarity scoring from verificationEngine and flags
 * mismatches, truncations, and formatting differences.
 */

import {
  getInsertionRun,
  getInsertionRunItems,
  updateInsertionRunItem,
} from './insertionRepo.js';
import { normalizeForComparison } from './verificationEngine.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a structured diff report for all items in an insertion run.
 *
 * For each item, compares:
 *   1. canonical text vs formatted text (formatting diff)
 *   2. formatted text vs verification readback (insertion diff)
 *   3. canonical text vs verification readback (end-to-end diff)
 *
 * @param {string} runId
 * @returns {Object} Structured diff report
 */
export function buildInsertionDiff(runId) {
  const run = getInsertionRun(runId);
  if (!run) throw new Error(`Insertion run not found: ${runId}`);

  const items = getInsertionRunItems(runId);
  const itemDiffs = [];
  let totalMismatches = 0;
  let totalTruncations = 0;
  let totalFormattingDiffs = 0;

  for (const item of items) {
    const diff = buildItemDiff(item);
    itemDiffs.push(diff);

    // Persist diff and similarity score on the item
    updateInsertionRunItem(item.id, {
      diffJson: diff,
      similarityScore: diff.endToEndSimilarity,
    });

    if (diff.hasMismatch) totalMismatches++;
    if (diff.hasTruncation) totalTruncations++;
    if (diff.hasFormattingDiff) totalFormattingDiffs++;
  }

  return {
    runId: run.id,
    caseId: run.caseId,
    formType: run.formType,
    targetSoftware: run.targetSoftware,
    totalItems: items.length,
    totalMismatches,
    totalTruncations,
    totalFormattingDiffs,
    itemDiffs,
    generatedAt: new Date().toISOString(),
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Build a diff for a single insertion run item.
 *
 * @param {Object} item - Hydrated insertion run item
 * @returns {Object} Item diff report
 */
function buildItemDiff(item) {
  const canonical = item.canonicalText || '';
  const formatted = item.formattedText || '';
  const readbackRaw = item.verificationRaw || '';
  const readbackNormalized = item.verificationNormalized || '';
  const targetSoftware = item.targetSoftware || 'aci';

  // Normalize texts for comparison
  const canonicalNorm = normalizeForComparison(canonical, targetSoftware);
  const formattedNorm = normalizeForComparison(formatted, targetSoftware);
  const readbackNorm = readbackNormalized || normalizeForComparison(readbackRaw, targetSoftware);

  // Compute similarity scores
  const formattingSimilarity = computeSimilarity(canonicalNorm, formattedNorm);
  const insertionSimilarity = readbackNorm
    ? computeSimilarity(formattedNorm, readbackNorm)
    : null;
  const endToEndSimilarity = readbackNorm
    ? computeSimilarity(canonicalNorm, readbackNorm)
    : null;

  // Detect truncation
  const hasTruncation = formatted.length > 0 && canonical.length > 0
    && formatted.length < canonical.length * 0.8;

  // Detect formatting differences
  const hasFormattingDiff = formattingSimilarity < 0.95;

  // Detect mismatch (readback does not match what was sent)
  const hasMismatch = insertionSimilarity !== null && insertionSimilarity < 0.90;

  // Build change summary
  const changes = [];

  if (hasTruncation) {
    changes.push({
      type: 'truncation',
      message: `Text was truncated from ${canonical.length} to ${formatted.length} characters (${Math.round(formatted.length / canonical.length * 100)}% retained)`,
    });
  }

  if (hasFormattingDiff) {
    changes.push({
      type: 'formatting',
      message: `Formatting changed content (similarity: ${(formattingSimilarity * 100).toFixed(1)}%)`,
      detail: buildDiffDetail(canonicalNorm, formattedNorm),
    });
  }

  if (hasMismatch) {
    changes.push({
      type: 'mismatch',
      message: `Read-back does not match inserted text (similarity: ${((insertionSimilarity || 0) * 100).toFixed(1)}%)`,
      detail: buildDiffDetail(formattedNorm, readbackNorm),
    });
  }

  if (canonical.length > 0 && formatted.length === 0) {
    changes.push({
      type: 'empty_format',
      message: 'Formatted text is empty despite having canonical text',
    });
  }

  return {
    fieldId: item.fieldId,
    status: item.status,
    verificationStatus: item.verificationStatus,
    canonicalTextLength: canonical.length,
    formattedTextLength: formatted.length,
    readbackTextLength: readbackRaw.length,
    formattingSimilarity,
    insertionSimilarity,
    endToEndSimilarity,
    hasTruncation,
    hasFormattingDiff,
    hasMismatch,
    changes,
    canonicalPreview: canonical.slice(0, 200),
    formattedPreview: formatted.slice(0, 200),
    readbackPreview: readbackRaw.slice(0, 200),
  };
}

/**
 * Build a human-readable diff detail between two normalized strings.
 *
 * @param {string} expected
 * @param {string} actual
 * @returns {Object}
 */
function buildDiffDetail(expected, actual) {
  if (!expected && !actual) return { divergeAt: 0, context: '' };

  const expLen = expected.length;
  const actLen = actual.length;

  // Find first divergence point
  let divergeAt = 0;
  const minLen = Math.min(expLen, actLen, 500);
  for (let i = 0; i < minLen; i++) {
    if (expected[i] !== actual[i]) {
      divergeAt = i;
      break;
    }
    divergeAt = i + 1;
  }

  const contextStart = Math.max(0, divergeAt - 30);
  const expectedContext = expected.slice(contextStart, divergeAt + 50);
  const actualContext = actual.slice(contextStart, divergeAt + 50);

  return {
    divergeAt,
    expectedLength: expLen,
    actualLength: actLen,
    lengthDiff: actLen - expLen,
    expectedContext,
    actualContext,
  };
}

/**
 * Compute similarity between two normalized strings.
 * Uses token overlap for longer texts, Levenshtein for shorter.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 similarity score
 */
function computeSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  // For shorter texts, use Levenshtein-based similarity
  if (a.length < 500 && b.length < 500) {
    const dist = levenshteinDistance(a, b);
    const maxDist = Math.max(a.length, b.length);
    return maxDist === 0 ? 1.0 : 1.0 - (dist / maxDist);
  }

  // For longer texts, use token overlap (Jaccard similarity)
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 1.0 : overlap / union;
}

/**
 * Levenshtein distance for short strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
