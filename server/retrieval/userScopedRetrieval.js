/**
 * server/retrieval/userScopedRetrieval.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-user knowledge base scoping for multi-tenant voice isolation.
 *
 * Each user's approved sections are stored with their userId.
 * When generating, we retrieve from:
 *   1. The user's own approved narratives (highest weight — THEIR voice)
 *   2. The shared/global knowledge base (lower weight — general quality)
 *
 * This is the key to "it molds to each user" — each appraiser's AI
 * improves based on THEIR approved work, not everyone else's.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

/**
 * Save an approved section to the user's personal KB.
 * Called when a user approves a generated section.
 *
 * @param {string} userId
 * @param {object} params
 */
export function saveUserApprovedSection(userId, { caseId, fieldId, formType, text, propertyType, marketType, county, city }) {
  const db = getDb();

  // Ensure user_approved_sections table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_approved_sections (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      case_id     TEXT,
      field_id    TEXT NOT NULL,
      form_type   TEXT NOT NULL,
      text        TEXT NOT NULL,
      property_type TEXT,
      market_type TEXT,
      county      TEXT,
      city        TEXT,
      char_count  INTEGER,
      word_count  INTEGER,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, case_id, field_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_approved_sections_user
      ON user_approved_sections(user_id, form_type, field_id);
  `);

  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).length;

  db.prepare(`
    INSERT OR REPLACE INTO user_approved_sections
      (user_id, case_id, field_id, form_type, text, property_type, market_type, county, city, char_count, word_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, caseId, fieldId, formType, text, propertyType || null, marketType || null, county || null, city || null, charCount, wordCount);

  // Update user KB stats
  const count = db.prepare('SELECT COUNT(*) as c FROM user_approved_sections WHERE user_id = ?').get(userId);
  db.prepare(`
    INSERT INTO user_kb_config (user_id, kb_directory, examples_count, created_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET examples_count = ?, created_at = created_at
  `).run(userId, `knowledge_base/users/${userId}`, count.c, count.c);

  log.info('user-kb:save', { userId, fieldId, formType, charCount, wordCount });
}

/**
 * Retrieve user-specific approved examples for a given field.
 * Returns the user's own approved narratives, sorted by relevance.
 *
 * @param {string} userId
 * @param {object} params
 * @returns {Array<{text: string, formType: string, fieldId: string, ...}>}
 */
export function getUserApprovedExamples(userId, { fieldId, formType, limit = 5 }) {
  const db = getDb();

  // Check if table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_approved_sections'").get();
  if (!tableExists) return [];

  // Priority order: exact form+field match, then field-only match
  const exact = db.prepare(`
    SELECT * FROM user_approved_sections
    WHERE user_id = ? AND field_id = ? AND form_type = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, fieldId, formType, limit);

  if (exact.length >= limit) return exact;

  // Fill remaining with field-only matches from other form types
  const remaining = limit - exact.length;
  const crossForm = db.prepare(`
    SELECT * FROM user_approved_sections
    WHERE user_id = ? AND field_id = ? AND form_type != ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, fieldId, formType, remaining);

  return [...exact, ...crossForm];
}

/**
 * Get user KB statistics.
 */
export function getUserKbStats(userId) {
  const db = getDb();

  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_approved_sections'").get();
  if (!tableExists) return { totalExamples: 0, byFormType: {}, byField: {} };

  const total = db.prepare('SELECT COUNT(*) as c FROM user_approved_sections WHERE user_id = ?').get(userId);

  const byFormType = db.prepare(`
    SELECT form_type, COUNT(*) as count
    FROM user_approved_sections WHERE user_id = ?
    GROUP BY form_type
  `).all(userId);

  const byField = db.prepare(`
    SELECT field_id, COUNT(*) as count
    FROM user_approved_sections WHERE user_id = ?
    GROUP BY field_id ORDER BY count DESC LIMIT 20
  `).all(userId);

  return {
    totalExamples: total.c,
    byFormType: Object.fromEntries(byFormType.map(r => [r.form_type, r.count])),
    byField: Object.fromEntries(byField.map(r => [r.field_id, r.count])),
  };
}
