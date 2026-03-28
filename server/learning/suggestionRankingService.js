/**
 * server/learning/suggestionRankingService.js
 * ----------------------------------------------
 * Tracks suggestion outcomes (accepted/rejected/modified) and uses
 * historical acceptance rates to rank future suggestions.
 *
 * Part of the controlled learning loop: suggestions that are consistently
 * accepted get ranked higher; those consistently rejected get demoted.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Record the outcome of a suggestion (accepted, rejected, or modified).
 *
 * @param {string} caseId
 * @param {string} suggestionId
 * @param {object} outcome
 * @param {boolean} outcome.accepted
 * @param {string} [outcome.modifiedText]
 * @param {string} [outcome.originalText]
 * @param {string} outcome.sectionId
 * @param {string} [outcome.suggestionType]
 * @param {string} [outcome.suggestedText]
 * @param {string} [outcome.rejectionReason]
 * @param {string} [outcome.formType]
 * @param {string} [outcome.propertyType]
 * @returns {object}
 */
export function recordSuggestionOutcome(caseId, suggestionId, outcome = {}) {
  if (!caseId || !outcome.sectionId) {
    return { error: 'caseId and sectionId are required' };
  }

  const id = uuidv4();
  const accepted = outcome.accepted ? 1 : 0;
  const modified = outcome.modifiedText ? 1 : 0;

  dbRun(`
    INSERT INTO suggestion_outcomes
      (id, case_id, suggestion_id, section_id, suggestion_type, original_text, suggested_text, final_text, accepted, modified, rejection_reason, form_type, property_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    caseId,
    suggestionId || null,
    outcome.sectionId,
    outcome.suggestionType || 'narrative',
    outcome.originalText || null,
    outcome.suggestedText || null,
    outcome.modifiedText || outcome.originalText || null,
    accepted,
    modified,
    outcome.rejectionReason || null,
    outcome.formType || null,
    outcome.propertyType || null,
  ]);

  log.info('learning:suggestion-outcome-recorded', {
    caseId, suggestionId, sectionId: outcome.sectionId, accepted,
  });

  return { id, caseId, suggestionId, accepted: !!accepted, modified: !!modified };
}

/**
 * Get all suggestion outcomes for a case.
 *
 * @param {string} caseId
 * @returns {object[]}
 */
export function getSuggestionHistory(caseId) {
  const rows = dbAll(
    'SELECT * FROM suggestion_outcomes WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );

  return rows.map(rowToRecord);
}

/**
 * Calculate acceptance rate by type/section with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.sectionId]
 * @param {string} [filters.suggestionType]
 * @param {string} [filters.formType]
 * @param {string} [filters.propertyType]
 * @returns {object}
 */
export function getSuggestionAcceptanceRate(filters = {}) {
  let sql = 'SELECT COUNT(*) as total, SUM(accepted) as accepted_count, SUM(modified) as modified_count FROM suggestion_outcomes WHERE 1=1';
  const params = [];

  if (filters.sectionId) {
    sql += ' AND section_id = ?';
    params.push(filters.sectionId);
  }
  if (filters.suggestionType) {
    sql += ' AND suggestion_type = ?';
    params.push(filters.suggestionType);
  }
  if (filters.formType) {
    sql += ' AND form_type = ?';
    params.push(filters.formType);
  }
  if (filters.propertyType) {
    sql += ' AND property_type = ?';
    params.push(filters.propertyType);
  }

  const row = dbGet(sql, params);
  const total = row?.total || 0;
  const acceptedCount = row?.accepted_count || 0;
  const modifiedCount = row?.modified_count || 0;

  return {
    total,
    accepted: acceptedCount,
    modified: modifiedCount,
    rejected: total - acceptedCount,
    acceptanceRate: total > 0 ? Math.round((acceptedCount / total) * 1000) / 1000 : 0,
    modificationRate: total > 0 ? Math.round((modifiedCount / total) * 1000) / 1000 : 0,
  };
}

/**
 * Get historically-ranked suggestions for a section based on past acceptance.
 *
 * @param {string} sectionId
 * @param {string} [formType]
 * @param {object} [context] - additional context for ranking
 * @returns {object[]}
 */
export function getRankedSuggestions(sectionId, formType, context = {}) {
  let sql = `
    SELECT suggestion_type, section_id, form_type, property_type,
           COUNT(*) as total,
           SUM(accepted) as accepted_count,
           SUM(modified) as modified_count
    FROM suggestion_outcomes
    WHERE section_id = ?
  `;
  const params = [sectionId];

  if (formType) {
    sql += ' AND form_type = ?';
    params.push(formType);
  }
  if (context.propertyType) {
    sql += ' AND property_type = ?';
    params.push(context.propertyType);
  }

  sql += ' GROUP BY suggestion_type ORDER BY (CAST(SUM(accepted) AS REAL) / COUNT(*)) DESC';

  const rows = dbAll(sql, params);

  return rows.map(row => ({
    suggestionType: row.suggestion_type,
    sectionId: row.section_id,
    formType: row.form_type,
    propertyType: row.property_type,
    total: row.total,
    accepted: row.accepted_count || 0,
    modified: row.modified_count || 0,
    acceptanceRate: row.total > 0 ? Math.round(((row.accepted_count || 0) / row.total) * 1000) / 1000 : 0,
    rank: row.total > 0 ? (row.accepted_count || 0) / row.total : 0,
  }));
}

/**
 * Explain what historical patterns influence suggestions for a section.
 *
 * @param {string} sectionId
 * @param {string} [formType]
 * @returns {object}
 */
export function getLearnedInfluenceExplanation(sectionId, formType) {
  const ranked = getRankedSuggestions(sectionId, formType);
  const rate = getSuggestionAcceptanceRate({ sectionId, formType });

  const topPatterns = ranked.slice(0, 5);
  const sampleSize = rate.total;

  let explanation = '';
  if (sampleSize === 0) {
    explanation = `No historical suggestion data available for section "${sectionId}".`;
  } else if (rate.acceptanceRate >= 0.8) {
    explanation = `Suggestions for "${sectionId}" have a high acceptance rate (${(rate.acceptanceRate * 100).toFixed(1)}%) based on ${sampleSize} outcomes. The system is well-calibrated for this section.`;
  } else if (rate.acceptanceRate >= 0.5) {
    explanation = `Suggestions for "${sectionId}" have a moderate acceptance rate (${(rate.acceptanceRate * 100).toFixed(1)}%) based on ${sampleSize} outcomes. There is room for improvement.`;
  } else {
    explanation = `Suggestions for "${sectionId}" have a low acceptance rate (${(rate.acceptanceRate * 100).toFixed(1)}%) based on ${sampleSize} outcomes. The system should adapt its approach for this section.`;
  }

  return {
    sectionId,
    formType: formType || null,
    acceptanceRate: rate.acceptanceRate,
    sampleSize,
    topPatterns,
    explanation,
  };
}

function rowToRecord(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    suggestionId: row.suggestion_id,
    sectionId: row.section_id,
    suggestionType: row.suggestion_type,
    originalText: row.original_text,
    suggestedText: row.suggested_text,
    finalText: row.final_text,
    accepted: !!row.accepted,
    modified: !!row.modified,
    rejectionReason: row.rejection_reason,
    formType: row.form_type,
    propertyType: row.property_type,
    createdAt: row.created_at,
  };
}

export default {
  recordSuggestionOutcome,
  getSuggestionHistory,
  getSuggestionAcceptanceRate,
  getRankedSuggestions,
  getLearnedInfluenceExplanation,
};
