/**
 * server/db/repositories/voiceEmbeddingRepo.js
 * -----------------------------------------------
 * Phase 20 — Voice Reference Embeddings persistence
 *
 * Centralized repository for voice reference embedding operations:
 *   - Store embeddings for voice narrative matching
 *   - Retrieve embeddings per user/form/section
 *   - Manage embedding lifecycle
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
// VOICE EMBEDDING CRUD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Store an embedding for voice reference matching.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {Object} params
 * @returns {Promise<number>} embedding ID
 */
export async function storeEmbedding(adapter, params) {
  if (!adapter) throw new Error('adapter is required');
  if (!params) throw new Error('params is required');

  const {
    userId,
    formType,
    sectionId,
    textHash,
    embeddingJson,
    source = 'approved_narrative',
  } = params;

  if (!userId || !formType || !sectionId || !textHash || !embeddingJson) {
    throw new Error('userId, formType, sectionId, textHash, and embeddingJson are required');
  }

  const sql = `
    INSERT INTO voice_reference_embeddings (
      user_id, form_type, section_id, text_hash, embedding_json, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, form_type, section_id, text_hash)
    DO UPDATE SET
      embedding_json = excluded.embedding_json,
      source = excluded.source
  `;

  try {
    const result = await adapter.run(sql, [
      userId,
      formType,
      sectionId,
      textHash,
      embeddingJson,
      source,
      now(),
    ]);
    log.info(
      `[VoiceEmbedding] Stored embedding for user ${userId}, form ${formType}, section ${sectionId}`
    );
    return result.lastInsertRowid;
  } catch (err) {
    log.error(`[VoiceEmbedding] Error storing embedding: ${err.message}`);
    throw err;
  }
}

/**
 * Get embeddings for a user/form/section combination.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} userId
 * @param {string} formType
 * @param {string} sectionId
 * @returns {Promise<Object[]>}
 */
export async function getEmbeddings(adapter, userId, formType, sectionId) {
  if (!adapter) throw new Error('adapter is required');
  if (!userId || !formType || !sectionId) {
    throw new Error('userId, formType, and sectionId are required');
  }

  const sql = `
    SELECT * FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ? AND section_id = ?
    ORDER BY created_at DESC
  `;

  try {
    const rows = await adapter.all(sql, [userId, formType, sectionId]);
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      formType: row.form_type,
      sectionId: row.section_id,
      textHash: row.text_hash,
      embeddingJson: row.embedding_json,
      source: row.source,
      createdAt: row.created_at,
    }));
  } catch (err) {
    log.error(`[VoiceEmbedding] Error fetching embeddings: ${err.message}`);
    throw err;
  }
}

/**
 * Get all embeddings for a user/form combination.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} userId
 * @param {string} formType
 * @returns {Promise<Object[]>}
 */
export async function getAllEmbeddingsForUser(adapter, userId, formType) {
  if (!adapter) throw new Error('adapter is required');
  if (!userId || !formType) {
    throw new Error('userId and formType are required');
  }

  const sql = `
    SELECT * FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ?
    ORDER BY section_id, created_at DESC
  `;

  try {
    const rows = await adapter.all(sql, [userId, formType]);
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      formType: row.form_type,
      sectionId: row.section_id,
      textHash: row.text_hash,
      embeddingJson: row.embedding_json,
      source: row.source,
      createdAt: row.created_at,
    }));
  } catch (err) {
    log.error(`[VoiceEmbedding] Error fetching all embeddings: ${err.message}`);
    throw err;
  }
}

/**
 * Delete an embedding by ID.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {number} id
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function deleteEmbedding(adapter, id) {
  if (!adapter) throw new Error('adapter is required');
  if (!id) throw new Error('id is required');

  const sql = `DELETE FROM voice_reference_embeddings WHERE id = ?`;

  try {
    const result = await adapter.run(sql, [id]);
    const deleted = result.changes > 0;
    if (deleted) {
      log.info(`[VoiceEmbedding] Deleted embedding ID ${id}`);
    }
    return deleted;
  } catch (err) {
    log.error(`[VoiceEmbedding] Error deleting embedding: ${err.message}`);
    throw err;
  }
}

/**
 * Get embedding count for a user/form combination.
 *
 * @async
 * @param {DatabaseAdapter} adapter
 * @param {string} userId
 * @param {string} formType
 * @returns {Promise<number>}
 */
export async function getEmbeddingCount(adapter, userId, formType) {
  if (!adapter) throw new Error('adapter is required');
  if (!userId || !formType) {
    throw new Error('userId and formType are required');
  }

  const sql = `
    SELECT COUNT(*) as count FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ?
  `;

  try {
    const row = await adapter.get(sql, [userId, formType]);
    return row?.count ?? 0;
  } catch (err) {
    log.error(`[VoiceEmbedding] Error getting embedding count: ${err.message}`);
    throw err;
  }
}

export default {
  storeEmbedding,
  getEmbeddings,
  getAllEmbeddingsForUser,
  deleteEmbedding,
  getEmbeddingCount,
};
