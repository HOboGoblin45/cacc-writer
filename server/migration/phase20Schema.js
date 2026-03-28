/**
 * server/migration/phase20Schema.js
 * -----------------------------------
 * Phase 20 — AutoTune, Voice Reference Embeddings, STM Normalization
 *
 * Schema additions:
 *   - autotune_ema_state      — EMA-based auto-tuning state per context
 *   - autotune_outcomes       — outcome history for auto-tuning feedback
 *   - voice_reference_embeddings — cached embeddings for voice matching
 *   - stm_normalization_log   — STM normalization operation tracking
 *
 * These tables are additive — they do not modify existing tables.
 *
 * Usage:
 *   import { initPhase20Schema } from '../migration/phase20Schema.js';
 *   initPhase20Schema(db);
 */

/**
 * Create Phase 20 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase20Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- autotune_ema_state — EMA-based auto-tuning state per context
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS autotune_ema_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_key TEXT NOT NULL UNIQUE,
      form_type TEXT NOT NULL,
      section_id TEXT NOT NULL,
      avg_score REAL DEFAULT 0.5,
      avg_tokens_used REAL DEFAULT 500,
      optimal_temperature REAL DEFAULT 0.7,
      optimal_max_tokens REAL DEFAULT 1000,
      optimal_top_p REAL DEFAULT 0.9,
      sample_count INTEGER DEFAULT 0,
      alpha REAL DEFAULT 0.3,
      last_updated TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_autotune_ema_context_key
      ON autotune_ema_state(context_key);
    CREATE INDEX IF NOT EXISTS idx_autotune_ema_form_type
      ON autotune_ema_state(form_type);
    CREATE INDEX IF NOT EXISTS idx_autotune_ema_section_id
      ON autotune_ema_state(section_id);
    CREATE INDEX IF NOT EXISTS idx_autotune_ema_created_at
      ON autotune_ema_state(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- autotune_outcomes — Outcome history for auto-tuning feedback
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS autotune_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_key TEXT NOT NULL,
      section_id TEXT NOT NULL,
      form_type TEXT NOT NULL,
      quality_score REAL,
      tokens_used INTEGER,
      was_approved INTEGER DEFAULT 0,
      temperature_used REAL,
      max_tokens_used INTEGER,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_autotune_outcomes_context_key
      ON autotune_outcomes(context_key);
    CREATE INDEX IF NOT EXISTS idx_autotune_outcomes_section_id
      ON autotune_outcomes(section_id);
    CREATE INDEX IF NOT EXISTS idx_autotune_outcomes_form_type
      ON autotune_outcomes(form_type);
    CREATE INDEX IF NOT EXISTS idx_autotune_outcomes_user_id
      ON autotune_outcomes(user_id);
    CREATE INDEX IF NOT EXISTS idx_autotune_outcomes_created_at
      ON autotune_outcomes(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- voice_reference_embeddings — Cached embeddings for voice matching
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS voice_reference_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      form_type TEXT NOT NULL,
      section_id TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      source TEXT DEFAULT 'approved_narrative',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, form_type, section_id, text_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_voice_embeddings_user_id
      ON voice_reference_embeddings(user_id);
    CREATE INDEX IF NOT EXISTS idx_voice_embeddings_form_type
      ON voice_reference_embeddings(form_type);
    CREATE INDEX IF NOT EXISTS idx_voice_embeddings_section_id
      ON voice_reference_embeddings(section_id);
    CREATE INDEX IF NOT EXISTS idx_voice_embeddings_created_at
      ON voice_reference_embeddings(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- stm_normalization_log — STM normalization operation tracking
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS stm_normalization_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id TEXT NOT NULL,
      form_type TEXT NOT NULL,
      original_length INTEGER,
      cleaned_length INTEGER,
      regex_changes INTEGER DEFAULT 0,
      llm_pass_used INTEGER DEFAULT 0,
      preamble_stripped INTEGER DEFAULT 0,
      postamble_stripped INTEGER DEFAULT 0,
      truncated INTEGER DEFAULT 0,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stm_normalization_section_id
      ON stm_normalization_log(section_id);
    CREATE INDEX IF NOT EXISTS idx_stm_normalization_form_type
      ON stm_normalization_log(form_type);
    CREATE INDEX IF NOT EXISTS idx_stm_normalization_user_id
      ON stm_normalization_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_stm_normalization_created_at
      ON stm_normalization_log(created_at);
  `);
}

export default { initPhase20Schema };
