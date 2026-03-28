/**
 * server/migration/phase15Schema.js
 * -----------------------------------
 * Phase 15 — Security & Governance
 *
 * Schema additions:
 *   - users                — user accounts with roles and permissions
 *   - access_policies      — role-based access control policies
 *   - access_log           — detailed access attempt logging
 *   - data_retention_rules — data retention and lifecycle management
 *   - compliance_records   — regulatory compliance tracking per case
 *
 * These tables are additive — they do not modify existing Phase 1-14 tables.
 *
 * Usage:
 *   import { initPhase15Schema } from '../migration/phase15Schema.js';
 *   initPhase15Schema(db);
 */

/**
 * Create Phase 15 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase15Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- users — User accounts with roles and permissions
    -- ══════════════════════════════════════════════════════════════════════════
    -- Central user registry for access control and audit attribution.
    -- Each user has a role that determines default permissions, plus optional
    -- granular permission overrides via permissions_json.
    --
    -- role values: admin | supervisor | appraiser | trainee | reviewer | readonly
    -- status values: active | inactive | suspended | locked

    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      username          TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL,
      email             TEXT,
      role              TEXT NOT NULL DEFAULT 'appraiser',
      status            TEXT DEFAULT 'active',
      permissions_json  TEXT,
      preferences_json  TEXT,
      last_login_at     TEXT,
      login_count       INTEGER DEFAULT 0,
      created_at        TEXT NOT NULL,
      updated_at        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username
      ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_role
      ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status
      ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_email
      ON users(email);

    -- ══════════════════════════════════════════════════════════════════════════
    -- access_policies — Role-based access control policies
    -- ══════════════════════════════════════════════════════════════════════════
    -- Defines what actions each role can perform on each resource type.
    -- Policies can include optional conditions (own_cases_only, same_office, etc.).
    --
    -- resource_type values: case | report | export | settings | admin | billing | learning
    -- actions (JSON array): read | write | create | delete | approve | export | admin

    CREATE TABLE IF NOT EXISTS access_policies (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      role              TEXT NOT NULL,
      resource_type     TEXT NOT NULL,
      actions_json      TEXT NOT NULL,
      conditions_json   TEXT,
      active            INTEGER DEFAULT 1,
      created_at        TEXT NOT NULL,
      updated_at        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_access_policies_role
      ON access_policies(role);
    CREATE INDEX IF NOT EXISTS idx_access_policies_resource_type
      ON access_policies(resource_type);
    CREATE INDEX IF NOT EXISTS idx_access_policies_active
      ON access_policies(active);

    -- ══════════════════════════════════════════════════════════════════════════
    -- access_log — Detailed access attempt logging
    -- ══════════════════════════════════════════════════════════════════════════
    -- Records every access attempt for security auditing.
    -- Includes both successful and denied accesses with denial reasons.
    --
    -- action values: read | write | create | delete | approve | export | login | logout | failed_login

    CREATE TABLE IF NOT EXISTS access_log (
      id                TEXT PRIMARY KEY,
      user_id           TEXT,
      username          TEXT,
      action            TEXT NOT NULL,
      resource_type     TEXT NOT NULL,
      resource_id       TEXT,
      case_id           TEXT,
      ip_address        TEXT,
      user_agent        TEXT,
      success           INTEGER DEFAULT 1,
      denial_reason     TEXT,
      detail_json       TEXT,
      created_at        TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_access_log_user_id
      ON access_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_access_log_action
      ON access_log(action);
    CREATE INDEX IF NOT EXISTS idx_access_log_resource_type
      ON access_log(resource_type);
    CREATE INDEX IF NOT EXISTS idx_access_log_case_id
      ON access_log(case_id);
    CREATE INDEX IF NOT EXISTS idx_access_log_created_at
      ON access_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_access_log_success
      ON access_log(success);

    -- ══════════════════════════════════════════════════════════════════════════
    -- data_retention_rules — Data retention and lifecycle management
    -- ══════════════════════════════════════════════════════════════════════════
    -- Defines retention policies for different data types.
    -- Rules are periodically evaluated to archive, delete, or anonymize
    -- data that has exceeded its retention period.
    --
    -- resource_type values: case | export | audit_log | access_log | temp_files | learning_data
    -- action values: archive | delete | anonymize

    CREATE TABLE IF NOT EXISTS data_retention_rules (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      resource_type     TEXT NOT NULL,
      retention_days    INTEGER NOT NULL,
      action            TEXT NOT NULL,
      conditions_json   TEXT,
      active            INTEGER DEFAULT 1,
      last_run_at       TEXT,
      next_run_at       TEXT,
      items_processed   INTEGER DEFAULT 0,
      created_at        TEXT NOT NULL,
      updated_at        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_data_retention_rules_resource_type
      ON data_retention_rules(resource_type);
    CREATE INDEX IF NOT EXISTS idx_data_retention_rules_active
      ON data_retention_rules(active);
    CREATE INDEX IF NOT EXISTS idx_data_retention_rules_next_run_at
      ON data_retention_rules(next_run_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- compliance_records — Regulatory compliance tracking per case
    -- ══════════════════════════════════════════════════════════════════════════
    -- Tracks compliance checks against various regulatory frameworks.
    -- Each case can have multiple compliance records for different standards.
    --
    -- compliance_type values: uspap | state_license | eao | amc_requirements | firrea | regulation_z
    -- status values: pending | compliant | non_compliant | waived | not_applicable

    CREATE TABLE IF NOT EXISTS compliance_records (
      id                TEXT PRIMARY KEY,
      case_id           TEXT,
      compliance_type   TEXT NOT NULL,
      status            TEXT DEFAULT 'pending',
      checked_at        TEXT,
      checked_by        TEXT,
      findings_json     TEXT,
      remediation_json  TEXT,
      notes             TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_compliance_records_case_id
      ON compliance_records(case_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_records_compliance_type
      ON compliance_records(compliance_type);
    CREATE INDEX IF NOT EXISTS idx_compliance_records_status
      ON compliance_records(status);
    CREATE INDEX IF NOT EXISTS idx_compliance_records_checked_at
      ON compliance_records(checked_at);
  `);
}

export default { initPhase15Schema };
