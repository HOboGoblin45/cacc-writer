import log from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ingest single feedback record into voice corpus
 * @param {Database} db - User database instance
 * @param {string} feedbackId - Feedback record ID
 * @returns {Object} { success, corpusEntryId, message }
 */
export function ingestFeedbackToCorpus(db, feedbackId) {
  if (!feedbackId) {
    log.warn('ingestFeedbackToCorpus: feedbackId required');
    return {
      success: false,
      message: 'feedbackId required',
    };
  }

  let corpusEntryId = null;
  let userId = null;

  try {
    // Get feedback record
    const feedbackStmt = db.prepare(`
      SELECT id, user_id, has_edits, edited_text, feedback_rating, feedback_timestamp
      FROM user_feedback
      WHERE id = ?
    `);

    const feedback = feedbackStmt.get(feedbackId);

    if (!feedback) {
      log.warn(`ingestFeedbackToCorpus: Feedback not found: ${feedbackId}`);
      return {
        success: false,
        message: 'Feedback record not found',
      };
    }

    userId = feedback.user_id;

    // Check if feedback has edits
    if (!feedback.has_edits || !feedback.edited_text) {
      log.info(`[${userId}] ingestFeedbackToCorpus: Feedback ${feedbackId} has no edits, skipping`);
      return {
        success: false,
        message: 'Feedback has no edits',
      };
    }

    corpusEntryId = uuidv4();

    // Create corpus entry
    const corpusStmt = db.prepare(`
      INSERT INTO voice_corpus (
        id, user_id, source_feedback_id, voice_sample_text,
        sample_rating, ingestion_timestamp, is_approved
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    corpusStmt.run(
      corpusEntryId,
      userId,
      feedbackId,
      feedback.edited_text,
      feedback.feedback_rating || 0,
      new Date().toISOString(),
      1 // Approved on ingestion
    );

    log.info(
      `[${userId}] ingestFeedbackToCorpus: Created corpus entry ${corpusEntryId} from feedback ${feedbackId}`
    );

    return {
      success: true,
      corpusEntryId,
      message: 'Feedback ingested into voice corpus',
    };
  } catch (err) {
    log.error(
      `ingestFeedbackToCorpus: Error for feedback ${feedbackId}: ${err.message}`
    );
    return {
      success: false,
      message: `Error: ${err.message}`,
    };
  }
}

/**
 * Batch ingest feedback records with edits into voice corpus
 * @param {Database} db - User database instance
 * @param {Object} options - Filter options { minRating, limit, userIdFilter }
 * @returns {Object} { success, ingested, skipped, errors, totalProcessed }
 */
export function batchIngestFromFeedback(db, options = {}) {
  const { minRating = 0, limit = 100, userIdFilter = null } = options;

  let ingested = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Build query
    let query = `
      SELECT id, user_id, has_edits, edited_text, feedback_rating
      FROM user_feedback
      WHERE has_edits = 1 AND edited_text IS NOT NULL
    `;

    const params = [];

    if (minRating > 0) {
      query += ` AND feedback_rating >= ?`;
      params.push(minRating);
    }

    if (userIdFilter) {
      query += ` AND user_id = ?`;
      params.push(userIdFilter);
    }

    query += ` LIMIT ?`;
    params.push(limit);

    const feedbackStmt = db.prepare(query);
    const feedbackRecords = feedbackStmt.all(...params);

    log.info(`batchIngestFromFeedback: Processing ${feedbackRecords.length} feedback records`);

    // Process each feedback record
    for (const feedback of feedbackRecords) {
      const result = ingestFeedbackToCorpus(db, feedback.id);

      if (result.success) {
        ingested++;
      } else {
        skipped++;
      }
    }

    log.info(
      `batchIngestFromFeedback: Complete - ingested=${ingested}, skipped=${skipped}, errors=${errors}`
    );

    return {
      success: true,
      ingested,
      skipped,
      errors,
      totalProcessed: ingested + skipped,
    };
  } catch (err) {
    log.error(`batchIngestFromFeedback: Fatal error: ${err.message}`);
    return {
      success: false,
      ingested,
      skipped,
      errors: 1,
      totalProcessed: ingested + skipped,
      message: err.message,
    };
  }
}

/**
 * Get voice corpus ingestion statistics
 * @param {Database} db - User database instance
 * @returns {Object} Statistics about corpus ingestion
 */
export function getIngestionStats(db) {
  const stats = {
    totalCorpusEntries: 0,
    totalFeedbackWithEdits: 0,
    corpusByUser: {},
    averageRating: 0,
    ingestionRate: 0,
    lastIngestionTime: null,
  };

  try {
    // Total corpus entries
    const corpusCountStmt = db.prepare(`
      SELECT COUNT(*) as count FROM voice_corpus
    `);

    const corpusResult = corpusCountStmt.get();
    stats.totalCorpusEntries = corpusResult?.count || 0;

    // Total feedback with edits
    const feedbackCountStmt = db.prepare(`
      SELECT COUNT(*) as count FROM user_feedback WHERE has_edits = 1
    `);

    const feedbackResult = feedbackCountStmt.get();
    stats.totalFeedbackWithEdits = feedbackResult?.count || 0;

    // Corpus entries by user
    const userCorpusStmt = db.prepare(`
      SELECT user_id, COUNT(*) as count FROM voice_corpus
      GROUP BY user_id
      ORDER BY count DESC
    `);

    const userCorpusResults = userCorpusStmt.all();
    for (const row of userCorpusResults) {
      stats.corpusByUser[row.user_id] = row.count;
    }

    // Average rating of corpus entries
    const avgRatingStmt = db.prepare(`
      SELECT AVG(sample_rating) as avg_rating FROM voice_corpus
    `);

    const avgRatingResult = avgRatingStmt.get();
    stats.averageRating = parseFloat(avgRatingResult?.avg_rating || 0).toFixed(2);

    // Ingestion rate (entries / feedback with edits)
    if (stats.totalFeedbackWithEdits > 0) {
      stats.ingestionRate = parseFloat(
        (stats.totalCorpusEntries / stats.totalFeedbackWithEdits * 100).toFixed(2)
      );
    }

    // Last ingestion time
    const lastIngestionStmt = db.prepare(`
      SELECT ingestion_timestamp FROM voice_corpus
      ORDER BY ingestion_timestamp DESC
      LIMIT 1
    `);

    const lastIngestionResult = lastIngestionStmt.get();
    if (lastIngestionResult) {
      stats.lastIngestionTime = lastIngestionResult.ingestion_timestamp;
    }

    log.info(
      `getIngestionStats: ${stats.totalCorpusEntries} entries, ${stats.ingestionRate}% ingestion rate`
    );
  } catch (err) {
    log.error(`getIngestionStats: Error: ${err.message}`);
  }

  return stats;
}

export default {
  ingestFeedbackToCorpus,
  batchIngestFromFeedback,
  getIngestionStats,
};
