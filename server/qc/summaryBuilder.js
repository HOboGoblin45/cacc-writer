/**
 * server/qc/summaryBuilder.js
 * -----------------------------
 * Phase 7 — Draft Package QC Summary
 *
 * Rolls findings into a practical review snapshot that helps the user
 * decide whether the draft is ready for review, needs cleanup, or is
 * not ready for insertion.
 *
 * Summary outputs:
 *   - Total findings by severity
 *   - Missing required commentary families
 *   - Cross-section conflicts detected
 *   - Placeholder issues detected
 *   - Top review risks
 *   - Canonical fields most in need of attention
 *   - Sections cleared without findings
 *   - Overall draft readiness signal
 */

import { SEVERITY_ORDER, computeDraftReadiness, getReadinessLabel, sortByPriority } from './severityModel.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a QC summary from a list of findings.
 *
 * @param {import('./types.js').QCCheckResult[]} findings
 * @param {{ allSectionIds?: string[] }} [opts] — optional list of all section IDs in the draft
 * @returns {import('./types.js').QCSummary}
 */
export function buildQCSummary(findings, opts = {}) {
  const allSectionIds = opts.allSectionIds || [];

  // ── Severity counts ─────────────────────────────────────────────────────
  const severityCounts = {};
  for (const sev of SEVERITY_ORDER) {
    severityCounts[sev] = 0;
  }
  for (const f of findings) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  }

  // ── Category counts ─────────────────────────────────────────────────────
  const categoryCounts = {};
  for (const f of findings) {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  }

  // ── Affected sections ───────────────────────────────────────────────────
  const affectedSectionSet = new Set();
  for (const f of findings) {
    for (const sid of (f.sectionIds || [])) {
      affectedSectionSet.add(sid);
    }
  }
  const affectedSections = [...affectedSectionSet];

  // ── Cleared sections ────────────────────────────────────────────────────
  const clearedSections = allSectionIds.filter(sid => !affectedSectionSet.has(sid));

  // ── Affected canonical fields ───────────────────────────────────────────
  const fieldFindingCounts = {};
  for (const f of findings) {
    for (const fid of (f.canonicalFieldIds || [])) {
      fieldFindingCounts[fid] = (fieldFindingCounts[fid] || 0) + 1;
    }
  }

  // Sort by count descending
  const fieldsNeedingAttention = Object.entries(fieldFindingCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([fieldId, count]) => ({ fieldId, findingCount: count }));

  // ── Missing commentary families ─────────────────────────────────────────
  const missingCommentaryFamilies = findings
    .filter(f => f.ruleId === 'REQ-003' || (f.category === 'compliance_signal' && f.evidence?.type === 'missing_field'))
    .map(f => ({
      ruleId: f.ruleId,
      message: f.message,
      canonicalFieldIds: f.canonicalFieldIds || [],
    }));

  // ── Cross-section conflicts ─────────────────────────────────────────────
  const crossSectionConflicts = findings
    .filter(f => f.category === 'consistency' || f.category === 'reconciliation')
    .map(f => ({
      ruleId: f.ruleId,
      message: f.message,
      severity: f.severity,
      sectionIds: f.sectionIds || [],
    }));

  // ── Placeholder issues ──────────────────────────────────────────────────
  const placeholderIssues = findings
    .filter(f => f.category === 'placeholder')
    .map(f => ({
      ruleId: f.ruleId,
      message: f.message,
      sectionIds: f.sectionIds || [],
    }));

  // ── Top review risks (sorted by priority, top 5) ───────────────────────
  const sorted = sortByPriority(findings);
  const topReviewRisks = sorted.slice(0, 5).map(f => ({
    ruleId: f.ruleId,
    severity: f.severity,
    category: f.category,
    message: f.message,
    sectionIds: f.sectionIds || [],
  }));

  // ── Draft readiness ─────────────────────────────────────────────────────
  const draftReadiness = computeDraftReadiness(findings);
  const readinessLabel = getReadinessLabel(draftReadiness);

  // ── Assemble summary ───────────────────────────────────────────────────
  return {
    totalFindings: findings.length,
    severityCounts,
    categoryCounts,
    draftReadiness,
    readinessLabel: readinessLabel.label,
    readinessDescription: readinessLabel.description,
    readinessColor: readinessLabel.color,
    affectedSections,
    clearedSections,
    fieldsNeedingAttention,
    missingCommentaryFamilies,
    crossSectionConflicts,
    placeholderIssues,
    topReviewRisks,
  };
}

export default { buildQCSummary };
