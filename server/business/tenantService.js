/**
 * server/business/tenantService.js
 * ----------------------------------
 * Multi-tenant configuration service.
 *
 * Usage:
 *   import { createTenant, getTenant, listTenants } from './tenantService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return 'tnt_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function parseTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantName: row.tenant_name,
    displayName: row.display_name,
    status: row.status,
    settings: JSON.parse(row.settings_json || '{}'),
    featureFlags: JSON.parse(row.feature_flags_json || '{}'),
    billingPlan: row.billing_plan,
    billingStatus: row.billing_status,
    maxUsers: row.max_users,
    maxCases: row.max_cases,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Tenant CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a new tenant.
 */
export function createTenant(data) {
  const id = data.id || genId();
  const tenantName = data.tenantName || data.tenant_name;
  if (!tenantName) return { error: 'tenantName is required' };

  // Check uniqueness
  const existing = dbGet('SELECT id FROM tenant_configs WHERE tenant_name = ?', [tenantName]);
  if (existing) return { error: 'Tenant name already exists' };

  const ts = now();
  dbRun(
    `INSERT INTO tenant_configs (id, tenant_name, display_name, status, settings_json, feature_flags_json, billing_plan, billing_status, max_users, max_cases, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, '{}', ?, 'active', ?, ?, ?, ?)`,
    [
      id,
      tenantName,
      data.displayName || data.display_name || tenantName,
      JSON.stringify(data.settings || {}),
      data.billingPlan || data.billing_plan || 'standard',
      data.maxUsers || data.max_users || 10,
      data.maxCases || data.max_cases || 1000,
      ts, ts,
    ]
  );

  log.info('tenant:created', { id, tenantName });
  return { tenant: parseTenant(dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id])) };
}

/**
 * Get tenant by ID.
 */
export function getTenant(id) {
  return parseTenant(dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id]));
}

/**
 * Get tenant by name.
 */
export function getTenantByName(name) {
  return parseTenant(dbGet('SELECT * FROM tenant_configs WHERE tenant_name = ?', [name]));
}

/**
 * List tenants with optional filters.
 */
export function listTenants(filters = {}) {
  let sql = 'SELECT * FROM tenant_configs WHERE 1=1';
  const params = [];

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.billingPlan || filters.billing_plan) {
    sql += ' AND billing_plan = ?';
    params.push(filters.billingPlan || filters.billing_plan);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(filters.limit, 10));
  }
  if (filters.offset) {
    sql += ' OFFSET ?';
    params.push(parseInt(filters.offset, 10));
  }

  const rows = dbAll(sql, params);
  return rows.map(parseTenant);
}

/**
 * Update tenant settings.
 */
export function updateTenant(id, updates) {
  const existing = dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id]);
  if (!existing) return { error: 'Tenant not found' };

  const fields = [];
  const params = [];

  if (updates.displayName !== undefined || updates.display_name !== undefined) {
    fields.push('display_name = ?');
    params.push(updates.displayName || updates.display_name);
  }
  if (updates.settings !== undefined) {
    fields.push('settings_json = ?');
    params.push(JSON.stringify(updates.settings));
  }
  if (updates.featureFlags !== undefined || updates.feature_flags !== undefined) {
    fields.push('feature_flags_json = ?');
    params.push(JSON.stringify(updates.featureFlags || updates.feature_flags));
  }
  if (updates.billingPlan !== undefined || updates.billing_plan !== undefined) {
    fields.push('billing_plan = ?');
    params.push(updates.billingPlan || updates.billing_plan);
  }
  if (updates.maxUsers !== undefined || updates.max_users !== undefined) {
    fields.push('max_users = ?');
    params.push(updates.maxUsers || updates.max_users);
  }
  if (updates.maxCases !== undefined || updates.max_cases !== undefined) {
    fields.push('max_cases = ?');
    params.push(updates.maxCases || updates.max_cases);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    params.push(updates.status);
  }

  if (fields.length === 0) return { tenant: parseTenant(existing) };

  fields.push('updated_at = ?');
  params.push(now());
  params.push(id);

  dbRun(`UPDATE tenant_configs SET ${fields.join(', ')} WHERE id = ?`, params);

  log.info('tenant:updated', { id });
  return { tenant: parseTenant(dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id])) };
}

/**
 * Deactivate a tenant.
 */
export function deactivateTenant(id) {
  const existing = dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id]);
  if (!existing) return { error: 'Tenant not found' };

  dbRun(
    'UPDATE tenant_configs SET status = ?, updated_at = ? WHERE id = ?',
    ['inactive', now(), id]
  );

  log.info('tenant:deactivated', { id });
  return { tenant: parseTenant(dbGet('SELECT * FROM tenant_configs WHERE id = ?', [id])) };
}

/**
 * Get tenant usage statistics.
 */
export function getTenantUsage(id) {
  const tenant = getTenant(id);
  if (!tenant) return { error: 'Tenant not found' };

  // Count users and cases (in a real multi-tenant system these would be filtered by tenant_id)
  let userCount = 0;
  let caseCount = 0;
  try {
    const users = dbGet('SELECT COUNT(*) AS n FROM users');
    userCount = users?.n || 0;
  } catch { /* table may not exist */ }
  try {
    const cases = dbGet('SELECT COUNT(*) AS n FROM case_records');
    caseCount = cases?.n || 0;
  } catch { /* table may not exist */ }

  return {
    tenantId: id,
    userCount,
    caseCount,
    maxUsers: tenant.maxUsers,
    maxCases: tenant.maxCases,
    usersUtilization: tenant.maxUsers > 0 ? (userCount / tenant.maxUsers * 100).toFixed(1) + '%' : '0%',
    casesUtilization: tenant.maxCases > 0 ? (caseCount / tenant.maxCases * 100).toFixed(1) + '%' : '0%',
  };
}

export default {
  createTenant,
  getTenant,
  getTenantByName,
  listTenants,
  updateTenant,
  deactivateTenant,
  getTenantUsage,
};
