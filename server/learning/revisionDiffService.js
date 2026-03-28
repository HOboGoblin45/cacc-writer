/**
 * server/learning/revisionDiffService.js
 * -----------------------------------------
 * Captures and analyzes diffs between AI-drafted text and final appraiser text.
 *
 * Used by the controlled learning loop to understand how appraisers modify
 * AI-generated content, enabling continuous improvement of suggestions.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Compute a simple diff between two texts.
 * Returns word-level change information.
 */
function computeDiff(draftText, finalText) {
  const draft = (draftText || '').trim();
  const final = (finalText || '').trim();

  if (!draft && !final) {
    return { operations: [], addedWords: 0, removedWords: 0, unchangedWords: 0 };
  }

  const draftWords = draft ? draft.split(/\s+/) : [];
  const finalWords = final ? final.split(/\s+/) : [];

  // Simple word-level diff using set comparison
  const draftSet = new Set(draftWords);
  const finalSet = new Set(finalWords);

  let addedWords = 0;
  let removedWords = 0;
  let unchangedWords = 0;

  for (const w of finalWords) {
    if (draftSet.has(w)) {
      unchangedWords++;
    } else {
      addedWords++;
    }
  }
  for (const w of draftWords) {
    if (!finalSet.has(w)) {
      removedWords++;
    }
  }

  const operations = [];
  if (removedWords > 0) operations.push({ type: 'remove', count: removedWords });
  if (addedWords > 0) operations.push({ type: 'add', count: addedWords });

  return { operations, addedWords, removedWords, unchangedWords };
}

/**
 * Compute the change ratio between draft and final text.
 * 0 = identical, 1 = completely different.
 */
function computeChangeRatio(draftText, finalText) {
  const draft = (draftText || '').trim();
  const final = (finalText || '').trim();

  if (!draft && !final) return 0;
  if (!draft || !final) return 1;
  if (draft === final) return 0;

  const draftWords = draft.split(/\s+/);
  const finalWords = final.split(/\s+/);
  const totalWords = Math.max(draftWords.length, finalWords.length);
  if (totalWords === 0) return 0;

  const diff = computeDiff(draft, final);
  const changedWords = diff.addedWords + diff.removedWords;
  return Math.min(1, changedWords / (totalWords * 2) * 2);
}

/**
 * Capture and store the diff between AI draft and final appraiser text.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {string} draftText - the AI-generated draft
 * @param {string} finalText - the appraiser's final version
 * @param {object} [opts] - optional metadata
 * @returns {object} The stored revision diff record
 */
export function captureRevisionDiff(caseId, sectionId, draftText, finalText, opts = {}) {
  if (!caseId || !sectionId) {
    return { error: 'caseId and sectionId are required' };
  }

  const diff = computeDiff(draftText, finalText);
  const changeRatio = computeChangeRatio(draftText, finalText);
  const id = uuidv4();

  dbRun(`
    INSERT INTO revision_diffs (id, case_id, section_id, draft_text, final_text, diff_json, change_ratio, form_type, property_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    caseId,
    sectionId,
    draftText || '',
    finalText || '',
    JSON.stringify(diff),
    changeRatio,
    opts.formType || null,
    opts.propertyType || null,
  ]);

  log.info('learning:revision-diff-captured', { caseId, sectionId, changeRatio });

  return {
    id,
    caseId,
    sectionId,
    changeRatio,
    diff,
  };
}

/**
 * Get all revision diffs for a case.
 *
 * @param {string} caseId
 * @returns {object[]}
 */
export function getRevisionDiffs(caseId) {
  const rows = dbAll(
    'SELECT * FROM revision_diffs WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );

  return rows.map(row => ({
    id: row.id,
    caseId: row.case_id,
    sectionId: row.section_id,
    draftText: row.draft_text,
    finalText: row.final_text,
    diff: safeJsonParse(row.diff_json, {}),
    changeRatio: row.change_ratio,
    formType: row.form_type,
    propertyType: row.property_type,
    createdAt: row.created_at,
  }));
}

/**
 * Get summary stats for revision diffs in a case.
 *
 * @param {string} caseId
 * @returns {object}
 */
export function getDiffStats(caseId) {
  const diffs = getRevisionDiffs(caseId);

  if (diffs.length === 0) {
    return {
      sectionsChanged: 0,
      totalSections: 0,
      averageChangeRatio: 0,
      mostChangedSections: [],
    };
  }

  const changed = diffs.filter(d => d.changeRatio > 0);
  const avgRatio = diffs.reduce((sum, d) => sum + d.changeRatio, 0) / diffs.length;

  // Sort by change ratio descending to find most-changed sections
  const sorted = [...diffs].sort((a, b) => b.changeRatio - a.changeRatio);
  const mostChangedSections = sorted.slice(0, 5).map(d => ({
    sectionId: d.sectionId,
    changeRatio: d.changeRatio,
  }));

  return {
    sectionsChanged: changed.length,
    totalSections: diffs.length,
    averageChangeRatio: Math.round(avgRatio * 1000) / 1000,
    mostChangedSections,
  };
}

/**
 * Query diff patterns across multiple cases for learning.
 *
 * @param {object} filters
 * @param {string} [filters.sectionId]
 * @param {string} [filters.formType]
 * @param {string} [filters.propertyType]
 * @param {number} [filters.limit]
 * @returns {object[]}
 */
export function getDiffPatterns(filters = {}) {
  let sql = 'SELECT section_id, form_type, property_type, AVG(change_ratio) as avg_ratio, COUNT(*) as sample_count FROM revision_diffs WHERE 1=1';
  const params = [];

  if (filters.sectionId) {
    sql += ' AND section_id = ?';
    params.push(filters.sectionId);
  }
  if (filters.formType) {
    sql += ' AND form_type = ?';
    params.push(filters.formType);
  }
  if (filters.propertyType) {
    sql += ' AND property_type = ?';
    params.push(filters.propertyType);
  }

  sql += ' GROUP BY section_id, form_type, property_type ORDER BY avg_ratio DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }

  const rows = dbAll(sql, params);

  return rows.map(row => ({
    sectionId: row.section_id,
    formType: row.form_type,
    propertyType: row.property_type,
    averageChangeRatio: Math.round(row.avg_ratio * 1000) / 1000,
    sampleCount: row.sample_count,
  }));
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str || '');
  } catch {
    return fallback;
  }
}

export default {
  captureRevisionDiff,
  getRevisionDiffs,
  getDiffStats,
  getDiffPatterns,
};
