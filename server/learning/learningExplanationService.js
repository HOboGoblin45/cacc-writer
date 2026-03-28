/**
 * server/learning/learningExplanationService.js
 * ------------------------------------------------
 * Provides explainable learning insights for the controlled learning loop.
 *
 * Combines data from revision diffs, suggestion outcomes, pattern learning,
 * and assignment archives to produce human-readable explanations of how
 * the system's learning influences suggestions.
 */

import { dbAll, dbGet } from '../db/database.js';
import log from '../logger.js';
import {
  getSuggestionAcceptanceRate,
  getRankedSuggestions,
} from './suggestionRankingService.js';
import { getDiffStats, getDiffPatterns } from './revisionDiffService.js';

/**
 * Get an explanation of what historical patterns influence suggestions
 * for a given section/form/property type combination.
 *
 * @param {string} sectionId
 * @param {string} [formType]
 * @param {string} [propertyType]
 * @returns {object}
 */
export function getInfluenceExplanation(sectionId, formType, propertyType) {
  // Get acceptance rate for this combination
  const rate = getSuggestionAcceptanceRate({
    sectionId,
    formType,
    propertyType,
  });

  // Get ranked suggestion types
  const rankedSuggestions = getRankedSuggestions(sectionId, formType, { propertyType });

  // Get diff patterns for this section
  const diffPatterns = getDiffPatterns({
    sectionId,
    formType,
    propertyType,
    limit: 5,
  });

  // Build influence factors
  const influenceFactors = [];

  if (rate.total > 0) {
    influenceFactors.push({
      factor: 'suggestion_acceptance',
      description: `${rate.accepted} of ${rate.total} suggestions accepted (${(rate.acceptanceRate * 100).toFixed(1)}%)`,
      weight: rate.acceptanceRate,
    });
  }

  if (rate.modified > 0) {
    influenceFactors.push({
      factor: 'modification_rate',
      description: `${rate.modified} of ${rate.total} suggestions were modified before acceptance`,
      weight: rate.modificationRate,
    });
  }

  if (diffPatterns.length > 0) {
    const avgDiffRatio = diffPatterns.reduce((s, d) => s + d.averageChangeRatio, 0) / diffPatterns.length;
    influenceFactors.push({
      factor: 'revision_patterns',
      description: `Average revision change ratio: ${(avgDiffRatio * 100).toFixed(1)}% across ${diffPatterns.reduce((s, d) => s + d.sampleCount, 0)} samples`,
      weight: 1 - avgDiffRatio,
    });
  }

  // Build top patterns
  const topPatterns = rankedSuggestions.slice(0, 5).map(r => ({
    suggestionType: r.suggestionType,
    acceptanceRate: r.acceptanceRate,
    sampleSize: r.total,
  }));

  // Generate explanation text
  let explanation = '';
  if (rate.total === 0) {
    explanation = `No historical data available for section "${sectionId}". Suggestions will use default ranking.`;
  } else if (rate.acceptanceRate >= 0.8) {
    explanation = `Suggestions for "${sectionId}" are highly effective (${(rate.acceptanceRate * 100).toFixed(1)}% acceptance rate). The system has learned strong patterns from ${rate.total} prior outcomes.`;
  } else if (rate.acceptanceRate >= 0.5) {
    explanation = `Suggestions for "${sectionId}" show moderate effectiveness (${(rate.acceptanceRate * 100).toFixed(1)}% acceptance rate). The system is adapting based on ${rate.total} prior outcomes.`;
  } else {
    explanation = `Suggestions for "${sectionId}" need improvement (${(rate.acceptanceRate * 100).toFixed(1)}% acceptance rate). The system will adjust its approach based on ${rate.total} rejection patterns.`;
  }

  return {
    sectionId,
    formType: formType || null,
    propertyType: propertyType || null,
    influenceFactors,
    topPatterns,
    acceptanceRate: rate.acceptanceRate,
    sampleSize: rate.total,
    explanation,
  };
}

/**
 * Get a full learning report for a case.
 * Combines archives used, patterns applied, suggestion outcomes, and revision stats.
 *
 * @param {string} caseId
 * @returns {object}
 */
export function getCaseLearningReport(caseId) {
  // Get archive info
  const archive = dbGet(
    'SELECT id, case_id, form_type, property_type, market_area, archived_at FROM assignment_archives WHERE case_id = ?',
    [caseId]
  );

  // Get pattern applications for this case
  const applications = dbAll(
    'SELECT pa.*, lp.pattern_type, lp.pattern_key FROM pattern_applications pa LEFT JOIN learned_patterns lp ON pa.pattern_id = lp.id WHERE pa.case_id = ?',
    [caseId]
  );

  // Get suggestion outcomes for this case
  const suggestionRows = dbAll(
    'SELECT * FROM suggestion_outcomes WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );

  const suggestions = suggestionRows.map(row => ({
    id: row.id,
    sectionId: row.section_id,
    suggestionType: row.suggestion_type,
    accepted: !!row.accepted,
    modified: !!row.modified,
  }));

  // Get revision stats
  const revisionStats = getDiffStats(caseId);

  // Compute suggestion summary
  const totalSuggestions = suggestions.length;
  const acceptedSuggestions = suggestions.filter(s => s.accepted).length;
  const modifiedSuggestions = suggestions.filter(s => s.modified).length;

  // Patterns applied summary
  const patternsApplied = applications.map(a => ({
    patternId: a.pattern_id,
    patternType: a.pattern_type,
    patternKey: a.pattern_key,
    outcome: a.outcome,
    appliedContext: a.applied_context,
  }));

  return {
    caseId,
    archive: archive ? {
      id: archive.id,
      formType: archive.form_type,
      propertyType: archive.property_type,
      marketArea: archive.market_area,
      archivedAt: archive.archived_at,
    } : null,
    patternsApplied,
    patternsCount: patternsApplied.length,
    suggestions: {
      total: totalSuggestions,
      accepted: acceptedSuggestions,
      modified: modifiedSuggestions,
      rejected: totalSuggestions - acceptedSuggestions,
      acceptanceRate: totalSuggestions > 0
        ? Math.round((acceptedSuggestions / totalSuggestions) * 1000) / 1000
        : 0,
    },
    revisionStats,
  };
}

export default { getInfluenceExplanation, getCaseLearningReport };
