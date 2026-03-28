/**
 * server/qc/severityModel.js
 * ----------------------------
 * Phase 7 — Review Prioritization / Severity Model
 *
 * Implements a severity/prioritization model so the user sees what matters first.
 *
 * Severity bands:
 *   blocker  — must fix before insertion (unresolved placeholders, missing required sections)
 *   high     — likely compliance/signoff risk (missing commentary, contradictions)
 *   medium   — quality concern (generic filler, low specificity, weak language)
 *   low      — advisory (vague statements, minor style issues)
 *   advisory — informational only (suggestions, nice-to-haves)
 *
 * Prioritization considers:
 *   1. Explicit missing required content
 *   2. Likely compliance/signoff risk
 *   3. Contradiction across sections
 *   4. Unresolved placeholders
 *   5. Weak but nonfatal quality issues
 *
 * The goal is to rank findings in a useful, appraiser-centered way
 * without overwhelming the user with noise.
 */

// ── Severity weights (higher = more urgent) ─────────────────────────────────

/** @type {Record<import('./types.js').QCSeverity, number>} */
export const SEVERITY_WEIGHTS = {
  blocker:  100,
  high:      75,
  medium:    40,
  low:       15,
  advisory:   5,
};

/** @type {import('./types.js').QCSeverity[]} */
export const SEVERITY_ORDER = ['blocker', 'high', 'medium', 'low', 'advisory'];

// ── Category priority boosts ────────────────────────────────────────────────
// Some categories get a priority boost within their severity band.

/** @type {Record<string, number>} */
const CATEGORY_BOOST = {
  placeholder:        20,  // Placeholders are always urgent
  completeness:       15,  // Missing required content
  compliance_signal:  12,  // Compliance risk
  consistency:        10,  // Cross-section contradictions
  reconciliation:      8,  // Reconciliation issues
  unsupported_certainty: 5,
  section_quality:     3,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute a numeric priority score for a finding.
 * Higher score = more urgent / should appear first.
 *
 * @param {import('./types.js').QCCheckResult} finding
 * @returns {number}
 */
export function computePriorityScore(finding) {
  const severityWeight = SEVERITY_WEIGHTS[finding.severity] || 0;
  const categoryBoost = CATEGORY_BOOST[finding.category] || 0;

  // Bonus for findings that affect multiple sections
  const sectionCountBonus = Math.min((finding.sectionIds || []).length * 2, 10);

  return severityWeight + categoryBoost + sectionCountBonus;
}

/**
 * Sort findings by priority (highest first).
 * Within the same priority score, sort by severity band, then category.
 *
 * @param {import('./types.js').QCCheckResult[]} findings
 * @returns {import('./types.js').QCCheckResult[]}
 */
export function sortByPriority(findings) {
  return [...findings].sort((a, b) => {
    const scoreA = computePriorityScore(a);
    const scoreB = computePriorityScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Tiebreak: severity band order
    const sevA = SEVERITY_ORDER.indexOf(a.severity);
    const sevB = SEVERITY_ORDER.indexOf(b.severity);
    if (sevA !== sevB) return sevA - sevB;

    // Tiebreak: category alphabetical
    return (a.category || '').localeCompare(b.category || '');
  });
}

/**
 * Determine the overall draft readiness signal from findings.
 *
 * @param {import('./types.js').QCCheckResult[]} findings
 * @returns {import('./types.js').DraftReadinessSignal}
 */
export function computeDraftReadiness(findings) {
  const openFindings = findings.filter(f => f.status !== 'dismissed' && f.status !== 'resolved');

  const blockerCount = openFindings.filter(f => f.severity === 'blocker').length;
  const highCount = openFindings.filter(f => f.severity === 'high').length;
  const mediumCount = openFindings.filter(f => f.severity === 'medium').length;

  if (blockerCount > 0) return 'not_ready';
  if (highCount > 3) return 'not_ready';
  if (highCount > 0) return 'needs_review';
  if (mediumCount > 5) return 'needs_review';
  if (mediumCount > 0) return 'review_recommended';
  return 'ready';
}

/**
 * Get a human-readable label for a readiness signal.
 *
 * @param {import('./types.js').DraftReadinessSignal} signal
 * @returns {{ label: string, description: string, color: string }}
 */
export function getReadinessLabel(signal) {
  switch (signal) {
    case 'ready':
      return {
        label: 'Ready for Review',
        description: 'No significant issues detected. Draft is ready for appraiser review.',
        color: 'green',
      };
    case 'review_recommended':
      return {
        label: 'Review Recommended',
        description: 'Minor issues detected. Review is recommended before insertion.',
        color: 'yellow',
      };
    case 'needs_review':
      return {
        label: 'Needs Review',
        description: 'Significant issues detected. Draft needs attention before insertion.',
        color: 'orange',
      };
    case 'not_ready':
      return {
        label: 'Not Ready',
        description: 'Critical issues detected. Draft should not be inserted without fixes.',
        color: 'red',
      };
    default:
      return {
        label: 'Unknown',
        description: 'QC status unknown.',
        color: 'gray',
      };
  }
}

/**
 * Filter findings to reduce noise — suppress low-value findings
 * when there are already many higher-priority issues.
 *
 * @param {import('./types.js').QCCheckResult[]} findings
 * @param {{ maxAdvisory?: number, maxLow?: number }} [opts]
 * @returns {import('./types.js').QCCheckResult[]}
 */
export function filterNoise(findings, opts = {}) {
  const maxAdvisory = opts.maxAdvisory ?? 5;
  const maxLow = opts.maxLow ?? 10;

  const blockerOrHigh = findings.filter(f => f.severity === 'blocker' || f.severity === 'high');

  // If there are many critical issues, suppress advisory/low noise
  if (blockerOrHigh.length >= 5) {
    let advisoryCount = 0;
    let lowCount = 0;

    return findings.filter(f => {
      if (f.severity === 'advisory') {
        advisoryCount++;
        return advisoryCount <= Math.min(maxAdvisory, 2);
      }
      if (f.severity === 'low') {
        lowCount++;
        return lowCount <= Math.min(maxLow, 3);
      }
      return true;
    });
  }

  // Normal filtering
  let advisoryCount = 0;
  let lowCount = 0;

  return findings.filter(f => {
    if (f.severity === 'advisory') {
      advisoryCount++;
      return advisoryCount <= maxAdvisory;
    }
    if (f.severity === 'low') {
      lowCount++;
      return lowCount <= maxLow;
    }
    return true;
  });
}

export default {
  SEVERITY_WEIGHTS,
  SEVERITY_ORDER,
  computePriorityScore,
  sortByPriority,
  computeDraftReadiness,
  getReadinessLabel,
  filterNoise,
};
