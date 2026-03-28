/**
 * server/migration/phase24Schema.js
 * ──────────────────────────────────
 * Onboarding system schema.
 *
 * Tables:
 *   onboarding_progress  — 4-step workflow completion tracking
 *   onboarding_uploads   — uploaded report file metadata for extraction
 */

export function initPhase24Schema(db) {
  db.exec(`
    -- ── onboarding_progress ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS onboarding_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE NOT NULL,
      current_step INTEGER DEFAULT 1,
      profile_completed INTEGER DEFAULT 0,
      reports_uploaded INTEGER DEFAULT 0,
      voice_trained INTEGER DEFAULT 0,
      sample_generated INTEGER DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user_id
      ON onboarding_progress(user_id);

    -- ── onboarding_uploads ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS onboarding_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      extraction_status TEXT DEFAULT 'pending',
      sections_extracted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES onboarding_progress(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_uploads_user_id
      ON onboarding_uploads(user_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_uploads_extraction_status
      ON onboarding_uploads(extraction_status);
  `);
}
