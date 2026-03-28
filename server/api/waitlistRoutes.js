/**
 * server/api/waitlistRoutes.js
 * ────────────────────────────────────────────────────────────────────────────
 * Waitlist Management — Wave 1 GTM
 *
 * Routes:
 *   POST   /api/waitlist               — Add to waitlist (public)
 *   GET    /api/waitlist/count         — Get waitlist count (public)
 *   GET    /api/waitlist               — List all entries (admin-only)
 *   POST   /api/waitlist/:id/invite    — Mark as beta-invited (admin)
 *   DELETE /api/waitlist/:id           — Remove entry (admin)
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { getDb } from '../db/database.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const addToWaitlistSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1).max(255).optional(),
  state: z.string().max(50).optional(),
  licenseType: z.enum(['certified', 'trainee', 'other']).optional(),
  currentSoftware: z.enum(['ACI', 'TOTAL', 'Real Quantum', 'Other']).optional(),
  referralSource: z.enum(['search', 'social', 'email', 'referral', 'other']).optional(),
});

const idParamSchema = z.object({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  state: z.string().optional(),
  converted: z.enum(['true', 'false']).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/waitlist
 * Add email to waitlist. Validates email format and prevents duplicates.
 */
router.post('/', validateBody(addToWaitlistSchema), (req, res) => {
  try {
    const {
      email,
      name,
      state,
      licenseType,
      currentSoftware,
      referralSource,
    } = req.body;

    const db = getDb();

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM waitlist WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: 'Email already on waitlist',
        id: existing.id,
      });
    }

    // Insert new waitlist entry
    const id = require('crypto').randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO waitlist (id, email, name, state, license_type, current_software, referral_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, name || null, state || null, licenseType || null, currentSoftware || null, referralSource || null);

    log.info('waitlist:added', { email, id });

    return res.status(201).json({
      ok: true,
      data: {
        id,
        email,
        addedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error('waitlist:add-failed', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to add to waitlist',
    });
  }
});

/**
 * GET /api/waitlist/count
 * Public endpoint returning total waitlist count (for social proof).
 */
router.get('/count', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM waitlist').get();

    return res.json({
      ok: true,
      data: {
        count: result.count,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error('waitlist:count-failed', { error: err.message });
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch waitlist count',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES (require authentication)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/waitlist
 * Admin-only. List all waitlist entries with pagination/filtering.
 */
router.get(
  '/',
  validateQuery(listQuerySchema),
  (req, res) => {
    try {
      const { limit, offset, state, converted } = req.query;
      const db = getDb();

      // Build WHERE clause
      let whereClause = '1=1';
      const params = [];

      if (state) {
        whereClause += ' AND state = ?';
        params.push(state);
      }

      if (converted === 'true') {
        whereClause += ' AND converted_at IS NOT NULL';
      } else if (converted === 'false') {
        whereClause += ' AND converted_at IS NULL';
      }

      // Get total count
      const countQuery = `SELECT COUNT(*) as count FROM waitlist WHERE ${whereClause}`;
      const countResult = db.prepare(countQuery).get(...params);
      const total = countResult.count;

      // Get paginated results
      const query = `
        SELECT * FROM waitlist
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      const entries = db.prepare(query).all(...params, limit, offset);

      return res.json({
        ok: true,
        data: {
          total,
          limit,
          offset,
          count: entries.length,
          entries,
        },
      });
    } catch (err) {
      log.error('waitlist:list-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch waitlist',
      });
    }
  }
);

/**
 * POST /api/waitlist/:id/invite
 * Admin. Mark entry as beta-invited and set beta_invited_at timestamp.
 */
router.post(
  '/:id/invite',
  validateParams(idParamSchema),
  (req, res) => {
    try {
      const { id } = req.params;
      const db = getDb();

      // Check if entry exists
      const entry = db.prepare('SELECT id, email FROM waitlist WHERE id = ?').get(id);
      if (!entry) {
        return res.status(404).json({
          ok: false,
          error: 'Waitlist entry not found',
        });
      }

      // Update with beta_invited_at timestamp
      db.prepare(`
        UPDATE waitlist SET beta_invited_at = datetime('now') WHERE id = ?
      `).run(id);

      log.info('waitlist:beta-invited', { id, email: entry.email });

      return res.json({
        ok: true,
        data: {
          id,
          email: entry.email,
          betaInvitedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      log.error('waitlist:invite-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to invite user to beta',
      });
    }
  }
);

/**
 * DELETE /api/waitlist/:id
 * Admin. Remove entry from waitlist.
 */
router.delete(
  '/:id',
  validateParams(idParamSchema),
  (req, res) => {
    try {
      const { id } = req.params;
      const db = getDb();

      const result = db.prepare('DELETE FROM waitlist WHERE id = ?').run(id);

      if (result.changes === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Waitlist entry not found',
        });
      }

      log.info('waitlist:deleted', { id });

      return res.json({
        ok: true,
        data: {
          id,
          deleted: true,
        },
      });
    } catch (err) {
      log.error('waitlist:delete-failed', { error: err.message });
      return res.status(500).json({
        ok: false,
        error: 'Failed to delete waitlist entry',
      });
    }
  }
);

export default router;
