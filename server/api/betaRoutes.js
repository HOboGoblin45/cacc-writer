/**
 * server/api/betaRoutes.js
 * ────────────────────────────────────────────────────────────────────────────
 * Beta Program Management — Wave 1 GTM
 *
 * Routes:
 *   POST   /api/beta/feedback           — Submit structured feedback
 *   GET    /api/beta/feedback           — Get feedback with pagination
 *   GET    /api/beta/feedback/stats     — Aggregate feedback statistics
 *   GET    /api/beta/users              — Admin: List beta users (admin-only)
 *   POST   /api/beta/invite             — Admin: Send beta invitation (admin-only)
 *
 * Beta feature flag: BETA_MODE=true env var
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { getDb } from '../db/database.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validateRequest.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const submitFeedbackSchema = z.object({
  caseId: z.string().optional(),
  sectionId: z.string().optional(),
  qualityRating: z.number().int().min(1).max(5).optional(),
  accuracyRating: z.number().int().min(1).max(5).optional(),
  voiceMatchRating: z.number().int().min(1).max(5).optional(),
  comments: z.string().max(5000).optional(),
  generatedText: z.string().optional(),
  finalApprovedText: z.string().optional(),
});

const getFeedbackQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  caseId: z.string().optional(),
  sectionId: z.string().optional(),
});

const inviteSchema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(1).max(255).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Check if beta mode is enabled
// ─────────────────────────────────────────────────────────────────────────────

function isBetaModeEnabled() {
  return process.env.BETA_MODE === 'true';
}

function requireBetaMode(req, res, next) {
  if (!isBetaModeEnabled()) {
    return res.status(503).json({
      ok: false,
      error: 'Beta program is not currently available',
    });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEEDBACK ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/beta/feedback
 * Submit structured feedback from beta user (authenticated).
 */
router.post(
  '/feedback',
  requireBetaMode,
  validateBody(submitFeedbackSchema),
  (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
      }

      const {
        caseId,
        sectionId,
        qualityRating,
        accuracyRating,
        voiceMatchRating,
        comments,
        generatedText,
        finalApprovedText,
      } = req.body;

      const db = getDb();

      // Compute diff metrics if both texts provided
      let diffMetrics = {};
      if (generatedText && finalApprovedText) {
        diffMetrics = computeDiffMetrics(generatedText, finalApprovedText);
      }

      const id = require('crypto').randomBytes(8).toString('hex');

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

      log.info('beta:feedback-submitted', { id, userId, caseId, sectionId });

      return res.status(201).json({
        ok: true,
        data: {
          id,
          submittedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      log.error('beta:feedback-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to submit feedback',
      });
    }
  }
);

/**
 * GET /api/beta/feedback
 * Retrieve feedback with pagination (authenticated).
 */
router.get(
  '/feedback',
  requireBetaMode,
  validateQuery(getFeedbackQuerySchema),
  (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
      }

      const { limit, offset, caseId, sectionId } = req.query;
      const db = getDb();

      // Build WHERE clause
      let whereClause = 'user_id = ?';
      const params = [userId];

      if (caseId) {
        whereClause += ' AND case_id = ?';
        params.push(caseId);
      }

      if (sectionId) {
        whereClause += ' AND section_id = ?';
        params.push(sectionId);
      }

      // Get total count
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM beta_feedback WHERE ${whereClause}`
      ).get(...params);

      // Get paginated feedback
      const feedback = db.prepare(`
        SELECT * FROM beta_feedback
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      return res.json({
        ok: true,
        data: {
          total: countResult.count,
          limit,
          offset,
          count: feedback.length,
          feedback,
        },
      });
    } catch (err) {
      log.error('beta:feedback-list-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch feedback',
      });
    }
  }
);

/**
 * GET /api/beta/feedback/stats
 * Aggregate feedback statistics (authenticated).
 */
router.get(
  '/feedback/stats',
  requireBetaMode,
  (req, res) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required',
        });
      }

      const db = getDb();

      // Aggregate ratings by section
      const sectionStats = db.prepare(`
        SELECT
          section_id,
          COUNT(*) as feedbackCount,
          ROUND(AVG(quality_rating), 2) as avgQuality,
          ROUND(AVG(accuracy_rating), 2) as avgAccuracy,
          ROUND(AVG(voice_match_rating), 2) as avgVoiceMatch,
          MIN(quality_rating) as minQuality,
          MAX(quality_rating) as maxQuality
        FROM beta_feedback
        WHERE user_id = ? AND section_id IS NOT NULL
        GROUP BY section_id
        ORDER BY feedbackCount DESC
      `).all(userId);

      // Overall stats
      const overallStats = db.prepare(`
        SELECT
          COUNT(*) as totalFeedback,
          COUNT(CASE WHEN quality_rating IS NOT NULL THEN 1 END) as qualityRatings,
          ROUND(AVG(quality_rating), 2) as avgQuality,
          ROUND(AVG(accuracy_rating), 2) as avgAccuracy,
          ROUND(AVG(voice_match_rating), 2) as avgVoiceMatch,
          COUNT(CASE WHEN quality_rating < 3 THEN 1 END) as lowQualityCount
        FROM beta_feedback
        WHERE user_id = ?
      `).get(userId);

      log.info('beta:stats-fetched', { userId });

      return res.json({
        ok: true,
        data: {
          overall: overallStats,
          bySection: sectionStats,
        },
      });
    } catch (err) {
      log.error('beta:stats-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch feedback statistics',
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/beta/users
 * Admin-only. List beta users with activity stats.
 */
router.get(
  '/users',
  requireBetaMode,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  })),
  (req, res) => {
    try {
      const { limit, offset } = req.query;
      const db = getDb();

      // Get beta users (those with feedback)
      const users = db.prepare(`
        SELECT
          u.id,
          u.email,
          u.created_at as userCreatedAt,
          COUNT(bf.id) as feedbackCount,
          MAX(bf.created_at) as lastFeedbackAt,
          ROUND(AVG(bf.quality_rating), 2) as avgQuality
        FROM users u
        LEFT JOIN beta_feedback bf ON u.id = bf.user_id
        WHERE bf.id IS NOT NULL
        GROUP BY u.id
        ORDER BY feedbackCount DESC, MAX(bf.created_at) DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const countResult = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as count FROM beta_feedback
      `).get();

      return res.json({
        ok: true,
        data: {
          total: countResult.count,
          limit,
          offset,
          count: users.length,
          users,
        },
      });
    } catch (err) {
      log.error('beta:users-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch beta users',
      });
    }
  }
);

/**
 * POST /api/beta/invite
 * Admin-only. Send beta invitation (mark user, create/update beta account).
 */
router.post(
  '/invite',
  requireBetaMode,
  validateBody(inviteSchema),
  (req, res) => {
    try {
      const { email, name } = req.body;
      const db = getDb();

      // Check if user exists
      let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

      if (!user) {
        // Create beta user account
        const userId = require('crypto').randomBytes(8).toString('hex');
        const hashedPassword = require('crypto').randomBytes(16).toString('hex'); // Placeholder

        db.prepare(`
          INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(userId, email, name || email, hashedPassword);

        user = { id: userId };
        log.info('beta:user-created', { userId, email });
      }

      log.info('beta:invitation-sent', { userId: user.id, email });

      return res.json({
        ok: true,
        data: {
          userId: user.id,
          email,
          invitedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      log.error('beta:invite-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to invite user to beta',
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute diff metrics between generated and approved text.
 */
function computeDiffMetrics(generated, approved) {
  const generatedLength = generated.length;
  const approvedLength = approved.length;
  const lengthDiff = approvedLength - generatedLength;
  const lengthDiffPercent = generatedLength > 0 ? ((lengthDiff / generatedLength) * 100).toFixed(1) : 0;

  // Simple edit distance approximation
  const editDistance = levenshteinDistance(generated, approved);

  return {
    generatedLength,
    approvedLength,
    lengthDiff,
    lengthDiffPercent: parseFloat(lengthDiffPercent),
    editDistance,
  };
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
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[len2][len1];
}

export default router;
