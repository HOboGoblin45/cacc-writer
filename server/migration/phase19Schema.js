/**
 * server/migration/phase19Schema.js
 * -----------------------------------
 * Phase 19 — Security Completion & Productization
 *
 * Schema additions:
 *   - encryption_keys     — key metadata for field-level encryption
 *   - backup_records      — backup history and metadata
 *   - backup_schedule     — automated backup scheduling config
 *   - tenant_configs      — multi-tenant configuration
 *   - feature_flags       — feature flag management
 *   - billing_events      — billing event tracking
 *
 * These tables are additive — they do not modify existing tables.
 *
 * Usage:
 *   import { initPhase19Schema } from '../migration/phase19Schema.js';
 *   initPhase19Schema(db);
 */

/**
 * Create Phase 19 tables.
 * Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function initPhase19Schema(db) {
  db.exec(`
    -- ══════════════════════════════════════════════════════════════════════════
    -- encryption_keys — Key metadata for field-level encryption
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS encryption_keys (
      id TEXT PRIMARY KEY,
      key_alias TEXT NOT NULL UNIQUE,
      algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      rotated_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_encryption_keys_alias
      ON encryption_keys(key_alias);
    CREATE INDEX IF NOT EXISTS idx_encryption_keys_status
      ON encryption_keys(status);

    -- ══════════════════════════════════════════════════════════════════════════
    -- backup_records — Backup history and metadata
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      backup_type TEXT NOT NULL DEFAULT 'full',
      file_path TEXT,
      file_size_bytes INTEGER,
      file_hash TEXT,
      table_counts_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'completed',
      error_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backup_records_status
      ON backup_records(status);
    CREATE INDEX IF NOT EXISTS idx_backup_records_created_at
      ON backup_records(created_at);

    -- ══════════════════════════════════════════════════════════════════════════
    -- backup_schedule — Automated backup scheduling configuration
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS backup_schedule (
      id TEXT PRIMARY KEY DEFAULT 'default',
      interval_hours INTEGER NOT NULL DEFAULT 24,
      retention_days INTEGER NOT NULL DEFAULT 30,
      max_backups INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ══════════════════════════════════════════════════════════════════════════
    -- tenant_configs — Multi-tenant configuration
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS tenant_configs (
      id TEXT PRIMARY KEY,
      tenant_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      settings_json TEXT NOT NULL DEFAULT '{}',
      feature_flags_json TEXT NOT NULL DEFAULT '{}',
      billing_plan TEXT DEFAULT 'standard',
      billing_status TEXT DEFAULT 'active',
      max_users INTEGER DEFAULT 10,
      max_cases INTEGER DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tenant_configs_name
      ON tenant_configs(tenant_name);
    CREATE INDEX IF NOT EXISTS idx_tenant_configs_status
      ON tenant_configs(status);

    -- ══════════════════════════════════════════════════════════════════════════
    -- feature_flags — Feature flag management
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      flag_key TEXT NOT NULL UNIQUE,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      tenant_scope TEXT DEFAULT 'global',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feature_flags_key
      ON feature_flags(flag_key);
    CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled
      ON feature_flags(enabled);

    -- ══════════════════════════════════════════════════════════════════════════
    -- billing_events — Billing event tracking
    -- ══════════════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      event_type TEXT NOT NULL,
      amount REAL,
      currency TEXT DEFAULT 'USD',
      description TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_id
      ON billing_events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_billing_events_event_type
      ON billing_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_billing_events_created_at
      ON billing_events(created_at);
  `);
}

export default { initPhase19Schema };
