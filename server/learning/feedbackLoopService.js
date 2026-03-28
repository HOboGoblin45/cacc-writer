/**
 * server/learning/feedbackLoopService.js
 * ----------------------------------------
 * Milestone 6 — Learning System Feedback Loop Closure
 *
 * Closes the loop between section generation outcomes and the learning system:
 *   - linkGenerationToPatterns: records which patterns influenced a generation
 *   - onSectionApproved / onSectionRejected: propagates outcomes to patterns
 *   - onQualityScoreComputed: adjusts pattern confidence based on quality
 *   - getPatternSuccessRate: computes acceptance rate for pattern ranking
 *   - closeFeedbackLoop: batch process for archiving that captures all outcomes
 */

import { dbAll, dbGet, dbRun } from '../db/database.js';
import {
  recordPatternApplication,
  recordApplicationOutcome,
  getRelevantPatterns,
} from './patternLearningService.js';
import log from '../logger.js';

// ── Link generation to patterns ──────────────────────────────────────────────

/**
 * When a section is generated, find which learned patterns are relevant
 * and record applications linking them to this generation.
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string} params.sectionId
 * @param {string} params.generatedSectionId - row ID in generated_sections
 * @param {string} params.formType
 * @param {string} [params.propertyType]
 * @param {string} [params.marketArea]
 * @returns {{ linkedPatterns: number, applicationIds: string[] }}
 */
export function linkGenerationToPatterns({
  caseId,
  sectionId,
  generatedSectionId,
  formType,
  propertyType,
  marketArea,
}) {
  // Find relevant patterns for this section type
  const patterns = getRelevantPatterns({
    patternType: 'narrative_edit',
    formType,
    propertyType,
    marketArea,
    limit: 10,
  });

  const applicationIds = [];
  for (const pattern of patterns) {
    const result = recordPatternApplication({
      patternId: pattern.id,
      caseId,
      appliedContext: JSON.stringify({
        sectionId,
        generatedSectionId,
        formType,
        propertyType,
        marketArea,
        linkedAt: new Date().toISOString(),
      }),
    });
    applicationIds.push(result.id);
  }

  log.info('feedback-loop:linked', {
    caseId,
    sectionId,
    generatedSectionId,
    linkedPatterns: applicationIds.length,
  });

  return { linkedPatterns: applicationIds.length, applicationIds };
}

// ── Section outcome propagation ──────────────────────────────────────────────

/**
 * When a section is approved by the appraiser, propagate the positive
 * outcome to all pattern applications linked to this section.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {string} [generatedSectionId] - specific generation row ID
 * @returns {{ updatedApplications: number }}
 */
export function onSectionApproved(caseId, sectionId, generatedSectionId) {
  const applications = findApplicationsForSection(caseId, sectionId, generatedSectionId);
  let updated = 0;

  for (const app of applications) {
    if (app.outcome && app.outcome !== 'pending') continue; // Already has outcome
    recordApplicationOutcome(app.id, 'accepted');
    updated++;
  }

  log.info('feedback-loop:section-approved', { caseId, sectionId, updatedApplications: updated });
  return { updatedApplications: updated };
}

/**
 * When a section is rejected by the appraiser, propagate the negative
 * outcome to all pattern applications linked to this section.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {string} [generatedSectionId]
 * @returns {{ updatedApplications: number }}
 */
export function onSectionRejected(caseId, sectionId, generatedSectionId) {
  const applications = findApplicationsForSection(caseId, sectionId, generatedSectionId);
  let updated = 0;

  for (const app of applications) {
    if (app.outcome && app.outcome !== 'pending') continue;
    recordApplicationOutcome(app.id, 'rejected');
    updated++;
  }

  log.info('feedback-loop:section-rejected', { caseId, sectionId, updatedApplications: updated });
  return { updatedApplications: updated };
}

// ── Quality score feedback ───────────────────────────────────────────────────

/**
 * When a quality score is computed for a section, adjust confidence of
 * linked patterns proportionally to the score.
 *
 * High quality (>70) → small confidence boost
 * Low quality (<40) → small confidence penalty
 * Medium quality → no change
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {number} qualityScore - 0-100
 * @returns {{ adjustedPatterns: number }}
 */
export function onQualityScoreComputed(caseId, sectionId, qualityScore) {
  if (typeof qualityScore !== 'number') return { adjustedPatterns: 0 };

  const applications = findApplicationsForSection(caseId, sectionId);
  let adjusted = 0;

  for (const app of applications) {
    const pattern = dbGet('SELECT id, confidence FROM learned_patterns WHERE id = ?', [app.pattern_id]);
    if (!pattern) continue;

    let delta = 0;
    if (qualityScore >= 70) {
      delta = 0.02; // Small boost for high quality
    } else if (qualityScore < 40) {
      delta = -0.03; // Slightly larger penalty for low quality
    }

    if (delta !== 0) {
      const newConfidence = Math.max(0.1, Math.min(0.95, pattern.confidence + delta));
      dbRun('UPDATE learned_patterns SET confidence = ? WHERE id = ?', [newConfidence, pattern.id]);
      adjusted++;
    }
  }

  return { adjustedPatterns: adjusted };
}

// ── Pattern success rate ─────────────────────────────────────────────────────

/**
 * Compute the success rate for a pattern based on its application outcomes.
 * Used by learningBoostProvider to rank patterns for retrieval.
 *
 * @param {string} patternId
 * @returns {{ total: number, accepted: number, rejected: number, successRate: number }}
 */
export function getPatternSuccessRate(patternId) {
  const rows = dbAll(
    'SELECT outcome, COUNT(*) as cnt FROM pattern_applications WHERE pattern_id = ? GROUP BY outcome',
    [patternId]
  );

  let total = 0;
  let accepted = 0;
  let rejected = 0;

  for (const row of rows) {
    total += row.cnt;
    if (row.outcome === 'accepted') accepted = row.cnt;
    if (row.outcome === 'rejected') rejected = row.cnt;
  }

  const successRate = total > 0 ? accepted / total : 0.5; // Default 50% when no data
  return { total, accepted, rejected, successRate };
}

/**
 * Get success rates for multiple patterns at once (batch query).
 *
 * @param {string[]} patternIds
 * @returns {Object.<string, { total: number, accepted: number, rejected: number, successRate: number }>}
 */
export function getBatchPatternSuccessRates(patternIds) {
  if (!patternIds || patternIds.length === 0) return {};

  const placeholders = patternIds.map(() => '?').join(',');
  const rows = dbAll(
    `SELECT pattern_id, outcome, COUNT(*) as cnt
     FROM pattern_applications
     WHERE pattern_id IN (${placeholders})
     GROUP BY pattern_id, outcome`,
    patternIds
  );

  const result = {};
  for (const id of patternIds) {
    result[id] = { total: 0, accepted: 0, rejected: 0, successRate: 0.5 };
  }

  for (const row of rows) {
    const entry = result[row.pattern_id];
    if (!entry) continue;
    entry.total += row.cnt;
    if (row.outcome === 'accepted') entry.accepted = row.cnt;
    if (row.outcome === 'rejected') entry.rejected = row.cnt;
  }

  for (const entry of Object.values(result)) {
    entry.successRate = entry.total > 0 ? entry.accepted / entry.total : 0.5;
  }

  return result;
}

// ── Archive feedback closure ─────────────────────────────────────────────────

/**
 * When a case is archived, close all pending feedback loops:
 * - Find all generated sections for the case
 * - Check which are approved vs not
 * - Propagate outcomes to all linked pattern applications
 * - Adjust confidence based on quality scores
 *
 * @param {string} caseId
 * @returns {{ sectionsProcessed: number, applicationsUpdated: number, qualityAdjustments: number }}
 */
export function closeFeedbackLoop(caseId) {
  const sections = dbAll(
    `SELECT id, section_id, quality_score, approved
     FROM generated_sections
     WHERE case_id = ?
     ORDER BY created_at DESC`,
    [caseId]
  );

  // Deduplicate: keep only the latest generation per section_id
  const seen = new Set();
  const latestSections = [];
  for (const s of sections) {
    if (seen.has(s.section_id)) continue;
    seen.add(s.section_id);
    latestSections.push(s);
  }

  let applicationsUpdated = 0;
  let qualityAdjustments = 0;

  for (const section of latestSections) {
    // Propagate approval/rejection
    if (section.approved) {
      const result = onSectionApproved(caseId, section.section_id, section.id);
      applicationsUpdated += result.updatedApplications;
    } else {
      // Not approved = ignored (not rejected — rejection is explicit)
      const apps = findApplicationsForSection(caseId, section.section_id, section.id);
      for (const app of apps) {
        if (!app.outcome || app.outcome === 'pending') {
          recordApplicationOutcome(app.id, 'ignored');
          applicationsUpdated++;
        }
      }
    }

    // Adjust confidence based on quality score
    if (section.quality_score !== null && section.quality_score !== undefined) {
      const result = onQualityScoreComputed(caseId, section.section_id, section.quality_score);
      qualityAdjustments += result.adjustedPatterns;
    }
  }

  log.info('feedback-loop:closed', {
    caseId,
    sectionsProcessed: latestSections.length,
    applicationsUpdated,
    qualityAdjustments,
  });

  return {
    sectionsProcessed: latestSections.length,
    applicationsUpdated,
    qualityAdjustments,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find pattern applications linked to a specific section generation.
 */
function findApplicationsForSection(caseId, sectionId, generatedSectionId) {
  const apps = dbAll(
    'SELECT id, pattern_id, outcome, applied_context FROM pattern_applications WHERE case_id = ?',
    [caseId]
  );

  return apps.filter(app => {
    try {
      const ctx = typeof app.applied_context === 'string'
        ? JSON.parse(app.applied_context)
        : app.applied_context;
      if (ctx.sectionId !== sectionId) return false;
      if (generatedSectionId && ctx.generatedSectionId !== generatedSectionId) return false;
      return true;
    } catch {
      return false;
    }
  });
}
