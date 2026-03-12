/**
 * server/migration/phase9Schema.js
 * ---------------------------------
 * Phase 9: Destination Automation and Final Output Integration
 *
 * SQLite schema additions:
 *   insertion_runs       — batch insertion session tracking
 *   insertion_run_items  — per-field insertion outcome with verification
 *   destination_profiles — persisted destination configuration/templates
 *
 * Called from server/db/schema.js initSchema().
 */

/**
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase9Schema(db) {
  db.exec(`
    -- ── insertion_runs ────────────────────────────────────────────────────────
    -- Tracks a batch insertion session against a destination.
    -- One run = one attempt to insert N fields into ACI or Real Quantum.
    CREATE TABLE IF NOT EXISTS insertion_runs (
      id                  TEXT PRIMARY KEY,
      case_id             TEXT NOT NULL,
      generation_run_id   TEXT,
      form_type           TEXT NOT NULL,
      target_software     TEXT NOT NULL,
      -- target_software: 'aci' | 'real_quantum'

      status              TEXT NOT NULL DEFAULT 'queued',
      -- status: queued | preparing | running | completed | partial | failed | cancelled

      total_fields        INTEGER DEFAULT 0,
      completed_fields    INTEGER DEFAULT 0,
      failed_fields       INTEGER DEFAULT 0,
      skipped_fields      INTEGER DEFAULT 0,
      verified_fields     INTEGER DEFAULT 0,

      -- QC gate snapshot
      qc_run_id           TEXT,
      qc_blocker_count    INTEGER DEFAULT 0,
      qc_gate_passed      INTEGER DEFAULT 1,
      -- 1 = passed or skipped; 0 = blocked

      -- Configuration
      config_json         TEXT DEFAULT '{}',
      -- config: { dryRun, verifyAfter, skipQcBlockers, forceReinsert, maxRetries }

      -- Summary
      summary_json        TEXT DEFAULT '{}',
      replay_package_json TEXT DEFAULT '{}',
      rollback_fields     INTEGER DEFAULT 0,

      started_at          TEXT,
      completed_at        TEXT,
      duration_ms         INTEGER,

      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_insertion_runs_case_id
      ON insertion_runs(case_id);
    CREATE INDEX IF NOT EXISTS idx_insertion_runs_status
      ON insertion_runs(status);
    CREATE INDEX IF NOT EXISTS idx_insertion_runs_gen_run
      ON insertion_runs(generation_run_id);

    -- ── insertion_run_items ───────────────────────────────────────────────────
    -- Per-field insertion outcome within a run.
    -- Tracks the full lifecycle: format → insert → verify → fallback.
    CREATE TABLE IF NOT EXISTS insertion_run_items (
      id                  TEXT PRIMARY KEY,
      insertion_run_id    TEXT NOT NULL,
      case_id             TEXT NOT NULL,
      field_id            TEXT NOT NULL,
      form_type           TEXT NOT NULL,

      -- Destination targeting
      target_software     TEXT NOT NULL,
      destination_key     TEXT,
      -- destination_key: resolved key from destinationMapper (e.g. 'aci::1004::reconciliation')

      -- Status
      status              TEXT NOT NULL DEFAULT 'queued',
      -- status: queued | formatting | inserting | inserted | verified | failed | skipped | fallback_used

      -- Text tracking
      canonical_text      TEXT,
      -- canonical_text: the approved/final text before formatting
      canonical_text_length INTEGER DEFAULT 0,

      formatted_text      TEXT,
      -- formatted_text: destination-specific formatted output
      formatted_text_length INTEGER DEFAULT 0,

      -- Verification
      verification_status TEXT DEFAULT 'pending',
      -- verification_status: pending | passed | mismatch | unreadable | not_supported | failed | skipped
      verification_raw    TEXT,
      -- verification_raw: raw value returned from agent /read-field
      verification_normalized TEXT,
      -- verification_normalized: normalized comparison value
      verification_expected TEXT,
      -- verification_expected: normalized expected text used in comparison
      preinsert_raw       TEXT,
      preinsert_normalized TEXT,

      -- Retry / fallback
      attempt_count       INTEGER DEFAULT 0,
      max_attempts        INTEGER DEFAULT 3,
      retry_class         TEXT,
      fallback_strategy   TEXT,
      -- fallback_strategy: retry | clipboard | manual_prompt | retry_then_clipboard
      fallback_used       INTEGER DEFAULT 0,
      attempt_log_json    TEXT DEFAULT '[]',
      rollback_attempted  INTEGER DEFAULT 0,
      rollback_status     TEXT,
      rollback_text       TEXT,
      rollback_error_text TEXT,

      -- Agent response
      agent_response_json TEXT DEFAULT '{}',

      -- Failure tracking (structured)
      error_code          TEXT,
      -- error_code: agent_unreachable | agent_timeout | field_not_found | insertion_rejected |
      --             verification_mismatch | format_error | unknown
      error_text          TEXT,
      error_detail_json   TEXT,
      -- error_detail_json: { agentStatus, agentMessage, stackTrace, fieldState }

      -- Timing
      started_at          TEXT,
      completed_at        TEXT,
      duration_ms         INTEGER,

      -- Ordering
      sort_order          INTEGER DEFAULT 0,

      created_at          TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (insertion_run_id) REFERENCES insertion_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_insertion_items_run_id
      ON insertion_run_items(insertion_run_id);
    CREATE INDEX IF NOT EXISTS idx_insertion_items_case_field
      ON insertion_run_items(case_id, field_id);
    CREATE INDEX IF NOT EXISTS idx_insertion_items_status
      ON insertion_run_items(status);
    CREATE INDEX IF NOT EXISTS idx_insertion_items_verification
      ON insertion_run_items(verification_status);

    -- ── destination_profiles ──────────────────────────────────────────────────
    -- Persisted destination configuration / templates.
    -- Allows the user to configure different ACI or RQ environments.
    CREATE TABLE IF NOT EXISTS destination_profiles (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      target_software     TEXT NOT NULL,
      -- target_software: 'aci' | 'real_quantum'

      form_type           TEXT NOT NULL,
      -- form_type: '1004' | 'commercial' | etc.

      base_url            TEXT,
      -- base_url: agent URL override (e.g. 'http://localhost:5180')

      -- Capability flags
      supports_readback   INTEGER DEFAULT 1,
      supports_rich_text  INTEGER DEFAULT 0,
      supports_partial_retry INTEGER DEFAULT 1,
      supports_append_mode INTEGER DEFAULT 0,
      requires_focus_target INTEGER DEFAULT 0,

      -- Configuration
      config_json         TEXT DEFAULT '{}',
      -- config: { timeout, maxRetries, verifyAfter, defaultFallback, ... }

      active              INTEGER DEFAULT 1,

      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dest_profiles_software
      ON destination_profiles(target_software, form_type);
    CREATE INDEX IF NOT EXISTS idx_dest_profiles_active
      ON destination_profiles(active);
  `);

  // Seed default destination profiles if none exist
  const profileCount = db.prepare('SELECT COUNT(*) as cnt FROM destination_profiles').get();
  if (profileCount.cnt === 0) {
    const insertProfile = db.prepare(`
      INSERT INTO destination_profiles (id, name, target_software, form_type, base_url,
        supports_readback, supports_rich_text, supports_partial_retry,
        supports_append_mode, requires_focus_target, config_json, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertProfile.run(
      'profile_aci_1004', 'ACI Desktop — 1004 URAR', 'aci', '1004',
      'http://localhost:5180',
      1, 0, 1, 0, 1,
      JSON.stringify({
        timeout: 15000,
        maxRetries: 3,
        verifyAfter: true,
        defaultFallback: 'retry_then_clipboard',
        verificationMode: 'tx32_readback',
      }),
      1
    );

    insertProfile.run(
      'profile_rq_commercial', 'Real Quantum — Commercial', 'real_quantum', 'commercial',
      'http://localhost:5181',
      1, 1, 1, 0, 0,
      JSON.stringify({
        timeout: 20000,
        maxRetries: 3,
        verifyAfter: true,
        defaultFallback: 'retry_then_clipboard',
        verificationMode: 'contains_text',
        chromeDebugPort: 9222,
      }),
      1
    );
  }

  const migrations = [
    `ALTER TABLE insertion_runs ADD COLUMN replay_package_json TEXT DEFAULT '{}'`,
    `ALTER TABLE insertion_runs ADD COLUMN rollback_fields INTEGER DEFAULT 0`,
    `ALTER TABLE insertion_run_items ADD COLUMN verification_expected TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN preinsert_raw TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN preinsert_normalized TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN retry_class TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN attempt_log_json TEXT DEFAULT '[]'`,
    `ALTER TABLE insertion_run_items ADD COLUMN rollback_attempted INTEGER DEFAULT 0`,
    `ALTER TABLE insertion_run_items ADD COLUMN rollback_status TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN rollback_text TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN rollback_error_text TEXT`,
    // Priority 5: Insertion Reliability Completion
    `ALTER TABLE insertion_runs ADD COLUMN original_run_id TEXT`,
    `ALTER TABLE insertion_runs ADD COLUMN run_type TEXT DEFAULT 'standard'`,
    `ALTER TABLE insertion_run_items ADD COLUMN diff_json TEXT`,
    `ALTER TABLE insertion_run_items ADD COLUMN similarity_score REAL`,
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists.
    }
  }
}
