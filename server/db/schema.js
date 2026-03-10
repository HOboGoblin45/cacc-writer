/**
 * server/db/schema.js
 * --------------------
 * SQLite schema for CACC Writer orchestrator.
 * All 10 tables as specified in the architecture upgrade.
 *
 * Tables:
 *   assignments          — normalized assignment context per case
 *   report_plans         — deterministic report plan per assignment
 *   generation_runs      — full-draft generation run tracking
 *   section_jobs         — individual section job tracking within a run
 *   generated_sections   — output text per section job
 *   memory_items         — unified narrative memory store (SQLite mirror of KB)
 *   retrieval_cache      — cached retrieval packs per assignment (1hr TTL)
 *   analysis_artifacts   — structured analysis outputs (comp, market, HBU)
 *   ingest_jobs          — PDF ingestion job tracking
 *   staged_memory_reviews — items awaiting human review before promotion
 */

export function initSchema(db) {
  db.exec(`
    -- ── assignments ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS assignments (
      id          TEXT PRIMARY KEY,
      case_id     TEXT NOT NULL UNIQUE,
      form_type   TEXT NOT NULL,
      context_json TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_case_id
      ON assignments(case_id);

    -- ── report_plans ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS report_plans (
      id            TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      form_type     TEXT NOT NULL,
      plan_json     TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assignment_id) REFERENCES assignments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_report_plans_assignment_id
      ON report_plans(assignment_id);

    -- ── generation_runs ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS generation_runs (
      id            TEXT PRIMARY KEY,
      case_id       TEXT NOT NULL,
      assignment_id TEXT,
      form_type     TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      -- status values: pending | running | completed | failed | partial

      started_at    TEXT,
      completed_at  TEXT,
      duration_ms   INTEGER,

      -- Phase-level timing (ms)
      context_build_ms   INTEGER,
      report_plan_ms     INTEGER,
      retrieval_ms       INTEGER,
      analysis_ms        INTEGER,
      parallel_draft_ms  INTEGER,
      validation_ms      INTEGER,
      assembly_ms        INTEGER,

      -- Section counts
      section_count   INTEGER DEFAULT 0,
      success_count   INTEGER DEFAULT 0,
      error_count     INTEGER DEFAULT 0,
      retry_count     INTEGER DEFAULT 0,
      partial_complete INTEGER DEFAULT 0,

      -- Retrieval stats
      retrieval_cache_hit  INTEGER DEFAULT 0,
      memory_items_scanned INTEGER DEFAULT 0,
      memory_items_used    INTEGER DEFAULT 0,

      warnings_json TEXT DEFAULT '[]',
      metrics_json  TEXT DEFAULT '{}',
      error_text    TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_generation_runs_case_id
      ON generation_runs(case_id);
    CREATE INDEX IF NOT EXISTS idx_generation_runs_status
      ON generation_runs(status);

    -- ── section_jobs ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS section_jobs (
      id               TEXT PRIMARY KEY,
      run_id           TEXT NOT NULL,
      section_id       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      -- status values: pending | running | completed | failed | skipped

      generator_profile  TEXT,
      dependencies_json  TEXT DEFAULT '[]',

      attempt_count      INTEGER DEFAULT 0,
      started_at         TEXT,
      completed_at       TEXT,
      duration_ms        INTEGER,
      dependency_wait_ms INTEGER,

      -- Content metrics
      input_chars    INTEGER,
      output_chars   INTEGER,
      warnings_count INTEGER DEFAULT 0,

      -- Token metrics (if available)
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,

      error_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (run_id) REFERENCES generation_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_section_jobs_run_id
      ON section_jobs(run_id);
    CREATE INDEX IF NOT EXISTS idx_section_jobs_status
      ON section_jobs(status);

    -- ── generated_sections ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS generated_sections (
      id            TEXT PRIMARY KEY,
      job_id        TEXT NOT NULL,
      run_id        TEXT NOT NULL,
      case_id       TEXT NOT NULL,
      section_id    TEXT NOT NULL,
      form_type     TEXT NOT NULL,

      draft_text    TEXT,
      reviewed_text TEXT,
      final_text    TEXT,

      examples_used INTEGER DEFAULT 0,
      approved      INTEGER DEFAULT 0,
      approved_at   TEXT,
      inserted_at   TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (job_id) REFERENCES section_jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_generated_sections_case_id
      ON generated_sections(case_id);
    CREATE INDEX IF NOT EXISTS idx_generated_sections_run_id
      ON generated_sections(run_id);
    CREATE INDEX IF NOT EXISTS idx_generated_sections_section_id
      ON generated_sections(section_id, case_id);

    -- ── memory_items ──────────────────────────────────────────────────────────
    -- Unified narrative memory store — SQLite mirror of the flat KB files.
    -- Source of truth remains the flat files; this is a queryable index.
    CREATE TABLE IF NOT EXISTS memory_items (
      id           TEXT PRIMARY KEY,
      section_type TEXT NOT NULL,
      form_type    TEXT NOT NULL,
      text         TEXT NOT NULL,
      text_hash    TEXT NOT NULL,

      source_type  TEXT NOT NULL,
      -- source_type values: approvedNarrative | approved_edit | imported | voice | staged

      quality_score REAL DEFAULT 75,
      approved      INTEGER DEFAULT 0,
      staged        INTEGER DEFAULT 0,

      -- Contextual metadata for retrieval scoring
      property_type      TEXT,
      market_type        TEXT,
      city               TEXT,
      county             TEXT,
      state              TEXT,
      assignment_purpose TEXT,
      loan_program       TEXT,
      subject_condition  TEXT,

      tags_json     TEXT DEFAULT '[]',
      metadata_json TEXT DEFAULT '{}',

      source_file      TEXT,
      source_report_id TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_hash
      ON memory_items(text_hash);
    CREATE INDEX IF NOT EXISTS idx_memory_items_section_form
      ON memory_items(section_type, form_type);
    CREATE INDEX IF NOT EXISTS idx_memory_items_approved
      ON memory_items(approved, quality_score);

    -- ── retrieval_cache ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS retrieval_cache (
      id            TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      section_id    TEXT,
      -- section_id NULL = full assignment pack
      pack_json     TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_retrieval_cache_assignment
      ON retrieval_cache(assignment_id, section_id);
    CREATE INDEX IF NOT EXISTS idx_retrieval_cache_expires
      ON retrieval_cache(expires_at);

    -- ── analysis_artifacts ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS analysis_artifacts (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      -- artifact_type values: comp_analysis | market_analysis | hbu_logic | zoning_logic
      section_id    TEXT,
      data_json     TEXT NOT NULL,
      duration_ms   INTEGER,
      warnings_json TEXT DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES generation_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_artifacts_run_id
      ON analysis_artifacts(run_id);

    -- ── ingest_jobs ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ingest_jobs (
      id                 TEXT PRIMARY KEY,
      source_file        TEXT NOT NULL,
      form_type          TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending',
      -- status values: pending | processing | completed | failed

      sections_extracted INTEGER DEFAULT 0,
      phrases_extracted  INTEGER DEFAULT 0,
      error_text         TEXT,

      started_at   TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status
      ON ingest_jobs(status);

    -- ── staged_memory_reviews ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS staged_memory_reviews (
      id            TEXT PRIMARY KEY,
      ingest_job_id TEXT,
      section_type  TEXT NOT NULL,
      form_type     TEXT NOT NULL,
      text          TEXT NOT NULL,
      text_hash     TEXT NOT NULL,
      source_file   TEXT,
      metadata_json TEXT DEFAULT '{}',

      review_status TEXT DEFAULT 'pending',
      -- review_status values: pending | approved | rejected

      reviewed_at TEXT,
      promoted_id TEXT,
      -- promoted_id = memory_items.id after promotion

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staged_reviews_status
      ON staged_memory_reviews(review_status);
    CREATE INDEX IF NOT EXISTS idx_staged_reviews_form
      ON staged_memory_reviews(form_type, section_type);
  `);
}
