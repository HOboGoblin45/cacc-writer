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
 * All functions are synchronous (better-sqlite3).
 * Functions take db as first parameter for tenant isolation.
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
 * @param {import('better-sqlite3').Database} db
 * @param {Object} params
 * @returns {number} embedding ID
 */
export function storeEmbedding(db, params) {
  if (!db) throw new Error('db is required');
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

  const statement = db.prepare(`
    INSERT INTO voice_reference_embeddings (
      user_id, form_type, section_id, text_hash, embedding_json, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, form_type, section_id, text_hash)
    DO UPDATE SET
      embedding_json = excluded.embedding_json,
      source = excluded.source
  `);

  try {
    const result = statement.run(
      userId,
      formType,
      sectionId,
      textHash,
      embeddingJson,
      source,
      now()
    );
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} formType
 * @param {string} sectionId
 * @returns {Object[]}
 */
export function getEmbeddings(db, userId, formType, sectionId) {
  if (!db) throw new Error('db is required');
  if (!userId || !formType || !sectionId) {
    throw new Error('userId, formType, and sectionId are required');
  }

  const statement = db.prepare(`
    SELECT * FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ? AND section_id = ?
    ORDER BY created_at DESC
  `);

  try {
    const rows = statement.all(userId, formType, sectionId);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} formType
 * @returns {Object[]}
 */
export function getAllEmbeddingsForUser(db, userId, formType) {
  if (!db) throw new Error('db is required');
  if (!userId || !formType) {
    throw new Error('userId and formType are required');
  }

  const statement = db.prepare(`
    SELECT * FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ?
    ORDER BY section_id, created_at DESC
  `);

  try {
    const rows = statement.all(userId, formType);
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
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {boolean} true if deleted, false if not found
 */
export function deleteEmbedding(db, id) {
  if (!db) throw new Error('db is required');
  if (!id) throw new Error('id is required');

  const statement = db.prepare(`
    DELETE FROM voice_reference_embeddings WHERE id = ?
  `);

  try {
    const result = statement.run(id);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} formType
 * @returns {number}
 */
export function getEmbeddingCount(db, userId, formType) {
  if (!db) throw new Error('db is required');
  if (!userId || !formType) {
    throw new Error('userId and formType are required');
  }

  const statement = db.prepare(`
    SELECT COUNT(*) as count FROM voice_reference_embeddings
    WHERE user_id = ? AND form_type = ?
  `);

  try {
    const row = statement.get(userId, formType);
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
