/**
 * server/migration/phase12Schema.js
 * -----------------------------------
 * Phase 12 — Business Operations: Fee Quotes, Engagements, Invoices, Pipeline
 *
 * Schema additions:
 *   - fee_quotes          — fee quote management for prospective assignments
 *   - engagement_records  — engagement/order tracking after quote acceptance
 *   - invoices            — invoicing and payment tracking
 *   - pipeline_entries    — pipeline/workflow dashboard entries
 *
 * These tables are additive — they do not modify existing Phase 1-11 tables.
 *
 * Usage:
 *   import { initPhase12Schema } from '../migration/phase12Schema.js';
 *   initPhase12Schema(db);
 */

/**
 * Create Phase 12 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase12Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- fee_quotes — Fee quote management for prospective assignments
    -- ══════════════════════════════════════════════════════════════════════════
    -- Appraisers create fee quotes before accepting assignments.
    -- Quotes can be sent, accepted, declined, expired, or converted to
    -- engagement records when the client accepts.
    --
    -- quote_status values: draft | sent | accepted | declined | expired | converted
    -- client_type values: amc | lender | attorney | private | government
    -- property_type values: sfr | condo | multi_family | manufactured | land | mixed_use | commercial
    -- form_type values: 1004 | 1073 | 2055 | 1025 | gpres
    -- complexity values: standard | complex | highly_complex

    CREATE TABLE IF NOT EXISTS fee_quotes (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT,
      client_name           TEXT NOT NULL,
      client_type           TEXT NOT NULL,
      property_address      TEXT NOT NULL,
      property_type         TEXT,
      form_type             TEXT,
      complexity            TEXT,
      rush_requested        INTEGER DEFAULT 0,
      base_fee              REAL NOT NULL,
      complexity_adjustment REAL DEFAULT 0,
      rush_fee              REAL DEFAULT 0,
      total_fee             REAL NOT NULL,
      estimated_turnaround_days INTEGER,
      quote_status          TEXT DEFAULT 'draft',
      valid_until           TEXT,
      notes                 TEXT,
      fee_schedule_json     TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT,
      accepted_at           TEXT,
      converted_case_id     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_fee_quotes_case_id
      ON fee_quotes(case_id);
    CREATE INDEX IF NOT EXISTS idx_fee_quotes_client_name
      ON fee_quotes(client_name);
    CREATE INDEX IF NOT EXISTS idx_fee_quotes_quote_status
      ON fee_quotes(quote_status);
    CREATE INDEX IF NOT EXISTS idx_fee_quotes_created_at
      ON fee_quotes(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- engagement_records — Engagement/order tracking after quote acceptance
    -- ══════════════════════════════════════════════════════════════════════════
    -- Tracks the full lifecycle of an appraisal engagement from order receipt
    -- through completion. Links to the original fee quote and case record.
    --
    -- engagement_type values: standard | rush | complex | litigation | review | desk
    -- engagement_status values: pending | accepted | active | on_hold | completed | cancelled | disputed

    CREATE TABLE IF NOT EXISTS engagement_records (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT NOT NULL,
      quote_id              TEXT,
      client_name           TEXT NOT NULL,
      client_type           TEXT NOT NULL,
      engagement_type       TEXT NOT NULL,
      engagement_status     TEXT DEFAULT 'pending',
      order_number          TEXT,
      order_date            TEXT,
      due_date              TEXT,
      accepted_date         TEXT,
      completed_date        TEXT,
      cancelled_date        TEXT,
      fee_agreed            REAL NOT NULL,
      fee_adjustments_json  TEXT,
      scope_of_work         TEXT,
      special_instructions  TEXT,
      contact_info_json     TEXT,
      status_history_json   TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_engagement_records_case_id
      ON engagement_records(case_id);
    CREATE INDEX IF NOT EXISTS idx_engagement_records_quote_id
      ON engagement_records(quote_id);
    CREATE INDEX IF NOT EXISTS idx_engagement_records_engagement_status
      ON engagement_records(engagement_status);
    CREATE INDEX IF NOT EXISTS idx_engagement_records_order_number
      ON engagement_records(order_number);
    CREATE INDEX IF NOT EXISTS idx_engagement_records_due_date
      ON engagement_records(due_date);
    CREATE INDEX IF NOT EXISTS idx_engagement_records_client_name
      ON engagement_records(client_name);

    -- ══════════════════════════════════════════════════════════════════════════
    -- invoices — Invoicing and payment tracking
    -- ══════════════════════════════════════════════════════════════════════════
    -- Full invoicing lifecycle: draft, sent, paid, partial, overdue, void.
    -- Supports line items, adjustments, payment recording, and reminders.
    --
    -- invoice_status values: draft | sent | paid | partial | overdue | void | disputed | written_off
    -- payment_terms values: net_30 | net_15 | net_45 | net_60 | due_on_receipt | custom

    CREATE TABLE IF NOT EXISTS invoices (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT NOT NULL,
      engagement_id         TEXT,
      invoice_number        TEXT NOT NULL UNIQUE,
      invoice_status        TEXT DEFAULT 'draft',
      client_name           TEXT NOT NULL,
      client_type           TEXT NOT NULL,
      billing_address       TEXT,
      line_items_json       TEXT NOT NULL,
      subtotal              REAL NOT NULL,
      adjustments_json      TEXT,
      tax_amount            REAL DEFAULT 0,
      total_amount          REAL NOT NULL,
      amount_paid           REAL DEFAULT 0,
      balance_due           REAL NOT NULL,
      payment_terms         TEXT DEFAULT 'net_30',
      issued_date           TEXT,
      due_date              TEXT,
      paid_date             TEXT,
      payment_method        TEXT,
      payment_reference     TEXT,
      notes                 TEXT,
      reminder_count        INTEGER DEFAULT 0,
      last_reminder_date    TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_case_id
      ON invoices(case_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_engagement_id
      ON invoices(engagement_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number
      ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_status
      ON invoices(invoice_status);
    CREATE INDEX IF NOT EXISTS idx_invoices_due_date
      ON invoices(due_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_client_name
      ON invoices(client_name);

    -- ══════════════════════════════════════════════════════════════════════════
    -- pipeline_entries — Pipeline/workflow dashboard entries
    -- ══════════════════════════════════════════════════════════════════════════
    -- Tracks each assignment through the full business pipeline from prospect
    -- through payment. Provides the canonical workflow dashboard view.
    --
    -- stage values: prospect | quoted | engaged | in_progress | review | submitted | invoiced | paid | closed
    -- priority values: low | normal | high | urgent

    CREATE TABLE IF NOT EXISTS pipeline_entries (
      id                    TEXT PRIMARY KEY,
      case_id               TEXT,
      quote_id              TEXT,
      engagement_id         TEXT,
      stage                 TEXT NOT NULL,
      priority              TEXT DEFAULT 'normal',
      property_address      TEXT NOT NULL,
      client_name           TEXT NOT NULL,
      form_type             TEXT,
      assigned_appraiser    TEXT,
      due_date              TEXT,
      fee                   REAL,
      notes                 TEXT,
      tags_json             TEXT,
      stage_entered_at      TEXT NOT NULL,
      stage_history_json    TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_case_id
      ON pipeline_entries(case_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_quote_id
      ON pipeline_entries(quote_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_engagement_id
      ON pipeline_entries(engagement_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_stage
      ON pipeline_entries(stage);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_priority
      ON pipeline_entries(priority);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_due_date
      ON pipeline_entries(due_date);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_assigned_appraiser
      ON pipeline_entries(assigned_appraiser);
    CREATE INDEX IF NOT EXISTS idx_pipeline_entries_client_name
      ON pipeline_entries(client_name);
  `);
}

export default { initPhase12Schema };
