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
 *   assignment_intelligence — Phase 4 intelligence bundles per case
 *   case_documents         — Phase 5 source files attached to cases
 *   document_extractions   — Phase 5 extraction job + output tracking
 *   extracted_facts        — Phase 5 structured fact candidates from documents
 *   extracted_sections     — Phase 5 narrative sections from prior reports
 */

// ── Column migrations ─────────────────────────────────────────────────────────
// SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
// We use try/catch per statement — safe to run on every startup.
// New columns added in Phase 3:
//   generation_runs.draft_package_json   — persists assembled draft package
//   section_jobs.retrieval_source_ids_json — stores example IDs used per section
//   section_jobs.estimated_cost_usd      — optional cost tracking

import log from '../logger.js';
import { initPhase6Schema } from '../migration/phase6Schema.js';
import { initPhase7Schema } from '../migration/phase7Schema.js';
import { initPhase9Schema } from '../migration/phase9Schema.js';
import { initPhase10Schema } from '../migration/phase10Schema.js';

function runMigrations(db) {
  const migrations = [
    // Phase 3 — draft package persistence
    `ALTER TABLE generation_runs ADD COLUMN draft_package_json TEXT`,
    // Phase 3 — retrieval source IDs per section job
    `ALTER TABLE section_jobs ADD COLUMN retrieval_source_ids_json TEXT DEFAULT '[]'`,
    // Phase 3 — optional cost tracking per section job
    `ALTER TABLE section_jobs ADD COLUMN estimated_cost_usd REAL`,
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}

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

    -- ── case_records (Phase B) ───────────────────────────────────────────────
    -- Canonical assignment-level case header/state record.
    -- This becomes the authoritative mutable case source-of-truth over time.
    CREATE TABLE IF NOT EXISTS case_records (
      case_id              TEXT PRIMARY KEY,
      form_type            TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'active',
      pipeline_stage       TEXT NOT NULL DEFAULT 'intake',
      workflow_status      TEXT NOT NULL DEFAULT 'facts_incomplete',
      address              TEXT NOT NULL DEFAULT '',
      borrower             TEXT NOT NULL DEFAULT '',
      unresolved_issues_json TEXT NOT NULL DEFAULT '[]',
      meta_json            TEXT NOT NULL DEFAULT '{}',
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_records_updated_at
      ON case_records(updated_at);

    -- ── case_facts (Phase B) ─────────────────────────────────────────────────
    -- Canonical structured facts payload + provenance links per case.
    CREATE TABLE IF NOT EXISTS case_facts (
      case_id         TEXT PRIMARY KEY,
      facts_json      TEXT NOT NULL DEFAULT '{}',
      provenance_json TEXT NOT NULL DEFAULT '{}',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

    -- ── case_outputs (Phase B) ───────────────────────────────────────────────
    -- Canonical drafted output payload per case.
    CREATE TABLE IF NOT EXISTS case_outputs (
      case_id     TEXT PRIMARY KEY,
      outputs_json TEXT NOT NULL DEFAULT '{}',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

    -- ── case_history (Phase B) ───────────────────────────────────────────────
    -- Canonical section revision history per case.
    CREATE TABLE IF NOT EXISTS case_history (
      case_id      TEXT PRIMARY KEY,
      history_json TEXT NOT NULL DEFAULT '{}',
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

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

    -- ── assignment_intelligence (Phase 4) ───────────────────────────────────
    -- Persisted assignment intelligence bundles.
    -- Contains the full Phase 4 output: normalized context v2, derived flags,
    -- compliance profile, report family, canonical fields, and section plan v2.
    CREATE TABLE IF NOT EXISTS assignment_intelligence (
      id          TEXT PRIMARY KEY,
      case_id     TEXT NOT NULL UNIQUE,
      form_type   TEXT NOT NULL,
      bundle_json TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_intelligence_case_id
      ON assignment_intelligence(case_id);

    -- ── case_documents (Phase 5) ──────────────────────────────────────────────
    -- First-class source files attached to cases.
    -- Every uploaded file becomes a tracked document with classification and provenance.
    CREATE TABLE IF NOT EXISTS case_documents (
      id                TEXT PRIMARY KEY,
      case_id           TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename   TEXT NOT NULL,
      doc_type          TEXT NOT NULL DEFAULT 'unknown',
      -- doc_type values: order_sheet | engagement_letter | contract |
      --   mls_sheet | assessor_record | zoning_document | flood_document |
      --   prior_appraisal | comp_sheet | map_exhibit | photo_batch |
      --   guideline | handwritten_notes | narrative_source | unknown

      file_type         TEXT NOT NULL DEFAULT 'pdf',
      file_size_bytes   INTEGER DEFAULT 0,
      page_count        INTEGER DEFAULT 0,
      file_hash         TEXT,

      classification_method   TEXT DEFAULT 'manual',
      -- classification_method: manual | filename | keyword | ai
      classification_confidence REAL DEFAULT 1.0,

      extraction_status TEXT DEFAULT 'pending',
      -- extraction_status: pending | extracting | extracted | failed | skipped

      text_length       INTEGER DEFAULT 0,
      notes             TEXT,
      tags_json         TEXT DEFAULT '[]',

      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_documents_case_id
      ON case_documents(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_documents_doc_type
      ON case_documents(doc_type);

    -- ── document_extractions (Phase 5) ────────────────────────────────────────
    -- Tracks each extraction job run against a document.
    -- A document can be re-extracted multiple times (different methods/versions).
    CREATE TABLE IF NOT EXISTS document_extractions (
      id              TEXT PRIMARY KEY,
      document_id     TEXT NOT NULL,
      case_id         TEXT NOT NULL,
      doc_type        TEXT NOT NULL,

      status          TEXT NOT NULL DEFAULT 'pending',
      -- status: pending | running | completed | failed

      extraction_method TEXT,
      -- extraction_method: structured | narrative | full_text | ocr

      facts_extracted     INTEGER DEFAULT 0,
      sections_extracted  INTEGER DEFAULT 0,
      raw_text_length     INTEGER DEFAULT 0,

      result_json    TEXT DEFAULT '{}',
      error_text     TEXT,
      duration_ms    INTEGER,

      started_at   TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (document_id) REFERENCES case_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_extractions_document_id
      ON document_extractions(document_id);
    CREATE INDEX IF NOT EXISTS idx_doc_extractions_case_id
      ON document_extractions(case_id);

    -- ── extracted_facts (Phase 5) ─────────────────────────────────────────────
    -- Structured fact candidates pulled from documents.
    -- These are candidates — not automatically merged into facts.json.
    CREATE TABLE IF NOT EXISTS extracted_facts (
      id              TEXT PRIMARY KEY,
      extraction_id   TEXT NOT NULL,
      document_id     TEXT NOT NULL,
      case_id         TEXT NOT NULL,

      fact_path       TEXT NOT NULL,
      -- fact_path: dot-separated path e.g. "subject.address", "contract.salePrice"
      fact_value      TEXT,
      confidence      TEXT DEFAULT 'medium',
      -- confidence: high | medium | low

      source_page     INTEGER,
      source_text     TEXT,

      review_status   TEXT DEFAULT 'pending',
      -- review_status: pending | accepted | rejected | merged

      merged_at       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (extraction_id) REFERENCES document_extractions(id),
      FOREIGN KEY (document_id) REFERENCES case_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_extracted_facts_case_id
      ON extracted_facts(case_id);
    CREATE INDEX IF NOT EXISTS idx_extracted_facts_extraction_id
      ON extracted_facts(extraction_id);
    CREATE INDEX IF NOT EXISTS idx_extracted_facts_review
      ON extracted_facts(review_status);

    -- ── extracted_sections (Phase 5) ──────────────────────────────────────────
    -- Narrative sections extracted from prior appraisal PDFs.
    -- These are staged for memory review before entering the memory bank.
    CREATE TABLE IF NOT EXISTS extracted_sections (
      id              TEXT PRIMARY KEY,
      extraction_id   TEXT NOT NULL,
      document_id     TEXT NOT NULL,
      case_id         TEXT NOT NULL,

      section_type    TEXT NOT NULL,
      -- section_type: matches canonical field IDs or legacy field IDs
      section_label   TEXT,
      text            TEXT NOT NULL,
      text_hash       TEXT NOT NULL,
      word_count      INTEGER DEFAULT 0,

      source_page_start INTEGER,
      source_page_end   INTEGER,

      form_type       TEXT,
      confidence      REAL DEFAULT 0.7,

      review_status   TEXT DEFAULT 'pending',
      -- review_status: pending | approved | rejected

      promoted_memory_id TEXT,
      -- promoted_memory_id = memory_items.id after promotion to approved memory

      reviewed_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (extraction_id) REFERENCES document_extractions(id),
      FOREIGN KEY (document_id) REFERENCES case_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_extracted_sections_case_id
      ON extracted_sections(case_id);
    CREATE INDEX IF NOT EXISTS idx_extracted_sections_review
      ON extracted_sections(review_status);
    CREATE INDEX IF NOT EXISTS idx_extracted_sections_hash
      ON extracted_sections(text_hash);
  `);

  // Run column migrations for Phase 3 additions
  runMigrations(db);

  // Run Phase 6 schema additions
  // Imported at top level to keep initSchema synchronous (required by getDb())
  try {
    initPhase6Schema(db);
  } catch (err) {
    log.error('schema:phase6-init', { error: err.message });
  }

  // Run Phase 7 schema additions (QC tables)
  try {
    initPhase7Schema(db);
  } catch (err) {
    log.error('schema:phase7-init', { error: err.message });
  }

  // Run Phase 9 schema additions (insertion tracking + destination profiles)
  try {
    initPhase9Schema(db);
  } catch (err) {
    log.error('schema:phase9-init', { error: err.message });
  }

  // Run Phase 10 schema additions (business operations layer)
  try {
    initPhase10Schema(db);
  } catch (err) {
    log.error('schema:phase10-init', { error: err.message });
  }
}
