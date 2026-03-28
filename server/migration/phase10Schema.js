/**
 * server/migration/phase10Schema.js
 * -----------------------------------
 * Phase 10 — Business Operations Layer
 *
 * Schema additions:
 *   - audit_events           — unified operational audit trail
 *   - case_timeline_events   — denormalized case-centric timeline
 *   - operational_metrics    — periodic throughput/health snapshots
 *
 * These tables are additive — they do not modify existing Phase 1-9 tables.
 *
 * Usage:
 *   import { initPhase10Schema } from '../migration/phase10Schema.js';
 *   initPhase10Schema(db);
 */

/**
 * Create Phase 10 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase10Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- audit_events — Unified operational audit trail
    -- ══════════════════════════════════════════════════════════════════════════
    -- Every significant state change in the system is recorded here.
    -- This is the single source of truth for "what happened and when."
    --
    -- Retention: unlimited by default for meaningful operational history.
    -- Only transient debug/cache artifacts should ever be pruned.
    --
    -- event_type examples:
    --   case.created, case.updated, case.archived, case.restored, case.deleted
    --   assignment.context_built, assignment.intelligence_updated
    --   document.uploaded, document.classified, document.extracted, document.fact_reviewed
    --   generation.run_started, generation.run_completed, generation.run_failed
    --   generation.section_approved, generation.section_rejected, generation.section_edited
    --   memory.approved, memory.rejected, memory.deactivated, memory.reactivated
    --   qc.run_started, qc.run_completed, qc.finding_dismissed, qc.finding_resolved
    --   insertion.run_started, insertion.run_completed, insertion.run_failed
    --   insertion.item_verified, insertion.item_retried
    --   system.startup, system.export_created, system.health_check

    CREATE TABLE IF NOT EXISTS audit_events (
      id              TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      category        TEXT NOT NULL,
      -- category values: case | generation | qc | insertion | memory | document | system

      case_id         TEXT,
      entity_type     TEXT,
      -- entity_type: case | generation_run | section_job | qc_run | qc_finding |
      --              insertion_run | insertion_item | memory_item | document | extraction | fact

      entity_id       TEXT,
      actor           TEXT NOT NULL DEFAULT 'user',
      -- actor: user | system | agent | orchestrator

      summary         TEXT NOT NULL,
      detail_json     TEXT DEFAULT '{}',
      -- detail_json: structured payload with before/after state, affected fields, etc.

      severity        TEXT NOT NULL DEFAULT 'info',
      -- severity: info | warn | error

      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_case_id
      ON audit_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_event_type
      ON audit_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_events_category
      ON audit_events(category);
    CREATE INDEX IF NOT EXISTS idx_audit_events_entity
      ON audit_events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
      ON audit_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_severity
      ON audit_events(severity);

    -- ══════════════════════════════════════════════════════════════════════════
    -- case_timeline_events — Denormalized case-centric timeline
    -- ══════════════════════════════════════════════════════════════════════════
    -- Optimized for fast per-case timeline queries.
    -- Populated alongside audit_events for case-scoped operations.
    -- Includes a display_order for chronological rendering.

    CREATE TABLE IF NOT EXISTS case_timeline_events (
      id              TEXT PRIMARY KEY,
      case_id         TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      category        TEXT NOT NULL,

      summary         TEXT NOT NULL,
      entity_type     TEXT,
      entity_id       TEXT,

      -- UI display hints
      icon            TEXT,
      -- icon: create | edit | upload | extract | generate | approve | reject |
      --       qc | insert | verify | archive | restore | error | info

      detail_json     TEXT DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_case_timeline_case_id
      ON case_timeline_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_timeline_created_at
      ON case_timeline_events(case_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_case_timeline_category
      ON case_timeline_events(category);

    -- ══════════════════════════════════════════════════════════════════════════
    -- operational_metrics — Periodic throughput/health snapshots
    -- ══════════════════════════════════════════════════════════════════════════
    -- Stores aggregated metrics snapshots for dashboard views.
    -- Computed periodically (e.g., daily) from audit_events and run tables.
    --
    -- metric_type examples:
    --   daily_summary      — cases created, runs completed, sections generated
    --   case_throughput     — avg time from create to complete per case
    --   generation_stats    — success/fail rates, avg duration, token usage
    --   qc_stats            — findings by severity, resolution rates
    --   insertion_stats     — success/fail/verify rates per destination

    CREATE TABLE IF NOT EXISTS operational_metrics (
      id              TEXT PRIMARY KEY,
      metric_type     TEXT NOT NULL,
      period_start    TEXT NOT NULL,
      period_end      TEXT NOT NULL,
      data_json       TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_op_metrics_type
      ON operational_metrics(metric_type);
    CREATE INDEX IF NOT EXISTS idx_op_metrics_period
      ON operational_metrics(period_start, period_end);
  `);
}

export default { initPhase10Schema };
