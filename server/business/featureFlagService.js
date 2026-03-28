/**
 * server/business/featureFlagService.js
 * ----------------------------------------
 * Feature flag management service.
 *
 * Usage:
 *   import { isEnabled, createFlag, enableFlag } from './featureFlagService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return 'ff_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function parseFlag(row) {
  if (!row) return null;
  return {
    id: row.id,
    flagKey: row.flag_key,
    description: row.description,
    enabled: !!row.enabled,
    tenantScope: row.tenant_scope,
    config: JSON.parse(row.config_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Feature Flag CRUD ────────────────────────────────────────────────────────

/**
 * Create a feature flag.
 */
export function createFlag(data) {
  const id = data.id || genId();
  const flagKey = data.flagKey || data.flag_key;
  if (!flagKey) return { error: 'flagKey is required' };

  // Check uniqueness
  const existing = dbGet('SELECT id FROM feature_flags WHERE flag_key = ?', [flagKey]);
  if (existing) return { error: 'Flag key already exists' };

  const ts = now();
  dbRun(
    `INSERT INTO feature_flags (id, flag_key, description, enabled, tenant_scope, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      flagKey,
      data.description || '',
      data.enabled ? 1 : 0,
      data.tenantScope || data.tenant_scope || 'global',
      JSON.stringify(data.config || {}),
      ts, ts,
    ]
  );

  log.info('feature-flag:created', { id, flagKey });
  return { flag: parseFlag(dbGet('SELECT * FROM feature_flags WHERE id = ?', [id])) };
}

/**
 * Get a flag by key.
 */
export function getFlag(key) {
  return parseFlag(dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key]));
}

/**
 * List all flags, optionally scoped to tenant.
 */
export function listFlags(tenantId) {
  let sql = 'SELECT * FROM feature_flags';
  const params = [];

  if (tenantId) {
    sql += ' WHERE tenant_scope = ? OR tenant_scope = ?';
    params.push(tenantId, 'global');
  }

  sql += ' ORDER BY flag_key ASC';
  const rows = dbAll(sql, params);
  return rows.map(parseFlag);
}

/**
 * Check if a flag is enabled (global or tenant-scoped).
 */
export function isEnabled(key, tenantId) {
  const flag = dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key]);
  if (!flag) return false;

  // If flag is globally enabled
  if (flag.enabled && flag.tenant_scope === 'global') return true;

  // If tenant-scoped, check if it matches
  if (tenantId && flag.tenant_scope === tenantId && flag.enabled) return true;

  // Check tenant-specific config override
  if (tenantId && flag.enabled) {
    const config = JSON.parse(flag.config_json || '{}');
    if (config.enabledTenants && Array.isArray(config.enabledTenants)) {
      return config.enabledTenants.includes(tenantId);
    }
  }

  return !!flag.enabled;
}

/**
 * Enable a flag, optionally for a specific tenant.
 */
export function enableFlag(key, tenantId) {
  const flag = dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key]);
  if (!flag) return { error: 'Flag not found' };

  if (tenantId) {
    // Enable for specific tenant by updating tenant_scope
    dbRun(
      'UPDATE feature_flags SET enabled = 1, tenant_scope = ?, updated_at = ? WHERE flag_key = ?',
      [tenantId, now(), key]
    );
  } else {
    dbRun(
      'UPDATE feature_flags SET enabled = 1, updated_at = ? WHERE flag_key = ?',
      [now(), key]
    );
  }

  log.info('feature-flag:enabled', { key, tenantId });
  return { flag: parseFlag(dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key])) };
}

/**
 * Disable a flag, optionally for a specific tenant.
 */
export function disableFlag(key, tenantId) {
  const flag = dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key]);
  if (!flag) return { error: 'Flag not found' };

  dbRun(
    'UPDATE feature_flags SET enabled = 0, updated_at = ? WHERE flag_key = ?',
    [now(), key]
  );

  log.info('feature-flag:disabled', { key, tenantId });
  return { flag: parseFlag(dbGet('SELECT * FROM feature_flags WHERE flag_key = ?', [key])) };
}

/**
 * Seed default feature flags.
 */
export function seedDefaultFlags() {
  const defaults = [
    { flagKey: 'ai_generation', description: 'Enable AI-powered report generation', enabled: true },
    { flagKey: 'document_intake', description: 'Enable document intake pipeline', enabled: true },
    { flagKey: 'comp_intelligence', description: 'Enable comparable intelligence features', enabled: true },
    { flagKey: 'export_pdf', description: 'Enable PDF export', enabled: true },
    { flagKey: 'export_xml', description: 'Enable XML/MISMO export', enabled: false },
    { flagKey: 'multi_tenant', description: 'Enable multi-tenant features', enabled: false },
    { flagKey: 'advanced_analytics', description: 'Enable advanced analytics dashboard', enabled: false },
    { flagKey: 'billing_integration', description: 'Enable billing integration', enabled: false },
  ];

  let created = 0;
  let skipped = 0;

  for (const flag of defaults) {
    const existing = dbGet('SELECT id FROM feature_flags WHERE flag_key = ?', [flag.flagKey]);
    if (existing) {
      skipped++;
      continue;
    }
    createFlag(flag);
    created++;
  }

  log.info('feature-flag:seeded', { created, skipped });
  return { created, skipped, total: defaults.length };
}

export default {
  createFlag,
  getFlag,
  listFlags,
  isEnabled,
  enableFlag,
  disableFlag,
  seedDefaultFlags,
};
