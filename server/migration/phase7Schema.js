/**
 * server/migration/phase7Schema.js
 * -----------------------------------
 * Phase 7 — Quality Control and Review Automation
 *
 * Schema additions for Phase 7:
 *   - qc_runs      — QC run lifecycle tracking
 *   - qc_findings  — individual QC findings per run
 *
 * These tables are additive — they do not modify existing Phase 1-6 tables.
 *
 * Usage:
 *   import { initPhase7Schema } from '../migration/phase7Schema.js';
 *   initPhase7Schema(db);
 */

/**
 * Create Phase 7 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase7Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- qc_runs — QC run lifecycle tracking
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each QC run evaluates a draft package (tied to a generation run)
    -- and produces a set of findings.
    --
    -- Status values:
    --   pending   — QC run created but not yet started
    --   running   — QC checks in progress
    --   completed — all checks finished
    --   failed    — QC run encountered a fatal error

    CREATE TABLE IF NOT EXISTS qc_runs (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT NOT NULL,
      generation_run_id     TEXT,
      draft_package_id      TEXT,

      status                TEXT NOT NULL DEFAULT 'pending',
      rule_set_version      TEXT NOT NULL DEFAULT '1.0',
      report_family         TEXT,
      form_type             TEXT,

      -- Snapshot of assignment flags at QC time (JSON)
      flags_snapshot_json   TEXT DEFAULT '{}',

      -- Summary stats (JSON) — rolled up after completion
      summary_json          TEXT DEFAULT '{}',

      -- Counts
      total_rules_evaluated INTEGER DEFAULT 0,
      total_findings        INTEGER DEFAULT 0,
      blocker_count         INTEGER DEFAULT 0,
      high_count            INTEGER DEFAULT 0,
      medium_count          INTEGER DEFAULT 0,
      low_count             INTEGER DEFAULT 0,
      advisory_count        INTEGER DEFAULT 0,

      -- Readiness signal
      draft_readiness       TEXT DEFAULT 'unknown',
      -- draft_readiness values: ready | needs_review | needs_major_work | not_ready | unknown

      duration_ms           INTEGER DEFAULT 0,
      error_text            TEXT,

      started_at            TEXT,
      completed_at          TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_qc_runs_case_id
      ON qc_runs(case_id);
    CREATE INDEX IF NOT EXISTS idx_qc_runs_generation_run_id
      ON qc_runs(generation_run_id);
    CREATE INDEX IF NOT EXISTS idx_qc_runs_status
      ON qc_runs(status);

    -- ══════════════════════════════════════════════════════════════════════════
    -- qc_findings — Individual QC findings per run
    -- ══════════════════════════════════════════════════════════════════════════
    -- Each finding is a single issue detected by a QC rule.
    -- Findings are inspectable, dismissable, and resolvable.
    --
    -- Status values:
    --   open      — finding is active and unresolved
    --   dismissed — user dismissed the finding (with optional note)
    --   resolved  — user marked the finding as resolved (after edit)

    CREATE TABLE IF NOT EXISTS qc_findings (
      id                    TEXT PRIMARY KEY,
      qc_run_id             TEXT NOT NULL,
      rule_id               TEXT NOT NULL,

      severity              TEXT NOT NULL DEFAULT 'medium',
      -- severity values: blocker | high | medium | low | advisory

      category              TEXT NOT NULL DEFAULT 'general',
      -- category values: completeness | consistency | assignment_context |
      --   section_quality | compliance_signal | placeholder | reconciliation |
      --   canonical_field | report_family | unsupported_certainty | general

      -- Affected targets (JSON arrays)
      section_ids_json      TEXT DEFAULT '[]',
      canonical_field_ids_json TEXT DEFAULT '[]',

      -- Messages
      message               TEXT NOT NULL,
      detail_message        TEXT,
      suggested_action      TEXT,

      -- Evidence (JSON) — structured payload for UI display
      evidence_json         TEXT DEFAULT '{}',

      -- Source references (JSON array) — future hook for guideline citations
      source_refs_json      TEXT DEFAULT '[]',

      -- Review state
      status                TEXT NOT NULL DEFAULT 'open',
      resolution_note       TEXT,
      dismissed_at          TEXT,
      resolved_at           TEXT,

      created_at            TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (qc_run_id) REFERENCES qc_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_qc_findings_qc_run_id
      ON qc_findings(qc_run_id);
    CREATE INDEX IF NOT EXISTS idx_qc_findings_rule_id
      ON qc_findings(rule_id);
    CREATE INDEX IF NOT EXISTS idx_qc_findings_severity
      ON qc_findings(severity);
    CREATE INDEX IF NOT EXISTS idx_qc_findings_status
      ON qc_findings(status);
    CREATE INDEX IF NOT EXISTS idx_qc_findings_category
      ON qc_findings(category);
  `);
}

export default { initPhase7Schema };
