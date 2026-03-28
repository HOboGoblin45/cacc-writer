import log from '../logger.js';

/**
 * Phase 28: Beta Feedback Widget and Training Dashboard
 * Adds schema for collecting feedback on generated sections,
 * diff analysis, and training pair exports
 */
export function initPhase28Schema(db) {
  try {
    db.exec(`
      -- Beta feedback tracking for model improvement
      CREATE TABLE IF NOT EXISTS beta_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        section_type TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        original_text TEXT,
        edited_text TEXT,
        feedback_note TEXT,
        edit_distance INTEGER DEFAULT 0,
        edit_ratio REAL DEFAULT 0.0,
        has_edits INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, case_id, section_type)
      );

      -- Diff details for edited sections
      CREATE TABLE IF NOT EXISTS feedback_diffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feedback_id INTEGER NOT NULL,
        position INTEGER,
        original_sentence TEXT,
        edited_sentence TEXT,
        diff_type TEXT CHECK (diff_type IN ('added', 'removed', 'modified')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (feedback_id) REFERENCES beta_feedback(id) ON DELETE CASCADE
      );

      -- Training data export history
      CREATE TABLE IF NOT EXISTS training_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        export_id TEXT UNIQUE NOT NULL,
        total_pairs INTEGER DEFAULT 0,
        min_rating INTEGER,
        section_filter TEXT,
        exported_at TEXT DEFAULT (datetime('now')),
        exported_by TEXT
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_user_id ON beta_feedback(user_id);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_case_id ON beta_feedback(case_id);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_section_type ON beta_feedback(section_type);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_rating ON beta_feedback(rating);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_has_edits ON beta_feedback(has_edits);
      CREATE INDEX IF NOT EXISTS idx_beta_feedback_created_at ON beta_feedback(created_at);

      CREATE INDEX IF NOT EXISTS idx_feedback_diffs_feedback_id ON feedback_diffs(feedback_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_diffs_type ON feedback_diffs(diff_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_diffs_position ON feedback_diffs(position);

      CREATE INDEX IF NOT EXISTS idx_training_exports_exported_by ON training_exports(exported_by);
      CREATE INDEX IF NOT EXISTS idx_training_exports_exported_at ON training_exports(exported_at);
    `);

    log.info('Phase 28 schema initialized: beta feedback, diffs, and training exports');
  } catch (error) {
    log.error(`Phase 28 schema initialization failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get the phase number
 */
export const PHASE = 28;
