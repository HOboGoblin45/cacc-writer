/**
 * server/db/schema.js
 * --------------------
 * SQLite schema for Appraisal Agent orchestrator.
 * All 10 tables as specified in the architecture upgrade.
 *
 * Tables:
 *   assignments          â€” normalized assignment context per case
 *   report_plans         â€” deterministic report plan per assignment
 *   generation_runs      â€” full-draft generation run tracking
 *   section_jobs         â€” individual section job tracking within a run
 *   generated_sections   â€” output text per section job
 *   memory_items         â€” unified narrative memory store (SQLite mirror of KB)
 *   retrieval_cache      â€” cached retrieval packs per assignment (1hr TTL)
 *   analysis_artifacts   â€” structured analysis outputs (comp, market, HBU)
 *   ingest_jobs          â€” PDF ingestion job tracking
 *   staged_memory_reviews â€” items awaiting human review before promotion
 *   assignment_intelligence â€” Phase 4 intelligence bundles per case
 *   case_documents         â€” Phase 5 source files attached to cases
 *   document_extractions   â€” Phase 5 extraction job + output tracking
 *   extracted_facts        â€” Phase 5 structured fact candidates from documents
 *   extracted_sections     â€” Phase 5 narrative sections from prior reports
 */

// â”€â”€ Column migrations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
// We use try/catch per statement â€” safe to run on every startup.
// New columns added in Phase 3:
//   generation_runs.draft_package_json   â€” persists assembled draft package
//   section_jobs.retrieval_source_ids_json â€” stores example IDs used per section
//   section_jobs.estimated_cost_usd      â€” optional cost tracking

import log from '../logger.js';
import { initPhase6Schema } from '../migration/phase6Schema.js';
import { initPhase7Schema } from '../migration/phase7Schema.js';
import { initPhase9Schema } from '../migration/phase9Schema.js';
import { initPhase10Schema } from '../migration/phase10Schema.js';
import { initPhase11Schema } from '../migration/phase11Schema.js';
import { initPhase12Schema } from '../migration/phase12Schema.js';
import { initPhase13Schema } from '../migration/phase13Schema.js';
import { initPhase14Schema } from '../migration/phase14Schema.js';
import { initPhase15Schema } from '../migration/phase15Schema.js';
import { initPhase16Schema } from '../migration/phase16Schema.js';
import { initPhase17Schema } from '../migration/phase17Schema.js';
import { initPhase18Schema } from '../migration/phase18Schema.js';
import { initPhase19Schema } from '../migration/phase19Schema.js';
import { initPhase20Schema } from '../migration/phase20Schema.js';
import { initPhase21Schema } from '../migration/phase21Schema.js';
import { initPhase22Schema } from '../migration/phase22Schema.js';
import { initPhase23Schema } from '../migration/phase23Schema.js';
import { initPhase24Schema } from '../migration/phase24Schema.js';
import { initPhase25Schema } from '../migration/phase25Schema.js';
import { initPhase26Schema } from '../migration/phase26Schema.js';
import { initPipelineSchema } from '../migration/pipelineSchema.js';
import { initBrainSchema } from '../migration/brainSchema.js';
import { initPhase27Schema } from '../migration/phase27Schema.js';
import { initPhase28Schema } from '../migration/phase28Schema.js';

function runMigrations(db) {
  const migrations = [
    // Phase 3 â€” draft package persistence
    `ALTER TABLE generation_runs ADD COLUMN draft_package_json TEXT`,
    // Phase 3 â€” retrieval source IDs per section job
    `ALTER TABLE section_jobs ADD COLUMN retrieval_source_ids_json TEXT DEFAULT '[]'`,
    // Phase 3 â€” optional cost tracking per section job
    `ALTER TABLE section_jobs ADD COLUMN estimated_cost_usd REAL`,
    // Phase D â€” deterministic section policy + prompt version pinning
    `ALTER TABLE section_jobs ADD COLUMN prompt_version TEXT`,
    `ALTER TABLE section_jobs ADD COLUMN section_policy_json TEXT DEFAULT '{}'`,
    `ALTER TABLE section_jobs ADD COLUMN dependency_snapshot_json TEXT DEFAULT '{}'`,
    // Phase D â€” section audit + quality metadata
    `ALTER TABLE generated_sections ADD COLUMN audit_metadata_json TEXT DEFAULT '{}'`,
    `ALTER TABLE generated_sections ADD COLUMN quality_score REAL`,
    `ALTER TABLE generated_sections ADD COLUMN quality_metadata_json TEXT DEFAULT '{}'`,
    // Phase C document intake hardening â€” duplicate linkage
    `ALTER TABLE case_documents ADD COLUMN duplicate_of_document_id TEXT`,
    // Phase C document intake hardening â€” ingestion warning note
    `ALTER TABLE case_documents ADD COLUMN ingestion_warning TEXT`,
    // Phase D â€” section factory governance
    `ALTER TABLE generated_sections ADD COLUMN prompt_version TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN section_policy_json TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN dependency_snapshot_json TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN audit_metadata_json TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN quality_score REAL`,
    `ALTER TABLE generated_sections ADD COLUMN quality_factors_json TEXT`,
    // Phase D â€” section job governance
    `ALTER TABLE section_jobs ADD COLUMN prompt_version TEXT`,
    `ALTER TABLE section_jobs ADD COLUMN section_policy_json TEXT`,
    `ALTER TABLE section_jobs ADD COLUMN dependency_snapshot_json TEXT`,
    // Priority 3 â€” section freshness tracking
    `ALTER TABLE generated_sections ADD COLUMN freshness_status TEXT DEFAULT 'current'`,
    `ALTER TABLE generated_sections ADD COLUMN stale_reason TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN stale_since TEXT`,
    `ALTER TABLE generated_sections ADD COLUMN regeneration_count INTEGER DEFAULT 0`,
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists â€” safe to ignore
    }
  }
}

export function initSchema(db) {
  db.exec(`
    -- â”€â”€ assignments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ case_records (Phase B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ case_facts (Phase B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Canonical structured facts payload + provenance links per case.
    CREATE TABLE IF NOT EXISTS case_facts (
      case_id         TEXT PRIMARY KEY,
      facts_json      TEXT NOT NULL DEFAULT '{}',
      provenance_json TEXT NOT NULL DEFAULT '{}',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

    -- â”€â”€ case_outputs (Phase B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Canonical drafted output payload per case.
    CREATE TABLE IF NOT EXISTS case_outputs (
      case_id     TEXT PRIMARY KEY,
      outputs_json TEXT NOT NULL DEFAULT '{}',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

    -- â”€â”€ case_history (Phase B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Canonical section revision history per case.
    CREATE TABLE IF NOT EXISTS case_history (
      case_id      TEXT PRIMARY KEY,
      history_json TEXT NOT NULL DEFAULT '{}',
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES case_records(case_id) ON DELETE CASCADE
    );

    -- â”€â”€ report_plans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ generation_runs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ section_jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    CREATE TABLE IF NOT EXISTS section_jobs (
      id               TEXT PRIMARY KEY,
      run_id           TEXT NOT NULL,
      section_id       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      -- status values: pending | running | completed | failed | skipped

      generator_profile  TEXT,
      prompt_version     TEXT,
      dependencies_json  TEXT DEFAULT '[]',
      section_policy_json TEXT DEFAULT '{}',
      dependency_snapshot_json TEXT DEFAULT '{}',

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

    -- â”€â”€ generated_sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      audit_metadata_json TEXT DEFAULT '{}',
      quality_score REAL,
      quality_metadata_json TEXT DEFAULT '{}',

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

    -- â”€â”€ memory_items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Unified narrative memory store â€” SQLite mirror of the flat KB files.
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

    -- â”€â”€ retrieval_cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ analysis_artifacts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ ingest_jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ staged_memory_reviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ assignment_intelligence (Phase 4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ case_documents (Phase 5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      -- classification_method: manual | filename | keyword | ai | duplicate
      classification_confidence REAL DEFAULT 1.0,

      extraction_status TEXT DEFAULT 'pending',
      -- extraction_status: pending | extracting | extracted | failed | skipped

      text_length       INTEGER DEFAULT 0,
      notes             TEXT,
      tags_json         TEXT DEFAULT '[]',
      duplicate_of_document_id TEXT,
      ingestion_warning TEXT,

      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_documents_case_id
      ON case_documents(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_documents_doc_type
      ON case_documents(doc_type);
    -- Document ingestion job orchestration (Phase C)
    CREATE TABLE IF NOT EXISTS document_ingest_jobs (
      id                       TEXT PRIMARY KEY,
      case_id                  TEXT NOT NULL,
      document_id              TEXT,
      original_filename        TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'pending',
      -- status: pending | running | completed | failed | partial | cancelled
      current_step             TEXT,
      retry_count              INTEGER NOT NULL DEFAULT 0,
      max_retries              INTEGER NOT NULL DEFAULT 2,
      steps_json               TEXT NOT NULL DEFAULT '{}',
      error_text               TEXT,
      recoverable_actions_json TEXT NOT NULL DEFAULT '[]',
      started_at               TEXT,
      completed_at             TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES case_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_doc_ingest_jobs_case_id
      ON document_ingest_jobs(case_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_doc_ingest_jobs_status
      ON document_ingest_jobs(status, updated_at DESC);

    -- â”€â”€ document_extractions (Phase 5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â”€â”€ extracted_facts (Phase 5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    -- Structured fact candidates pulled from documents.
    -- These are candidates â€” not automatically merged into facts.json.
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

    -- â”€â”€ extracted_sections (Phase 5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    -- â€”â€” comparable intelligence (Phase D/H foundation) â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
    CREATE TABLE IF NOT EXISTS comp_candidates (
      id                 TEXT PRIMARY KEY,
      case_id            TEXT NOT NULL,
      source_key         TEXT NOT NULL,
      source_type        TEXT NOT NULL,
      source_document_id TEXT,
      review_status      TEXT NOT NULL DEFAULT 'pending',
      -- review_status: pending | held | accepted | rejected
      is_active          INTEGER NOT NULL DEFAULT 1,
      candidate_json     TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_candidates_case_source
      ON comp_candidates(case_id, source_key);
    CREATE INDEX IF NOT EXISTS idx_comp_candidates_case_active
      ON comp_candidates(case_id, is_active, review_status);

    CREATE TABLE IF NOT EXISTS comp_scores (
      id                TEXT PRIMARY KEY,
      case_id           TEXT NOT NULL,
      comp_candidate_id TEXT NOT NULL,
      overall_score     REAL NOT NULL,
      coverage_score    REAL NOT NULL DEFAULT 0,
      breakdown_json    TEXT NOT NULL DEFAULT '{}',
      weights_json      TEXT NOT NULL DEFAULT '{}',
      warnings_json     TEXT NOT NULL DEFAULT '[]',
      computed_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comp_scores_case_candidate
      ON comp_scores(case_id, comp_candidate_id);

    CREATE TABLE IF NOT EXISTS comp_tier_assignments (
      id                TEXT PRIMARY KEY,
      case_id           TEXT NOT NULL,
      comp_candidate_id TEXT NOT NULL,
      tier              TEXT NOT NULL,
      reasoning_json    TEXT NOT NULL DEFAULT '{}',
      assigned_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comp_tiers_case_candidate
      ON comp_tier_assignments(case_id, comp_candidate_id);

    CREATE TABLE IF NOT EXISTS comp_acceptance_events (
      id                     TEXT PRIMARY KEY,
      case_id                TEXT NOT NULL,
      comp_candidate_id      TEXT NOT NULL,
      accepted_by            TEXT NOT NULL DEFAULT 'appraiser',
      grid_slot              TEXT,
      ranking_score          REAL,
      visible_reasoning_json TEXT NOT NULL DEFAULT '{}',
      became_final_comp      INTEGER NOT NULL DEFAULT 0,
      note                   TEXT,
      accepted_at            TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comp_acceptance_case_candidate
      ON comp_acceptance_events(case_id, comp_candidate_id, accepted_at DESC);

    CREATE TABLE IF NOT EXISTS comp_rejection_events (
      id                     TEXT PRIMARY KEY,
      case_id                TEXT NOT NULL,
      comp_candidate_id      TEXT NOT NULL,
      rejected_by            TEXT NOT NULL DEFAULT 'appraiser',
      reason_code            TEXT NOT NULL,
      ranking_score          REAL,
      visible_reasoning_json TEXT NOT NULL DEFAULT '{}',
      note                   TEXT,
      rejected_at            TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_comp_rejection_case_candidate
      ON comp_rejection_events(case_id, comp_candidate_id, rejected_at DESC);

    CREATE TABLE IF NOT EXISTS adjustment_support_records (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT NOT NULL,
      comp_candidate_id     TEXT,
      grid_slot             TEXT NOT NULL,
      adjustment_category   TEXT NOT NULL,
      subject_value         TEXT,
      comp_value            TEXT,
      support_type          TEXT NOT NULL DEFAULT 'appraiser_judgment_with_explanation',
      support_strength      TEXT NOT NULL DEFAULT 'medium',
      suggested_amount      REAL,
      suggested_range_json  TEXT NOT NULL DEFAULT '{}',
      final_amount          REAL,
      final_range_json      TEXT NOT NULL DEFAULT '{}',
      support_evidence_json TEXT NOT NULL DEFAULT '[]',
      rationale_note        TEXT,
      decision_status       TEXT NOT NULL DEFAULT 'pending',
      recommendation_source TEXT NOT NULL DEFAULT 'heuristic_seed',
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_adjustment_support_case_slot_category
      ON adjustment_support_records(case_id, grid_slot, adjustment_category);
    CREATE INDEX IF NOT EXISTS idx_adjustment_support_case_candidate
      ON adjustment_support_records(case_id, comp_candidate_id, decision_status);

    CREATE TABLE IF NOT EXISTS adjustment_recommendations (
      id                  TEXT PRIMARY KEY,
      case_id             TEXT NOT NULL,
      comp_candidate_id   TEXT,
      grid_slot           TEXT NOT NULL,
      adjustment_category TEXT NOT NULL,
      recommendation_json TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_adjustment_recommendations_case_slot_category
      ON adjustment_recommendations(case_id, grid_slot, adjustment_category);

    CREATE TABLE IF NOT EXISTS paired_sales_library_records (
      id                  TEXT PRIMARY KEY,
      market_area         TEXT,
      property_type       TEXT,
      date_range_start    TEXT,
      date_range_end      TEXT,
      variable_analyzed   TEXT NOT NULL,
      support_method      TEXT NOT NULL,
      sample_size         INTEGER,
      conclusion          TEXT,
      confidence          TEXT,
      narrative_summary   TEXT,
      linked_assignments_json TEXT NOT NULL DEFAULT '[]',
      linked_comp_sets_json   TEXT NOT NULL DEFAULT '[]',
      creator             TEXT,
      reviewer            TEXT,
      approval_status     TEXT NOT NULL DEFAULT 'draft',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_paired_sales_library_variable
      ON paired_sales_library_records(variable_analyzed, approval_status);

    CREATE TABLE IF NOT EXISTS comp_burden_metrics (
      id                         TEXT PRIMARY KEY,
      case_id                    TEXT NOT NULL,
      comp_candidate_id          TEXT,
      grid_slot                  TEXT NOT NULL,
      gross_adjustment_percent   REAL NOT NULL DEFAULT 0,
      net_adjustment_percent     REAL NOT NULL DEFAULT 0,
      burden_by_category_json    TEXT NOT NULL DEFAULT '{}',
      major_mismatch_count       INTEGER NOT NULL DEFAULT 0,
      data_confidence_score      REAL NOT NULL DEFAULT 0,
      date_relevance_score       REAL NOT NULL DEFAULT 0,
      location_confidence_score  REAL NOT NULL DEFAULT 0,
      overall_stability_score    REAL NOT NULL DEFAULT 0,
      computed_at                TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comp_candidate_id) REFERENCES comp_candidates(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_burden_case_slot
      ON comp_burden_metrics(case_id, grid_slot);

    CREATE TABLE IF NOT EXISTS reconciliation_support_records (
      id                  TEXT PRIMARY KEY,
      case_id             TEXT NOT NULL UNIQUE,
      support_json        TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_support_case
      ON reconciliation_support_records(case_id);
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

  // Run Phase 11 schema additions (learning/memory system)
  try {
    initPhase11Schema(db);
  } catch (err) {
    log.error('schema:phase11-init', { error: err.message });
  }

  // Run Phase 12 schema additions (business operations: quotes, engagements, invoices, pipeline)
  try {
    initPhase12Schema(db);
  } catch (err) {
    log.error('schema:phase12-init', { error: err.message });
  }

  // Run Phase 13 schema additions (inspection workflow)
  try {
    initPhase13Schema(db);
  } catch (err) {
    log.error('schema:phase13-init', { error: err.message });
  }

  // Run Phase 14 schema additions (export layer)
  try {
    initPhase14Schema(db);
  } catch (err) {
    log.error('schema:phase14-init', { error: err.message });
  }

  // Run Phase 15 schema additions (security/governance)
  try {
    initPhase15Schema(db);
  } catch (err) {
    log.error('schema:phase15-init', { error: err.message });
  }

  // Run Phase 16 schema additions (contradiction resolution persistence)
  try {
    initPhase16Schema(db);
  } catch (err) {
    log.error('schema:phase16-init', { error: err.message });
  }

  // Run Phase 17 schema additions (valuation workspace tables)
  try {
    initPhase17Schema(db);
  } catch (err) {
    log.error('schema:phase17-init', { error: err.message });
  }

  // Run Phase 18 schema additions (controlled learning loop tables)
  try {
    initPhase18Schema(db);
  } catch (err) {
    log.error('schema:phase18-init', { error: err.message });
  }

  // Run Phase 19 schema additions (security completion & productization)
  try {
    initPhase19Schema(db);
  } catch (err) {
    log.error('schema:phase19-init', { error: err.message });
  }

  // Run Phase 20 schema additions (AutoTune, Voice Embeddings, STM Normalization)
  try {
    initPhase20Schema(db);
  } catch (err) {
    log.error('schema:phase20-init', { error: err.message });
  }

  // Run Phase 21 schema additions (Scale & Commercial Readiness)
  try {
    initPhase21Schema(db);
  } catch (err) {
    log.error('schema:phase21-init', { error: err.message });
  }

  // Run Phase 22 schema additions (Wave 1 Go-To-Market Infrastructure)
  try {
    initPhase22Schema(db);
  } catch (err) {
    log.error('schema:phase22-init', { error: err.message });
  }

  // Run Phase 23 schema additions (Wave 2 Commercial Billing Features)
  try {
    initPhase23Schema(db);
  } catch (err) {
    log.error('schema:phase23-init', { error: err.message });
  }

  // Run Phase 24 schema additions (Wave 2 Self-Serve Onboarding)
  try {
    initPhase24Schema(db);
  } catch (err) {
    log.error('schema:phase24-init', { error: err.message });
  }

  // Run Phase 25 schema additions (Wave 2 Integration & Auth Hardening)
  try {
    initPhase25Schema(db);
  } catch (err) {
    log.error('schema:phase25-init', { error: err.message });
  }

  // Run Phase 26 schema additions (Wave 2 Marketing — Email Campaigns, Content Assets)
  try {
    initPhase26Schema(db);
  } catch (err) {
    log.error('schema:phase26-init', { error: err.message });
  }

  // Run Pipeline schema additions (Cloudflare data pipeline)
  try {
    initPipelineSchema(db);
  } catch (err) {
    log.error('schema:pipeline-init', { error: err.message });
  }

  // Phase 1.5 — Proprietary AI Engine & Knowledge Brain
  try {
    initBrainSchema(db);
  } catch (err) {
    log.error('schema:brain-init', { error: err.message });
  }

  // Phase 27 — Self-Training Pipeline
  try {
    initPhase27Schema(db);
  } catch (err) {
    log.error('schema:phase27-init', { error: err.message });
  }

  // Phase 28 — Feedback Diffs & Training Exports
  try {
    initPhase28Schema(db);
  } catch (err) {
    log.error('schema:phase28-init', { error: err.message });
  }
}


