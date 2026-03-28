/**
 * server/api/referralRoutes.js
 * ────────────────────────────────────────────────────────────────────────────
 * Referral Program Management — Wave 1 GTM
 *
 * Routes:
 *   POST   /api/referrals/generate      — Generate unique referral code (authenticated)
 *   GET    /api/referrals/stats         — Get user's referral stats (authenticated)
 *   POST   /api/referrals/track         — Track referral click (public)
 *   POST   /api/referrals/convert       — Mark referral as converted (internal)
 *
 * Referral code format: RB-{userId_short}-{random6}
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { getDb } from '../db/database.js';
import { validateBody, validateQuery } from '../middleware/validateRequest.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const trackReferralSchema = z.object({
  code: z.string().min(5).max(50),
  refererEmail: z.string().email().optional(),
});

const convertReferralSchema = z.object({
  code: z.string().min(5).max(50),
  newUserId: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique referral code for a user.
 * Format: RB-{userId_short}-{random6}
 */
function generateReferralCode(userId) {
  const userIdShort = userId.substring(0, 6).toUpperCase();
  const randomPart = require('crypto')
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()
    .substring(0, 6);

  return `RB-${userIdShort}-${randomPart}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/referrals/generate
 * Generate unique referral code for authenticated user.
 */
router.post('/generate', (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required',
      });
    }

    const db = getDb();

    // Check if user already has a code
    let existing = db.prepare('SELECT id, code FROM referral_codes WHERE user_id = ?').get(userId);

    if (existing) {
      return res.json({
        ok: true,
        data: {
          code: existing.code,
          generatedAt: null, // Already existed
          isNew: false,
        },
      });
    }

    // Generate new code
    let code = generateReferralCode(userId);

    // Ensure uniqueness by retrying if collision
    let attempts = 0;
    while (db.prepare('SELECT id FROM referral_codes WHERE code = ?').get(code) && attempts < 10) {
      code = generateReferralCode(userId);
      attempts++;
    }

    if (attempts >= 10) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate unique referral code',
      });
    }

    // Insert new code
    const id = require('crypto').randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO referral_codes (id, user_id, code)
      VALUES (?, ?, ?)
    `).run(id, userId, code);

    log.info('referral:code-generated', { userId, code });

    return res.status(201).json({
      ok: true,
      data: {
        code,
        generatedAt: new Date().toISOString(),
        isNew: true,
        referralUrl: `${process.env.APP_URL || 'https://appraisal-agent.com'}?ref=${code}`,
      },
    });
  } catch (err) {
    log.error('referral:generate-failed', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to generate referral code',
    });
  }
});

/**
 * GET /api/referrals/stats
 * Get user's referral stats (authenticated).
 */
router.get('/stats', (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required',
      });
    }

    const db = getDb();

    // Get user's referral code
    const codeRow = db.prepare('SELECT id, code FROM referral_codes WHERE user_id = ?').get(userId);

    if (!codeRow) {
      return res.json({
        ok: true,
        data: {
          code: null,
          stats: {
            clicks: 0,
            conversions: 0,
            rewardApplied: 0,
            clickRate: 0,
            conversionRate: 0,
          },
        },
      });
    }

    // Get tracking stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as clicks,
        COUNT(CASE WHEN converted_at IS NOT NULL THEN 1 END) as conversions,
        COUNT(CASE WHEN reward_applied = 1 THEN 1 END) as rewardApplied
      FROM referral_tracking
      WHERE referral_code_id = ?
    `).get(codeRow.id);

    const clickRate = stats.clicks > 0 ? (stats.conversions / stats.clicks).toFixed(3) : 0;
    const conversionRate = stats.clicks > 0 ? ((stats.conversions / stats.clicks) * 100).toFixed(1) : 0;

    log.info('referral:stats-fetched', { userId, code: codeRow.code });

    return res.json({
      ok: true,
      data: {
        code: codeRow.code,
        stats: {
          clicks: stats.clicks,
          conversions: stats.conversions,
          rewardApplied: stats.rewardApplied,
          clickRate: parseFloat(clickRate),
          conversionRate: parseFloat(conversionRate),
        },
      },
    });
  } catch (err) {
    log.error('referral:stats-failed', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch referral stats',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/referrals/track
 * Track referral click (public, no auth required).
 */
router.post(
  '/track',
  validateBody(trackReferralSchema),
  (req, res) => {
    try {
      const { code, refererEmail } = req.body;
      const db = getDb();

      // Find referral code
      const codeRow = db.prepare('SELECT id FROM referral_codes WHERE code = ?').get(code);

      if (!codeRow) {
        return res.status(404).json({
          ok: false,
          error: 'Referral code not found',
        });
      }

      // Record click
      const id = require('crypto').randomBytes(8).toString('hex');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO referral_tracking (id, referral_code_id, referee_email, clicked_at)
        VALUES (?, ?, ?, ?)
      `).run(id, codeRow.id, refererEmail || null, now);

      log.info('referral:click-tracked', { code, refererEmail });

      return res.json({
        ok: true,
        data: {
          trackingId: id,
          code,
          trackedAt: now,
        },
      });
    } catch (err) {
      log.error('referral:track-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to track referral',
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/referrals/convert
 * Internal: Mark referral as converted when referee subscribes.
 * Called from billing/subscription flow.
 */
router.post(
  '/convert',
  validateBody(convertReferralSchema),
  (req, res) => {
    try {
      const { code, newUserId } = req.body;
      const db = getDb();

      // Find referral code
      const codeRow = db.prepare('SELECT id FROM referral_codes WHERE code = ?').get(code);

      if (!codeRow) {
        return res.status(404).json({
          ok: false,
          error: 'Referral code not found',
        });
      }

      const now = new Date().toISOString();

      // Mark most recent tracking entry as converted
      db.prepare(`
        UPDATE referral_tracking
        SET converted_at = ?
        WHERE referral_code_id = ?
        AND converted_at IS NULL
        AND referee_email = (
          SELECT email FROM users WHERE id = ?
        )
        ORDER BY clicked_at DESC
        LIMIT 1
      `).run(now, codeRow.id, newUserId);

      // Get referrer user ID for reward logic
      const referrer = db.prepare('SELECT user_id FROM referral_codes WHERE id = ?').get(codeRow.id);

      log.info('referral:converted', {
        code,
        referrerId: referrer.user_id,
        newUserId,
      });

      return res.json({
        ok: true,
        data: {
          code,
          referrerId: referrer.user_id,
          newUserId,
          convertedAt: now,
        },
      });
    } catch (err) {
      log.error('referral:convert-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to mark referral as converted',
      });
    }
  }
);

export default router;
