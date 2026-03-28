/**
 * server/migration/phase14Schema.js
 * -----------------------------------
 * Phase 14 — Export Layer
 *
 * Schema additions:
 *   - export_jobs        — export job tracking (PDF, MISMO XML, bundles, etc.)
 *   - delivery_records   — delivery attempt tracking and confirmation
 *   - export_templates   — reusable export configuration templates
 *
 * These tables are additive — they do not modify existing Phase 1-13 tables.
 *
 * Usage:
 *   import { initPhase14Schema } from '../migration/phase14Schema.js';
 *   initPhase14Schema(db);
 */

/**
 * Create Phase 14 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase14Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- export_jobs — Export job tracking
    -- ══════════════════════════════════════════════════════════════════════════
    -- Tracks each export operation: PDF generation, MISMO XML, bundles, CSV, etc.
    -- Jobs progress through queued -> processing -> completed/failed/cancelled.
    --
    -- export_type values: pdf | xml_mismo | bundle | csv | json_archive
    -- export_status values: queued | processing | completed | failed | cancelled
    -- output_format values: pdf_1004 | pdf_1073 | mismo_2_6 | mismo_3_4 | zip_bundle | csv_comps
    -- watermark values: draft | final | review | none
    -- delivery_method values: download | email | portal | ead
    -- delivery_status values: pending | delivered | confirmed | bounced

    CREATE TABLE IF NOT EXISTS export_jobs (
      id                TEXT PRIMARY KEY,
      case_id           TEXT NOT NULL,
      export_type       TEXT NOT NULL,
      export_status     TEXT DEFAULT 'queued',
      output_format     TEXT,
      file_path         TEXT,
      file_name         TEXT,
      file_size         INTEGER,
      page_count        INTEGER,
      include_photos    INTEGER DEFAULT 1,
      include_addenda   INTEGER DEFAULT 1,
      include_maps      INTEGER DEFAULT 1,
      include_sketches  INTEGER DEFAULT 1,
      watermark         TEXT DEFAULT 'none',
      recipient_name    TEXT,
      recipient_email   TEXT,
      delivery_method   TEXT,
      delivery_status   TEXT DEFAULT 'pending',
      delivered_at      TEXT,
      options_json      TEXT,
      error_message     TEXT,
      started_at        TEXT,
      completed_at      TEXT,
      duration_ms       INTEGER,
      created_at        TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_export_jobs_case_id
      ON export_jobs(case_id);
    CREATE INDEX IF NOT EXISTS idx_export_jobs_export_type
      ON export_jobs(export_type);
    CREATE INDEX IF NOT EXISTS idx_export_jobs_export_status
      ON export_jobs(export_status);
    CREATE INDEX IF NOT EXISTS idx_export_jobs_created_at
      ON export_jobs(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- delivery_records — Delivery attempt tracking and confirmation
    -- ══════════════════════════════════════════════════════════════════════════
    -- Records each delivery attempt for an export job. Supports multiple
    -- delivery methods and confirmation tracking.
    --
    -- delivery_method values: download | email | portal | ead
    -- delivery_status values: pending | sent | delivered | confirmed | failed | bounced
    -- confirmation_method values: read_receipt | portal_confirm | manual

    CREATE TABLE IF NOT EXISTS delivery_records (
      id                  TEXT PRIMARY KEY,
      export_job_id       TEXT NOT NULL,
      case_id             TEXT NOT NULL,
      delivery_method     TEXT NOT NULL,
      recipient_name      TEXT,
      recipient_email     TEXT,
      portal_name         TEXT,
      tracking_number     TEXT,
      delivery_status     TEXT DEFAULT 'pending',
      sent_at             TEXT,
      delivered_at        TEXT,
      confirmed_at        TEXT,
      confirmation_method TEXT,
      notes               TEXT,
      error_message       TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_records_export_job_id
      ON delivery_records(export_job_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_records_case_id
      ON delivery_records(case_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_records_delivery_status
      ON delivery_records(delivery_status);
    CREATE INDEX IF NOT EXISTS idx_delivery_records_delivery_method
      ON delivery_records(delivery_method);

    -- ══════════════════════════════════════════════════════════════════════════
    -- export_templates — Reusable export configuration templates
    -- ══════════════════════════════════════════════════════════════════════════
    -- Stores reusable export configurations so appraisers can quickly apply
    -- consistent settings (e.g., "AMC Standard PDF", "VA MISMO 3.4").
    --
    -- export_type values: pdf | xml_mismo | bundle | csv | json_archive
    -- form_type values: 1004 | 1073 | 2055 | 1025

    CREATE TABLE IF NOT EXISTS export_templates (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      export_type     TEXT NOT NULL,
      form_type       TEXT,
      description     TEXT,
      config_json     TEXT NOT NULL,
      is_default      INTEGER DEFAULT 0,
      active          INTEGER DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_export_templates_export_type
      ON export_templates(export_type);
    CREATE INDEX IF NOT EXISTS idx_export_templates_form_type
      ON export_templates(form_type);
    CREATE INDEX IF NOT EXISTS idx_export_templates_active
      ON export_templates(active);
  `);
}

export default { initPhase14Schema };
