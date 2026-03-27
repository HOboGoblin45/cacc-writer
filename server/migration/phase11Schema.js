/**
 * server/migration/phase11Schema.js
 * -----------------------------------
 * Phase 11 — Learning / Memory System
 *
 * Schema additions:
 *   - assignment_archives      — full final state of completed assignments
 *   - learned_patterns         — extracted learnable patterns from archives
 *   - pattern_applications     — tracks when/where patterns were applied
 *
 * These tables are additive — they do not modify existing Phase 1-10 tables.
 *
 * Usage:
 *   import { initPhase11Schema } from '../migration/phase11Schema.js';
 *   initPhase11Schema(db);
 */

/**
 * Create Phase 11 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase11Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- assignment_archives — Full final state of completed assignments
    -- ══════════════════════════════════════════════════════════════════════════
    -- Captures the complete final state of an assignment when it is marked
    -- complete. Used as the source of truth for pattern learning and
    -- prior-assignment retrieval.
    --
    -- JSON columns store snapshots of subject facts, comp sets, adjustments,
    -- narratives, reconciliation, QC issues, AI-vs-final diffs, and
    -- suggestion acceptance/rejection decisions.

    CREATE TABLE IF NOT EXISTS assignment_archives (
      id                       TEXT PRIMARY KEY,
      case_id                  TEXT NOT NULL UNIQUE,
      form_type                TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'active',
      -- status values: active | superseded | deleted

      subject_snapshot_json    TEXT NOT NULL DEFAULT '{}',
      comp_set_json            TEXT NOT NULL DEFAULT '{}',
      adjustments_json         TEXT NOT NULL DEFAULT '{}',
      narratives_json          TEXT NOT NULL DEFAULT '{}',
      reconciliation_json      TEXT NOT NULL DEFAULT '{}',
      qc_snapshot_json         TEXT NOT NULL DEFAULT '{}',
      edit_diff_json           TEXT NOT NULL DEFAULT '{}',
      suggestion_decisions_json TEXT NOT NULL DEFAULT '{}',

      -- Searchable metadata for similarity matching
      property_type            TEXT,
      market_area              TEXT,
      price_range_low          REAL,
      price_range_high         REAL,

      archived_at              TEXT NOT NULL DEFAULT (datetime('now')),
      created_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignment_archives_case_id
      ON assignment_archives(case_id);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_form_type
      ON assignment_archives(form_type);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_property_type
      ON assignment_archives(property_type);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_market_area
      ON assignment_archives(market_area);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_price_range
      ON assignment_archives(price_range_low, price_range_high);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_status
      ON assignment_archives(status);
    CREATE INDEX IF NOT EXISTS idx_assignment_archives_archived_at
      ON assignment_archives(archived_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- learned_patterns — Extracted learnable patterns from archives
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each row is a single learnable pattern extracted from an archived
    -- assignment. Pattern types include comp acceptance, adjustment amounts,
    -- narrative edit patterns, and reconciliation weighting.
    --
    -- pattern_type values:
    --   comp_acceptance     — which comps the appraiser accepted/rejected
    --   adjustment          — typical adjustment amounts by category
    --   narrative_edit      — systematic changes to AI drafts
    --   reconciliation      — reconciliation weighting patterns
    --
    -- confidence: 0.0-1.0, starts at 0.5, increases with repeated usage

    CREATE TABLE IF NOT EXISTS learned_patterns (
      id                 TEXT PRIMARY KEY,
      archive_id         TEXT NOT NULL,
      case_id            TEXT NOT NULL,
      pattern_type       TEXT NOT NULL,
      pattern_key        TEXT NOT NULL,
      pattern_data_json  TEXT NOT NULL DEFAULT '{}',
      confidence         REAL NOT NULL DEFAULT 0.5,
      usage_count        INTEGER NOT NULL DEFAULT 0,
      last_used_at       TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (archive_id) REFERENCES assignment_archives(id)
    );

    CREATE INDEX IF NOT EXISTS idx_learned_patterns_archive_id
      ON learned_patterns(archive_id);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_case_id
      ON learned_patterns(case_id);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_type
      ON learned_patterns(pattern_type);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_key
      ON learned_patterns(pattern_key);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_type_key
      ON learned_patterns(pattern_type, pattern_key);
    CREATE INDEX IF NOT EXISTS idx_learned_patterns_confidence
      ON learned_patterns(confidence DESC);

    -- ══════════════════════════════════════════════════════════════════════════
    -- pattern_applications — Tracks when/where patterns were applied
    -- ══════════════════════════════════════════════════════════════════════════
    -- Records each time a learned pattern is used to boost/demote a
    -- suggestion in a new assignment. Tracks outcome for feedback loop.
    --
    -- outcome values: pending | accepted | rejected | ignored

    CREATE TABLE IF NOT EXISTS pattern_applications (
      id                 TEXT PRIMARY KEY,
      pattern_id         TEXT NOT NULL,
      case_id            TEXT NOT NULL,
      applied_context    TEXT NOT NULL,
      outcome            TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pattern_id) REFERENCES learned_patterns(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pattern_applications_pattern_id
      ON pattern_applications(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_pattern_applications_case_id
      ON pattern_applications(case_id);
    CREATE INDEX IF NOT EXISTS idx_pattern_applications_outcome
      ON pattern_applications(outcome);
  `);
}

export default { initPhase11Schema };
