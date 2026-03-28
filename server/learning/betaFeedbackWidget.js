import log from '../logger.js';

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a
 * @param {string} b
 * @returns {number} Levenshtein distance
 */
export function levenshteinDistance(a, b) {
  const aLen = a.length;
  const bLen = b.length;

  const matrix = Array(bLen + 1).fill(null).map(() => Array(aLen + 1).fill(0));

  for (let i = 0; i <= aLen; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= bLen; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= bLen; j++) {
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[bLen][aLen];
}

/**
 * Split text into sentences
 * @param {string} text
 * @returns {string[]} Array of sentences
 */
function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);
}

/**
 * Extract diff segments between original and edited text
 * @param {string} original
 * @param {string} edited
 * @returns {object[]} Array of diff segments
 */
export function extractDiffSegments(original, edited) {
  const originalSentences = splitSentences(original);
  const editedSentences = splitSentences(edited);

  const diffs = [];
  const maxLen = Math.max(originalSentences.length, editedSentences.length);

  for (let i = 0; i < maxLen; i++) {
    const origSent = originalSentences[i] || '';
    const editSent = editedSentences[i] || '';

    if (origSent !== editSent) {
      let type = 'modified';
      if (!origSent) {
        type = 'added';
      } else if (!editSent) {
        type = 'removed';
      }

      diffs.push({
        position: i,
        originalSentence: origSent,
        editedSentence: editSent,
        type
      });
    }
  }

  return diffs;
}

/**
 * Submit feedback for a generated section
 * @param {Database} db - SQLite database instance
 * @param {object} data - Feedback data
 * @returns {object} Result with feedbackId, editDistance, editRatio, hasEdits
 */
export function submitSectionFeedback(db, data) {
  const {
    userId,
    caseId,
    sectionType,
    rating,
    originalText,
    editedText,
    feedbackNote
  } = data;

  if (!userId || !caseId || !sectionType) {
    throw new Error('Missing required fields: userId, caseId, sectionType');
  }

  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  const editDistance = levenshteinDistance(originalText || '', editedText || '');
  const maxLen = Math.max((originalText || '').length, (editedText || '').length);
  const editRatio = maxLen > 0 ? editDistance / maxLen : 0;
  const hasEdits = originalText !== editedText;

  const result = db
    .prepare(`
      INSERT INTO beta_feedback (
        user_id,
        case_id,
        section_type,
        rating,
        original_text,
        edited_text,
        feedback_note,
        edit_distance,
        edit_ratio,
        has_edits,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    .run(
      userId,
      caseId,
      sectionType,
      rating,
      originalText || null,
      editedText || null,
      feedbackNote || null,
      editDistance,
      editRatio,
      hasEdits ? 1 : 0
    );

  const feedbackId = result.lastInsertRowid;

  // Extract and store diff segments if there are edits
  if (hasEdits) {
    const diffs = extractDiffSegments(originalText || '', editedText || '');
    const diffStmt = db.prepare(`
      INSERT INTO feedback_diffs (
        feedback_id,
        position,
        original_sentence,
        edited_sentence,
        diff_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const diff of diffs) {
      diffStmt.run(
        feedbackId,
        diff.position,
        diff.originalSentence || null,
        diff.editedSentence || null,
        diff.type
      );
    }
  }

  log.info(`Feedback submitted for case ${caseId}, section ${sectionType}, rating ${rating}`);

  return {
    feedbackId,
    editDistance,
    editRatio: parseFloat(editRatio.toFixed(4)),
    hasEdits
  };
}

/**
 * Export feedback with edits as training data pairs
 * @param {Database} db - SQLite database instance
 * @param {object} options - Export options
 * @returns {object[]} Array of training pairs
 */
export function exportTrainingPairs(db, options = {}) {
  const {
    minRating = 4,
    sectionFilter = null,
    hasEditsOnly = true,
    limit = 1000
  } = options;

  let query = `
    SELECT
      bf.id,
      bf.case_id,
      bf.section_type,
      bf.rating,
      bf.original_text,
      bf.edited_text,
      bf.feedback_note,
      bf.edit_distance,
      bf.edit_ratio,
      bf.created_at
    FROM beta_feedback bf
    WHERE bf.rating >= ?
  `;

  const params = [minRating];

  if (sectionFilter) {
    query += ` AND bf.section_type = ?`;
    params.push(sectionFilter);
  }

  if (hasEditsOnly) {
    query += ` AND bf.has_edits = 1`;
  }

  query += ` ORDER BY bf.created_at DESC LIMIT ?`;
  params.push(limit);

  const feedbacks = db.prepare(query).all(...params);

  const pairs = feedbacks.map(fb => ({
    feedbackId: fb.id,
    caseId: fb.case_id,
    sectionType: fb.section_type,
    rating: fb.rating,
    originalText: fb.original_text,
    editedText: fb.edited_text,
    editDistance: fb.edit_distance,
    editRatio: fb.edit_ratio,
    feedbackNote: fb.feedback_note,
    createdAt: fb.created_at
  }));

  log.info(`Exported ${pairs.length} training pairs with minRating=${minRating}`);

  return pairs;
}

/**
 * Get aggregated feedback statistics for a user
 * @param {Database} db - SQLite database instance
 * @param {string} userId - User ID
 * @returns {object} Aggregated statistics
 */
export function getFeedbackStats(db, userId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_feedback,
      AVG(rating) as avg_rating,
      MIN(rating) as min_rating,
      MAX(rating) as max_rating,
      SUM(CASE WHEN has_edits = 1 THEN 1 ELSE 0 END) as feedback_with_edits,
      AVG(edit_ratio) as avg_edit_ratio,
      COUNT(DISTINCT case_id) as unique_cases,
      COUNT(DISTINCT section_type) as section_types_reviewed
    FROM beta_feedback
    WHERE user_id = ?
  `).get(userId);

  const sectionStats = db.prepare(`
    SELECT
      section_type,
      COUNT(*) as count,
      AVG(rating) as avg_rating,
      SUM(CASE WHEN has_edits = 1 THEN 1 ELSE 0 END) as edited_count
    FROM beta_feedback
    WHERE user_id = ?
    GROUP BY section_type
    ORDER BY count DESC
  `).all(userId);

  log.info(`Retrieved feedback stats for user ${userId}`);

  return {
    overall: {
      totalFeedback: stats.total_feedback || 0,
      avgRating: stats.avg_rating ? parseFloat(stats.avg_rating.toFixed(2)) : 0,
      minRating: stats.min_rating || 0,
      maxRating: stats.max_rating || 0,
      feedbackWithEdits: stats.feedback_with_edits || 0,
      avgEditRatio: stats.avg_edit_ratio ? parseFloat(stats.avg_edit_ratio.toFixed(4)) : 0,
      uniqueCases: stats.unique_cases || 0,
      sectionTypesReviewed: stats.section_types_reviewed || 0
    },
    bySection: sectionStats.map(s => ({
      sectionType: s.section_type,
      count: s.count,
      avgRating: parseFloat(s.avg_rating.toFixed(2)),
      editedCount: s.edited_count
    }))
  };
}
