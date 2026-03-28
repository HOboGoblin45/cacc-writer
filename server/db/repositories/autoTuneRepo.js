/**
 * server/db/repositories/autoTuneRepo.js
 * ----------------------------------------
 * Phase 20 — AutoTune EMA state and outcome tracking
 *
 * Centralized repository for all auto-tuning SQLite operations:
 *   - autotune_ema_state CRUD (exponential moving average state per context)
 *   - autotune_outcomes logging (quality feedback for tuning)
 *
 * All functions are synchronous (better-sqlite3).
 * Functions take db as first parameter for tenant isolation.
 */

import log from '../../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function toJSON(val) {
  if (val === null || val === undefined) return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function now() {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════════════════════════════════════
// EMA STATE CRUD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Upsert EMA state for a context key.
 * Creates or updates the exponential moving average tuning state.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextKey — unique context identifier
 * @param {Object} state — EMA state data
 * @returns {string} context_key
 */
export function upsertEmaState(db, contextKey, state) {
  if (!db) throw new Error('db is required');
  if (!contextKey) throw new Error('contextKey is required');
  if (!state) throw new Error('state is required');

  const {
    formType,
    sectionId,
    avgScore = 0.5,
    avgTokensUsed = 500,
    optimalTemperature = 0.7,
    optimalMaxTokens = 1000,
    optimalTopP = 0.9,
    sampleCount = 0,
    alpha = 0.3,
  } = state;

  if (!formType || !sectionId) {
    throw new Error('formType and sectionId are required in state');
  }

  const statement = db.prepare(`
    INSERT INTO autotune_ema_state (
      context_key, form_type, section_id, avg_score, avg_tokens_used,
      optimal_temperature, optimal_max_tokens, optimal_top_p, sample_count,
      alpha, last_updated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(context_key) DO UPDATE SET
      avg_score = excluded.avg_score,
      avg_tokens_used = excluded.avg_tokens_used,
      optimal_temperature = excluded.optimal_temperature,
      optimal_max_tokens = excluded.optimal_max_tokens,
      optimal_top_p = excluded.optimal_top_p,
      sample_count = excluded.sample_count,
      alpha = excluded.alpha,
      last_updated = excluded.last_updated
  `);

  try {
    statement.run(
      contextKey,
      formType,
      sectionId,
      avgScore,
      avgTokensUsed,
      optimalTemperature,
      optimalMaxTokens,
      optimalTopP,
      sampleCount,
      alpha,
      now(),
      now()
    );
    log.info(`[AutoTune] Upserted EMA state for context: ${contextKey}`);
    return contextKey;
  } catch (err) {
    log.error(`[AutoTune] Error upserting EMA state: ${err.message}`);
    throw err;
  }
}

/**
 * Get EMA state for a context key.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextKey
 * @returns {Object|null}
 */
export function getEmaState(db, contextKey) {
  if (!db) throw new Error('db is required');
  if (!contextKey) throw new Error('contextKey is required');

  const statement = db.prepare(`
    SELECT * FROM autotune_ema_state WHERE context_key = ?
  `);

  try {
    const row = statement.get(contextKey);
    if (!row) return null;

    return {
      id: row.id,
      contextKey: row.context_key,
      formType: row.form_type,
      sectionId: row.section_id,
      avgScore: row.avg_score,
      avgTokensUsed: row.avg_tokens_used,
      optimalTemperature: row.optimal_temperature,
      optimalMaxTokens: row.optimal_max_tokens,
      optimalTopP: row.optimal_top_p,
      sampleCount: row.sample_count,
      alpha: row.alpha,
      lastUpdated: row.last_updated,
      createdAt: row.created_at,
    };
  } catch (err) {
    log.error(`[AutoTune] Error fetching EMA state: ${err.message}`);
    throw err;
  }
}

/**
 * Get all EMA states.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Object[]}
 */
export function getAllEmaStates(db) {
  if (!db) throw new Error('db is required');

  const statement = db.prepare(`
    SELECT * FROM autotune_ema_state ORDER BY created_at DESC
  `);

  try {
    const rows = statement.all();
    return rows.map(row => ({
      id: row.id,
      contextKey: row.context_key,
      formType: row.form_type,
      sectionId: row.section_id,
      avgScore: row.avg_score,
      avgTokensUsed: row.avg_tokens_used,
      optimalTemperature: row.optimal_temperature,
      optimalMaxTokens: row.optimal_max_tokens,
      optimalTopP: row.optimal_top_p,
      sampleCount: row.sample_count,
      alpha: row.alpha,
      lastUpdated: row.last_updated,
      createdAt: row.created_at,
    }));
  } catch (err) {
    log.error(`[AutoTune] Error fetching all EMA states: ${err.message}`);
    throw err;
  }
}

/**
 * Reset EMA state for a context key (delete it).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextKey
 * @returns {boolean} true if deleted, false if not found
 */
export function resetEmaState(db, contextKey) {
  if (!db) throw new Error('db is required');
  if (!contextKey) throw new Error('contextKey is required');

  const statement = db.prepare(`
    DELETE FROM autotune_ema_state WHERE context_key = ?
  `);

  try {
    const result = statement.run(contextKey);
    const deleted = result.changes > 0;
    if (deleted) {
      log.info(`[AutoTune] Reset EMA state for context: ${contextKey}`);
    }
    return deleted;
  } catch (err) {
    log.error(`[AutoTune] Error resetting EMA state: ${err.message}`);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// OUTCOME LOGGING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Record an outcome for auto-tuning feedback.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} outcome
 * @returns {number} outcome ID
 */
export function recordOutcome(db, outcome) {
  if (!db) throw new Error('db is required');
  if (!outcome) throw new Error('outcome is required');

  const {
    contextKey,
    sectionId,
    formType,
    qualityScore,
    tokensUsed,
    wasApproved = 0,
    temperatureUsed,
    maxTokensUsed,
    userId,
  } = outcome;

  if (!contextKey || !sectionId || !formType) {
    throw new Error('contextKey, sectionId, and formType are required');
  }

  const statement = db.prepare(`
    INSERT INTO autotune_outcomes (
      context_key, section_id, form_type, quality_score, tokens_used,
      was_approved, temperature_used, max_tokens_used, user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const result = statement.run(
      contextKey,
      sectionId,
      formType,
      qualityScore ?? null,
      tokensUsed ?? null,
      wasApproved ? 1 : 0,
      temperatureUsed ?? null,
      maxTokensUsed ?? null,
      userId ?? null,
      now()
    );
    log.info(`[AutoTune] Recorded outcome for context: ${contextKey}`);
    return result.lastInsertRowid;
  } catch (err) {
    log.error(`[AutoTune] Error recording outcome: ${err.message}`);
    throw err;
  }
}

/**
 * Get outcome history for a context key.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} contextKey
 * @param {number} limit — max number of outcomes to return
 * @returns {Object[]}
 */
export function getOutcomeHistory(db, contextKey, limit = 100) {
  if (!db) throw new Error('db is required');
  if (!contextKey) throw new Error('contextKey is required');

  const statement = db.prepare(`
    SELECT * FROM autotune_outcomes
    WHERE context_key = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  try {
    const rows = statement.all(contextKey, limit);
    return rows.map(row => ({
      id: row.id,
      contextKey: row.context_key,
      sectionId: row.section_id,
      formType: row.form_type,
      qualityScore: row.quality_score,
      tokensUsed: row.tokens_used,
      wasApproved: row.was_approved === 1,
      temperatureUsed: row.temperature_used,
      maxTokensUsed: row.max_tokens_used,
      userId: row.user_id,
      createdAt: row.created_at,
    }));
  } catch (err) {
    log.error(`[AutoTune] Error fetching outcome history: ${err.message}`);
    throw err;
  }
}

/**
 * Delete outcomes older than a specified number of days.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} daysOld — delete outcomes older than this
 * @returns {number} number of rows deleted
 */
export function deleteOldOutcomes(db, daysOld = 90) {
  if (!db) throw new Error('db is required');
  if (daysOld < 1) throw new Error('daysOld must be >= 1');

  const statement = db.prepare(`
    DELETE FROM autotune_outcomes
    WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
  `);

  try {
    const result = statement.run(daysOld);
    log.info(`[AutoTune] Deleted ${result.changes} outcomes older than ${daysOld} days`);
    return result.changes;
  } catch (err) {
    log.error(`[AutoTune] Error deleting old outcomes: ${err.message}`);
    throw err;
  }
}

export default {
  upsertEmaState,
  getEmaState,
  getAllEmaStates,
  recordOutcome,
  getOutcomeHistory,
  resetEmaState,
  deleteOldOutcomes,
};
