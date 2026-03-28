import express from 'express';
import log from '../logger.js';
import {
  submitSectionFeedback,
  getFeedbackStats,
  exportTrainingPairs,
  extractDiffSegments
} from '../learning/betaFeedbackWidget.js';

const router = express.Router();

/**
 * POST /api/feedback/section
 * Submit feedback for a generated section
 */
router.post('/section', (req, res) => {
  try {
    const { userId, caseId, sectionType, rating, originalText, editedText, feedbackNote } = req.body;

    // Validate input
    if (!userId || !caseId || !sectionType || !rating) {
      return res.status(400).json({
        error: 'Missing required fields: userId, caseId, sectionType, rating'
      });
    }

    const db = req.db;
    const result = submitSectionFeedback(db, {
      userId,
      caseId,
      sectionType,
      rating,
      originalText,
      editedText,
      feedbackNote
    });

    return res.json({
      success: true,
      feedbackId: result.feedbackId,
      editDistance: result.editDistance,
      editRatio: result.editRatio,
      hasEdits: result.hasEdits
    });
  } catch (error) {
    log.error(`Error submitting section feedback: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/feedback/stats
 * Get aggregated feedback statistics for the current user
 */
router.get('/stats', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = req.db;
    const stats = getFeedbackStats(db, userId);

    return res.json(stats);
  } catch (error) {
    log.error(`Error retrieving feedback stats: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/feedback/export
 * Export training pairs from feedback (admin only)
 */
router.get('/export', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user is admin (implement your admin logic here)
    // For now, we'll allow it but log the export
    const db = req.db;

    const minRating = parseInt(req.query.minRating) || 4;
    const sectionFilter = req.query.section || null;
    const hasEditsOnly = req.query.editsOnly !== 'false';
    const limit = parseInt(req.query.limit) || 1000;

    const pairs = exportTrainingPairs(db, {
      minRating,
      sectionFilter,
      hasEditsOnly,
      limit
    });

    // Log the export
    const exportId = `export-${Date.now()}`;
    const exportStmt = db.prepare(`
      INSERT INTO training_exports (
        export_id,
        total_pairs,
        min_rating,
        section_filter,
        exported_by,
        exported_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    exportStmt.run(
      exportId,
      pairs.length,
      minRating,
      sectionFilter,
      userId
    );

    log.info(`Training pairs exported: ${pairs.length} pairs by user ${userId}`);

    return res.json({
      success: true,
      exportId,
      totalPairs: pairs.length,
      pairs
    });
  } catch (error) {
    log.error(`Error exporting training pairs: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/feedback/diffs/:caseId
 * Get all diffs for a specific case
 */
router.get('/diffs/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = req.db;

    // Get all feedback entries for this case (user-scoped)
    const feedbacks = db.prepare(`
      SELECT
        bf.id,
        bf.section_type,
        bf.rating,
        bf.original_text,
        bf.edited_text,
        bf.edit_distance,
        bf.edit_ratio,
        bf.created_at
      FROM beta_feedback bf
      WHERE bf.case_id = ? AND bf.user_id = ?
      ORDER BY bf.created_at DESC
    `).all(caseId, userId);

    // Get diffs for each feedback
    const diffs = db.prepare(`
      SELECT
        fd.id,
        fd.feedback_id,
        fd.position,
        fd.original_sentence,
        fd.edited_sentence,
        fd.diff_type,
        fd.created_at
      FROM feedback_diffs fd
      INNER JOIN beta_feedback bf ON fd.feedback_id = bf.id
      WHERE bf.case_id = ? AND bf.user_id = ?
      ORDER BY fd.feedback_id, fd.position
    `).all(caseId, userId);

    // Group diffs by feedback
    const diffsByFeedback = {};
    diffs.forEach(diff => {
      if (!diffsByFeedback[diff.feedback_id]) {
        diffsByFeedback[diff.feedback_id] = [];
      }
      diffsByFeedback[diff.feedback_id].push({
        id: diff.id,
        position: diff.position,
        originalSentence: diff.original_sentence,
        editedSentence: diff.edited_sentence,
        type: diff.diff_type,
        createdAt: diff.created_at
      });
    });

    // Enrich feedbacks with their diffs
    const enrichedFeedbacks = feedbacks.map(fb => ({
      id: fb.id,
      sectionType: fb.section_type,
      rating: fb.rating,
      originalText: fb.original_text,
      editedText: fb.edited_text,
      editDistance: fb.edit_distance,
      editRatio: fb.edit_ratio,
      createdAt: fb.created_at,
      diffs: diffsByFeedback[fb.id] || []
    }));

    return res.json({
      caseId,
      totalFeedback: enrichedFeedbacks.length,
      feedbacks: enrichedFeedbacks
    });
  } catch (error) {
    log.error(`Error retrieving diffs for case ${req.params.caseId}: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
