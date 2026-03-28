/**
 * server/learning/betaFeedbackService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Structured Feedback Collection & Analysis for Beta Program
 *
 * Collects qualitative and quantitative feedback from beta appraisers:
 * - recordFeedback: Store feedback with diff analysis
 * - analyzeFeedbackTrends: Identify patterns and problem areas
 * - getVoiceTrainingExamples: Extract approved text samples for voice training
 * - computeDiffMetrics: Character-level and semantic diff analysis
 * - exportTrainingData: Export feedback for model fine-tuning
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// RECORD FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record feedback from beta user.
 *
 * @param {string} userId - User ID
 * @param {Object} feedback - Feedback object
 * @param {string} [feedback.caseId] - Associated case ID
 * @param {string} [feedback.sectionId] - Associated section ID
 * @param {number} [feedback.qualityRating] - 1-5 quality rating
 * @param {number} [feedback.accuracyRating] - 1-5 accuracy rating
 * @param {number} [feedback.voiceMatchRating] - 1-5 voice match rating
 * @param {string} [feedback.comments] - User comments
 * @param {string} [feedback.generatedText] - Generated text
 * @param {string} [feedback.finalApprovedText] - Final approved text
 * @returns {Object} Stored feedback record with diff metrics
 */
export function recordFeedback(userId, feedback) {
  const db = getDb();

  const {
    caseId,
    sectionId,
    qualityRating,
    accuracyRating,
    voiceMatchRating,
    comments,
    generatedText,
    finalApprovedText,
  } = feedback;

  // Compute diff metrics if both texts provided
  let diffMetrics = {};
  if (generatedText && finalApprovedText) {
    diffMetrics = computeDiffMetrics(generatedText, finalApprovedText);
  }

  const id = require('crypto').randomBytes(8).toString('hex');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO beta_feedback
    (id, user_id, case_id, section_id, quality_rating, accuracy_rating,
     voice_match_rating, comments, generated_text, final_approved_text, diff_metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    caseId || null,
    sectionId || null,
    qualityRating || null,
    accuracyRating || null,
    voiceMatchRating || null,
    comments || null,
    generatedText || null,
    finalApprovedText || null,
    JSON.stringify(diffMetrics)
  );

  log.info('feedback-service:feedback-recorded', {
    feedbackId: id,
    userId,
    caseId,
    sectionId,
  });

  return {
    id,
    userId,
    caseId,
    sectionId,
    qualityRating,
    accuracyRating,
    voiceMatchRating,
    diffMetrics,
    createdAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE TRENDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze feedback trends to identify patterns and problem areas.
 *
 * @param {Object} options - Analysis options
 * @param {string} [options.sectionId] - Filter by section
 * @param {string} [options.caseId] - Filter by case
 * @param {number} [options.minQualityThreshold] - Flag issues below this rating (default: 3)
 * @returns {Object} Trend analysis with section-level problems
 */
export function analyzeFeedbackTrends(options = {}) {
  const db = getDb();
  const { sectionId, caseId, minQualityThreshold = 3 } = options;

  // Build WHERE clause
  let whereClause = '1=1';
  const params = [];

  if (sectionId) {
    whereClause += ' AND section_id = ?';
    params.push(sectionId);
  }

  if (caseId) {
    whereClause += ' AND case_id = ?';
    params.push(caseId);
  }

  // Get section-level stats
  const sectionTrends = db.prepare(`
    SELECT
      section_id,
      COUNT(*) as feedbackCount,
      ROUND(AVG(quality_rating), 2) as avgQuality,
      ROUND(AVG(accuracy_rating), 2) as avgAccuracy,
      ROUND(AVG(voice_match_rating), 2) as avgVoiceMatch,
      COUNT(CASE WHEN quality_rating < ? THEN 1 END) as lowQualityCount,
      COUNT(CASE WHEN accuracy_rating < ? THEN 1 END) as lowAccuracyCount,
      COUNT(CASE WHEN voice_match_rating < ? THEN 1 END) as lowVoiceMatchCount
    FROM beta_feedback
    WHERE ${whereClause}
    GROUP BY section_id
    ORDER BY avgQuality ASC
  `).all(...params, minQualityThreshold, minQualityThreshold, minQualityThreshold);

  // Get overall stats
  const overallStats = db.prepare(`
    SELECT
      COUNT(*) as totalFeedback,
      ROUND(AVG(quality_rating), 2) as avgQuality,
      ROUND(AVG(accuracy_rating), 2) as avgAccuracy,
      ROUND(AVG(voice_match_rating), 2) as avgVoiceMatch,
      COUNT(CASE WHEN quality_rating < ? THEN 1 END) as lowQualityCount,
      COUNT(CASE WHEN comments IS NOT NULL AND comments != '' THEN 1 END) as commentsCount
    FROM beta_feedback
    WHERE ${whereClause}
  `).get(...params, minQualityThreshold);

  // Get common issues from comments
  const issues = extractCommonIssues(db, whereClause, params);

  return {
    overall: overallStats,
    bySection: sectionTrends,
    issues,
    needsImprovement: sectionTrends.filter(s => s.avgQuality < minQualityThreshold),
  };
}

/**
 * Extract common issues from feedback comments (simple keyword matching).
 */
function extractCommonIssues(db, whereClause, params) {
  const feedbackWithComments = db.prepare(`
    SELECT comments FROM beta_feedback
    WHERE ${whereClause} AND comments IS NOT NULL AND comments != ''
  `).all(...params);

  const issueKeywords = {
    accuracy: ['inaccurate', 'wrong', 'incorrect', 'error', 'mistake', 'not accurate'],
    voice: ['voice', 'tone', 'sound', 'style', 'match', 'doesn\'t match'],
    grammar: ['grammar', 'spelling', 'punctuation', 'typo', 'syntax'],
    length: ['too long', 'too short', 'verbose', 'brief', 'concise'],
    missing: ['missing', 'incomplete', 'forgot', 'omitted'],
  };

  const issueCounts = {};
  for (const key of Object.keys(issueKeywords)) {
    issueCounts[key] = 0;
  }

  for (const row of feedbackWithComments) {
    const comment = (row.comments || '').toLowerCase();
    for (const [issue, keywords] of Object.entries(issueKeywords)) {
      if (keywords.some(kw => comment.includes(kw))) {
        issueCounts[issue]++;
      }
    }
  }

  return issueCounts;
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE TRAINING DATA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract approved text samples for voice cloning/training.
 * Returns high-confidence approved variations by section.
 *
 * @param {string} userId - User ID
 * @param {Object} [options] - Filter options
 * @param {string} [options.sectionId] - Filter by section
 * @param {number} [options.minQualityRating] - Minimum quality rating (default: 4)
 * @returns {Array<Object>} Training examples with metadata
 */
export function getVoiceTrainingExamples(userId, options = {}) {
  const db = getDb();
  const { sectionId, minQualityRating = 4 } = options;

  let whereClause = 'user_id = ? AND quality_rating >= ? AND final_approved_text IS NOT NULL';
  const params = [userId, minQualityRating];

  if (sectionId) {
    whereClause += ' AND section_id = ?';
    params.push(sectionId);
  }

  const examples = db.prepare(`
    SELECT
      id,
      section_id,
      final_approved_text as text,
      quality_rating,
      accuracy_rating,
      voice_match_rating,
      created_at
    FROM beta_feedback
    WHERE ${whereClause}
    ORDER BY quality_rating DESC, created_at DESC
  `).all(...params);

  log.info('feedback-service:voice-examples-extracted', {
    userId,
    count: examples.length,
  });

  return examples;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIFF METRICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute character-level and semantic diff between generated and approved text.
 *
 * @param {string} generated - Generated text
 * @param {string} approved - Approved (final) text
 * @returns {Object} Diff metrics including edit distance, length changes, etc.
 */
export function computeDiffMetrics(generated, approved) {
  const generatedLength = generated.length;
  const approvedLength = approved.length;
  const lengthDiff = approvedLength - generatedLength;
  const lengthDiffPercent = generatedLength > 0 ? ((lengthDiff / generatedLength) * 100).toFixed(1) : 0;

  // Levenshtein distance for edit operations
  const editDistance = levenshteinDistance(generated, approved);
  const similarityScore = computeSimilarity(generated, approved);

  // Word-level changes
  const generatedWords = generated.toLowerCase().split(/\s+/).filter(Boolean);
  const approvedWords = approved.toLowerCase().split(/\s+/).filter(Boolean);
  const wordDiff = Math.abs(approvedWords.length - generatedWords.length);

  // Sentence count
  const generatedSentences = generated.split(/[.!?]+/).filter(Boolean).length;
  const approvedSentences = approved.split(/[.!?]+/).filter(Boolean).length;

  return {
    generatedLength,
    approvedLength,
    lengthDiff,
    lengthDiffPercent: parseFloat(lengthDiffPercent),
    editDistance,
    similarityScore: parseFloat(similarityScore.toFixed(3)),
    wordCount: {
      generated: generatedWords.length,
      approved: approvedWords.length,
      diff: wordDiff,
    },
    sentenceCount: {
      generated: generatedSentences,
      approved: approvedSentences,
      diff: Math.abs(approvedSentences - generatedSentences),
    },
  };
}

/**
 * Compute similarity score (0-1) between two strings using Jaccard similarity.
 */
function computeSimilarity(str1, str2) {
  const set1 = new Set(str1.toLowerCase().split(/\s+/).filter(Boolean));
  const set2 = new Set(str2.toLowerCase().split(/\s+/).filter(Boolean));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len2 + 1)
    .fill(null)
    .map(() => Array(len1 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;

  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[len2][len1];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FOR TRAINING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export feedback data for model fine-tuning.
 *
 * @param {Object} options - Export options
 * @param {string} [options.format] - 'jsonl' | 'csv' (default: 'jsonl')
 * @param {string} [options.sectionId] - Filter by section
 * @param {number} [options.minQualityRating] - Minimum quality (default: 3)
 * @returns {string} Formatted training data
 */
export function exportTrainingData(options = {}) {
  const db = getDb();
  const { format = 'jsonl', sectionId, minQualityRating = 3 } = options;

  let whereClause = 'quality_rating >= ? AND generated_text IS NOT NULL AND final_approved_text IS NOT NULL';
  const params = [minQualityRating];

  if (sectionId) {
    whereClause += ' AND section_id = ?';
    params.push(sectionId);
  }

  const feedback = db.prepare(`
    SELECT
      id,
      user_id,
      case_id,
      section_id,
      quality_rating,
      accuracy_rating,
      voice_match_rating,
      comments,
      generated_text,
      final_approved_text,
      diff_metrics_json,
      created_at
    FROM beta_feedback
    WHERE ${whereClause}
    ORDER BY quality_rating DESC, created_at DESC
  `).all(...params);

  if (format === 'jsonl') {
    return feedback
      .map(row => JSON.stringify({
        input: row.generated_text,
        output: row.final_approved_text,
        metadata: {
          feedbackId: row.id,
          userId: row.user_id,
          caseId: row.case_id,
          sectionId: row.section_id,
          qualityRating: row.quality_rating,
          accuracyRating: row.accuracy_rating,
          voiceMatchRating: row.voice_match_rating,
          comments: row.comments,
          diffMetrics: row.diff_metrics_json ? JSON.parse(row.diff_metrics_json) : {},
          createdAt: row.created_at,
        },
      }))
      .join('\n');
  }

  if (format === 'csv') {
    const headers = 'id,user_id,section_id,quality_rating,generated_text,final_approved_text,comments';
    const rows = feedback.map(row => [
      row.id,
      row.user_id,
      row.section_id,
      row.quality_rating,
      `"${(row.generated_text || '').replace(/"/g, '""')}"`,
      `"${(row.final_approved_text || '').replace(/"/g, '""')}"`,
      `"${(row.comments || '').replace(/"/g, '""')}"`,
    ].join(','));

    return [headers, ...rows].join('\n');
  }

  throw new Error(`Unsupported format: ${format}`);
}

export default {
  recordFeedback,
  analyzeFeedbackTrends,
  getVoiceTrainingExamples,
  computeDiffMetrics,
  exportTrainingData,
};
