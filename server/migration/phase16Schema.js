/**
 * server/migration/phase16Schema.js
 * -----------------------------------
 * Phase 16 — Contradiction resolution persistence.
 * Moves resolution state from provenance JSON into a queryable DB table.
 */
import log from '../logger.js';

export function initPhase16Schema(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS contradiction_resolutions (
        id                TEXT PRIMARY KEY,
        case_id           TEXT NOT NULL,
        contradiction_id  TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'open',
        actor             TEXT NOT NULL DEFAULT 'appraiser',
        note              TEXT DEFAULT '',
        reason            TEXT DEFAULT '',
        history_json      TEXT NOT NULL DEFAULT '[]',
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contradiction_resolutions_case_contradiction
        ON contradiction_resolutions(case_id, contradiction_id);
      CREATE INDEX IF NOT EXISTS idx_contradiction_resolutions_case_status
        ON contradiction_resolutions(case_id, status);
    `);
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      log.error('schema:phase16-init', { error: err.message });
    }
  }
}
