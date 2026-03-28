/**
 * server/migration/phase18Schema.js
 * -----------------------------------
 * Phase 18 — Controlled Learning Loop tables.
 *
 * Schema additions:
 *   - revision_diffs       — captures diff between AI draft and final appraiser text
 *   - suggestion_outcomes  — records suggestion acceptance/rejection/modification
 */
import log from '../logger.js';

/**
 * Create Phase 18 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase18Schema(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS revision_diffs (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        draft_text TEXT,
        final_text TEXT,
        diff_json TEXT NOT NULL DEFAULT '{}',
        change_ratio REAL NOT NULL DEFAULT 0,
        form_type TEXT,
        property_type TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_revision_diffs_case ON revision_diffs(case_id);
      CREATE INDEX IF NOT EXISTS idx_revision_diffs_section ON revision_diffs(case_id, section_id);

      CREATE TABLE IF NOT EXISTS suggestion_outcomes (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        suggestion_id TEXT,
        section_id TEXT NOT NULL,
        suggestion_type TEXT NOT NULL DEFAULT 'narrative',
        original_text TEXT,
        suggested_text TEXT,
        final_text TEXT,
        accepted INTEGER NOT NULL DEFAULT 0,
        modified INTEGER NOT NULL DEFAULT 0,
        rejection_reason TEXT,
        form_type TEXT,
        property_type TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_suggestion_outcomes_case ON suggestion_outcomes(case_id);
      CREATE INDEX IF NOT EXISTS idx_suggestion_outcomes_section ON suggestion_outcomes(section_id, form_type);
      CREATE INDEX IF NOT EXISTS idx_suggestion_outcomes_type ON suggestion_outcomes(suggestion_type, accepted);
    `);
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      log.error('schema:phase18-init', { error: err.message });
    }
  }
}
