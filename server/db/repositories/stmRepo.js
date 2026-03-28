/**
 * server/db/repositories/stmRepo.js
 * -----------------------------------
 * Phase 20 — STM (Short-Term Memory) Normalization logging
 *
 * Centralized repository for STM normalization tracking:
 *   - Log normalization operations (regex, LLM passes, truncation)
 *   - Track preamble/postamble stripping
 *   - Aggregate statistics per user/form
 *
 * All functions are async and use DatabaseAdapter for database-agnostic operations.
 * Functions take adapter as first parameter for tenant isolation.
 */

import log from '../../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZATION LOGGING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Log a normalization operation.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {Object} entry
 * @returns {Promise<number>} log entry ID
 */
export async function logNormalization(adapter, entry) {
  if (!adapter) throw new Error('adapter is required');
  if (!entry) throw new Error('entry is required');

  const {
    sectionId,
    formType,
    originalLength,
    cleanedLength,
    regexChanges = 0,
    llmPassUsed = 0,
    preambleStripped = 0,
    postambleStripped = 0,
    truncated = 0,
    userId,
  } = entry;

  if (!sectionId || !formType) {
    throw new Error('sectionId and formType are required');
  }

  const sql = `
    INSERT INTO stm_normalization_log (
      section_id, form_type, original_length, cleaned_length,
      regex_changes, llm_pass_used, preamble_stripped, postamble_stripped,
      truncated, user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const result = await adapter.run(sql, [
      sectionId,
      formType,
      originalLength ?? null,
      cleanedLength ?? null,
      regexChanges ? 1 : 0,
      llmPassUsed ? 1 : 0,
      preambleStripped ? 1 : 0,
      postambleStripped ? 1 : 0,
      truncated ? 1 : 0,
      userId ?? null,
      now(),
    ]);
    log.info(`[STM] Logged normalization for section ${sectionId}, form ${formType}`);
    return result.lastInsertRowid;
  } catch (err) {
    log.error(`[STM] Error logging normalization: ${err.message}`);
    throw err;
  }
}

/**
 * Get aggregated statistics for a user and form type.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} userId
 * @param {string} formType
 * @returns {Promise<Object>} aggregate statistics
 */
export async function getStats(adapter, userId, formType) {
  if (!adapter) throw new Error('adapter is required');
  if (!userId || !formType) {
    throw new Error('userId and formType are required');
  }

  const sql = `
    SELECT
      COUNT(*) as total_normalizations,
      SUM(original_length) as total_original_bytes,
      SUM(cleaned_length) as total_cleaned_bytes,
      SUM(CASE WHEN regex_changes = 1 THEN 1 ELSE 0 END) as regex_operations,
      SUM(CASE WHEN llm_pass_used = 1 THEN 1 ELSE 0 END) as llm_operations,
      SUM(CASE WHEN preamble_stripped = 1 THEN 1 ELSE 0 END) as preamble_strips,
      SUM(CASE WHEN postamble_stripped = 1 THEN 1 ELSE 0 END) as postamble_strips,
      SUM(CASE WHEN truncated = 1 THEN 1 ELSE 0 END) as truncations,
      AVG(original_length) as avg_original_length,
      AVG(cleaned_length) as avg_cleaned_length
    FROM stm_normalization_log
    WHERE user_id = ? AND form_type = ?
  `;

  try {
    const row = await adapter.get(sql, [userId, formType]);
    if (!row) {
      return {
        totalNormalizations: 0,
        totalOriginalBytes: 0,
        totalCleanedBytes: 0,
        regexOperations: 0,
        llmOperations: 0,
        preambleStrips: 0,
        postambleStrips: 0,
        truncations: 0,
        avgOriginalLength: 0,
        avgCleanedLength: 0,
      };
    }

    return {
      totalNormalizations: row.total_normalizations ?? 0,
      totalOriginalBytes: row.total_original_bytes ?? 0,
      totalCleanedBytes: row.total_cleaned_bytes ?? 0,
      regexOperations: row.regex_operations ?? 0,
      llmOperations: row.llm_operations ?? 0,
      preambleStrips: row.preamble_strips ?? 0,
      postambleStrips: row.postamble_strips ?? 0,
      truncations: row.truncations ?? 0,
      avgOriginalLength: row.avg_original_length ?? 0,
      avgCleanedLength: row.avg_cleaned_length ?? 0,
    };
  } catch (err) {
    log.error(`[STM] Error fetching stats: ${err.message}`);
    throw err;
  }
}

/**
 * Get recent normalization logs for a user.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} userId
 * @param {number} limit — max number of logs to return
 * @returns {Promise<Object[]>}
 */
export async function getRecentLogs(adapter, userId, limit = 50) {
  if (!adapter) throw new Error('adapter is required');
  if (!userId) throw new Error('userId is required');

  const sql = `
    SELECT * FROM stm_normalization_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `;

  try {
    const rows = await adapter.all(sql, [userId, limit]);
    return rows.map(row => ({
      id: row.id,
      sectionId: row.section_id,
      formType: row.form_type,
      originalLength: row.original_length,
      cleanedLength: row.cleaned_length,
      regexChanges: row.regex_changes === 1,
      llmPassUsed: row.llm_pass_used === 1,
      preambleStripped: row.preamble_stripped === 1,
      postambleStripped: row.postamble_stripped === 1,
      truncated: row.truncated === 1,
      userId: row.user_id,
      createdAt: row.created_at,
    }));
  } catch (err) {
    log.error(`[STM] Error fetching recent logs: ${err.message}`);
    throw err;
  }
}

export default {
  logNormalization,
  getStats,
  getRecentLogs,
};
