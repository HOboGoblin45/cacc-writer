/**
 * server/migration/phase21Schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 21 — Scale & Commercial Readiness
 *
 * New tables:
 *   - usage_tracking: Monthly generation usage per user
 *   - audit_log: Immutable security audit trail for SOC 2
 *   - deployment_log: Change management audit trail
 *
 * All tables are append-only (no UPDATE/DELETE).
 */

import log from '../logger.js';

export function initPhase21Schema(db) {
  try {
    // ────────────────────────────────────────────────────────────────────────────
    // usage_tracking — Per-user monthly usage tracking
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_tracking (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month             TEXT NOT NULL,
        generation_count  INTEGER DEFAULT 0,
        form_type_counts  TEXT NOT NULL DEFAULT '{}',
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, month)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_month
        ON usage_tracking(user_id, month);
      CREATE INDEX IF NOT EXISTS idx_usage_tracking_updated
        ON usage_tracking(updated_at);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // audit_log — Immutable security audit trail
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
        event       TEXT NOT NULL,
        detail      TEXT,
        ip_address  TEXT,
        user_agent  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_user
        ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_event
        ON audit_log(event);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created
        ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_event
        ON audit_log(user_id, event, created_at DESC);
    `);

    // ────────────────────────────────────────────────────────────────────────────
    // deployment_log — Change management audit trail
    // ────────────────────────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS deployment_log (
        id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        version      TEXT NOT NULL,
        deployed_by  TEXT NOT NULL,
        changes      TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_deployment_log_version
        ON deployment_log(version);
      CREATE INDEX IF NOT EXISTS idx_deployment_log_created
        ON deployment_log(created_at DESC);
    `);

    log.info('migration:phase21-complete', {
      tables: ['usage_tracking', 'audit_log', 'deployment_log'],
    });
  } catch (err) {
    log.error('migration:phase21-failed', { error: err.message });
    throw err;
  }
}

export default { initPhase21Schema };
