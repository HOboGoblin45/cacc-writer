/**
 * server/api/enhancementRoutes.js
 * --------------------------------
 * Phase 20 — Enhancement & Diagnostic Routes
 *
 * Express Router for all /api/enhancements/* diagnostic endpoints.
 * Provides visibility into AutoTune, Voice, and STM subsystems.
 *
 * Mounted at: /api/enhancements (in cacc-writer-server.js)
 *
 * Routes:
 *   GET    /autotune/state                   — list all EMA states
 *   GET    /autotune/state/:contextKey       — get specific EMA state
 *   POST   /autotune/reset/:contextKey       — reset EMA state
 *   GET    /autotune/outcomes/:contextKey    — outcome history
 *   GET    /voice/status                     — voice embedding status
 *   GET    /voice/embeddings                 — list user embeddings
 *   GET    /stm/stats                        — STM normalization stats
 *   GET    /health                           — overall Phase 20 subsystem health
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { validateParams, validateQuery } from '../middleware/validateRequest.js';
import { getDb } from '../db/database.js';
import {
  getEmaState,
  getAllEmaStates,
  resetEmaState,
  getOutcomeHistory,
} from '../db/repositories/autoTuneRepo.js';
import {
  getEmbeddings,
  getAllEmbeddingsForUser,
  getEmbeddingCount,
} from '../db/repositories/voiceEmbeddingRepo.js';
import {
  getStats,
  getRecentLogs,
} from '../db/repositories/stmRepo.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const contextKeySchema = z.object({
  contextKey: z.string().min(1).max(255),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTOTUNE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/enhancements/autotune/state
 * List all EMA states for the current user
 */
router.get('/autotune/state', (req, res) => {
  try {
    const db = getDb();
    const states = getAllEmaStates(db);

    return res.json({
      ok: true,
      data: {
        count: states.length,
        states,
      },
    });
  } catch (err) {
    log.error(`[Enhancements] Error fetching EMA states: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch EMA states',
    });
  }
});

/**
 * GET /api/enhancements/autotune/state/:contextKey
 * Get specific EMA state by context key
 */
router.get(
  '/autotune/state/:contextKey',
  validateParams(contextKeySchema),
  (req, res) => {
    try {
      const { contextKey } = req.params;
      const db = getDb();
      const state = getEmaState(db, contextKey);

      if (!state) {
        return res.status(404).json({
          ok: false,
          error: 'EMA state not found',
        });
      }

      return res.json({
        ok: true,
        data: state,
      });
    } catch (err) {
      log.error(`[Enhancements] Error fetching EMA state: ${err.message}`);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch EMA state',
      });
    }
  }
);

/**
 * POST /api/enhancements/autotune/reset/:contextKey
 * Reset (delete) EMA state for a context
 */
router.post(
  '/autotune/reset/:contextKey',
  validateParams(contextKeySchema),
  (req, res) => {
    try {
      const { contextKey } = req.params;
      const db = getDb();
      const deleted = resetEmaState(db, contextKey);

      if (!deleted) {
        return res.status(404).json({
          ok: false,
          error: 'EMA state not found',
        });
      }

      log.info(`[Enhancements] Reset EMA state: ${contextKey}`);
      return res.json({
        ok: true,
        data: {
          contextKey,
          deleted: true,
        },
      });
    } catch (err) {
      log.error(`[Enhancements] Error resetting EMA state: ${err.message}`);
      return res.status(500).json({
        ok: false,
        error: 'Failed to reset EMA state',
      });
    }
  }
);

/**
 * GET /api/enhancements/autotune/outcomes/:contextKey
 * Get outcome history for a context
 */
router.get(
  '/autotune/outcomes/:contextKey',
  validateParams(contextKeySchema),
  validateQuery(limitQuerySchema),
  (req, res) => {
    try {
      const { contextKey } = req.params;
      const { limit } = req.query;
      const db = getDb();
      const outcomes = getOutcomeHistory(db, contextKey, limit);

      return res.json({
        ok: true,
        data: {
          contextKey,
          count: outcomes.length,
          outcomes,
        },
      });
    } catch (err) {
      log.error(`[Enhancements] Error fetching outcome history: ${err.message}`);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch outcome history',
      });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// VOICE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/enhancements/voice/status
 * Get voice reference embedding status for current user
 */
router.get('/voice/status', (req, res) => {
  try {
    // Extract userId from JWT or session (assuming middleware sets req.userId)
    const userId = req.userId || 'anonymous';
    const db = getDb();

    // Get counts for common form types
    const formTypes = ['1004', '1025', '1073'];
    const counts = {};

    for (const formType of formTypes) {
      counts[formType] = getEmbeddingCount(db, userId, formType);
    }

    const totalEmbeddings = Object.values(counts).reduce((a, b) => a + b, 0);

    return res.json({
      ok: true,
      data: {
        userId,
        totalEmbeddings,
        byFormType: counts,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error(`[Enhancements] Error getting voice status: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to get voice status',
    });
  }
});

/**
 * GET /api/enhancements/voice/embeddings
 * List stored embeddings for current user
 */
router.get('/voice/embeddings', validateQuery(z.object({
  formType: z.string().optional(),
})), (req, res) => {
  try {
    const userId = req.userId || 'anonymous';
    const { formType } = req.query;
    const db = getDb();

    if (!formType) {
      return res.status(400).json({
        ok: false,
        error: 'formType query parameter is required',
      });
    }

    const embeddings = getAllEmbeddingsForUser(db, userId, formType);

    return res.json({
      ok: true,
      data: {
        userId,
        formType,
        count: embeddings.length,
        embeddings,
      },
    });
  } catch (err) {
    log.error(`[Enhancements] Error fetching embeddings: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch embeddings',
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STM ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/enhancements/stm/stats
 * Get STM normalization aggregate statistics
 */
router.get('/stm/stats', validateQuery(z.object({
  formType: z.string().optional(),
})), (req, res) => {
  try {
    const userId = req.userId || 'anonymous';
    const { formType } = req.query;
    const db = getDb();

    if (!formType) {
      return res.status(400).json({
        ok: false,
        error: 'formType query parameter is required',
      });
    }

    const stats = getStats(db, userId, formType);
    const recentLogs = getRecentLogs(db, userId, 20);

    return res.json({
      ok: true,
      data: {
        userId,
        formType,
        stats,
        recentLogs,
      },
    });
  } catch (err) {
    log.error(`[Enhancements] Error fetching STM stats: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch STM statistics',
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/enhancements/health
 * Overall Phase 20 subsystem health check
 */
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const checkedAt = new Date().toISOString();

    // Check if tables exist by attempting basic queries
    const autotuneCheck = (() => {
      try {
        const count = db.prepare('SELECT COUNT(*) as count FROM autotune_ema_state').get();
        return { ok: true, count: count.count };
      } catch {
        return { ok: false, error: 'autotune_ema_state table check failed' };
      }
    })();

    const voiceCheck = (() => {
      try {
        const count = db.prepare('SELECT COUNT(*) as count FROM voice_reference_embeddings').get();
        return { ok: true, count: count.count };
      } catch {
        return { ok: false, error: 'voice_reference_embeddings table check failed' };
      }
    })();

    const stmCheck = (() => {
      try {
        const count = db.prepare('SELECT COUNT(*) as count FROM stm_normalization_log').get();
        return { ok: true, count: count.count };
      } catch {
        return { ok: false, error: 'stm_normalization_log table check failed' };
      }
    })();

    const allOk = autotuneCheck.ok && voiceCheck.ok && stmCheck.ok;

    return res.json({
      ok: allOk,
      data: {
        status: allOk ? 'healthy' : 'degraded',
        checkedAt,
        subsystems: {
          autotune: autotuneCheck,
          voice: voiceCheck,
          stm: stmCheck,
        },
      },
    });
  } catch (err) {
    log.error(`[Enhancements] Error during health check: ${err.message}`);
    return res.status(500).json({
      ok: false,
      data: {
        status: 'error',
        error: 'Health check failed',
        checkedAt: new Date().toISOString(),
      },
    });
  }
});

export default router;
