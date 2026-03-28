/**
 * server/security/accessControlService.js
 * ------------------------------------------
 * Phase 15 — Access Control Service
 *
 * Role-based access control (RBAC) with policy management, access logging,
 * and aggregated access statistics.
 * All functions are synchronous (better-sqlite3).
 *
 * Usage:
 *   import { checkAccess, logAccess, seedDefaultPolicies } from './accessControlService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function genId() {
  return 'apol_' + randomUUID().slice(0, 12);
}

function genLogId() {
  return 'alog_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

// ── Default Role Policies ────────────────────────────────────────────────────

const DEFAULT_POLICIES = [
  // admin — full access to everything
  { role: 'admin', resource_type: 'case', actions: ['read', 'write', 'create', 'delete', 'approve', 'export', 'admin'] },
  { role: 'admin', resource_type: 'report', actions: ['read', 'write', 'create', 'delete', 'approve', 'export', 'admin'] },
  { role: 'admin', resource_type: 'export', actions: ['read', 'write', 'create', 'delete', 'admin'] },
  { role: 'admin', resource_type: 'settings', actions: ['read', 'write', 'admin'] },
  { role: 'admin', resource_type: 'admin', actions: ['read', 'write', 'create', 'delete', 'admin'] },
  { role: 'admin', resource_type: 'billing', actions: ['read', 'write', 'create', 'delete', 'admin'] },
  { role: 'admin', resource_type: 'learning', actions: ['read', 'write', 'create', 'delete', 'admin'] },

  // supervisor — read/write/create/approve/export on all, admin on settings
  { role: 'supervisor', resource_type: 'case', actions: ['read', 'write', 'create', 'approve', 'export'] },
  { role: 'supervisor', resource_type: 'report', actions: ['read', 'write', 'create', 'approve', 'export'] },
  { role: 'supervisor', resource_type: 'export', actions: ['read', 'write', 'create'] },
  { role: 'supervisor', resource_type: 'settings', actions: ['read', 'write', 'admin'] },
  { role: 'supervisor', resource_type: 'admin', actions: ['read'] },
  { role: 'supervisor', resource_type: 'billing', actions: ['read', 'write', 'create'] },
  { role: 'supervisor', resource_type: 'learning', actions: ['read', 'write', 'create'] },

  // appraiser — read/write/create/export on own cases, read on learning
  { role: 'appraiser', resource_type: 'case', actions: ['read', 'write', 'create', 'export'], conditions: { own_cases_only: true } },
  { role: 'appraiser', resource_type: 'report', actions: ['read', 'write', 'create', 'export'], conditions: { own_cases_only: true } },
  { role: 'appraiser', resource_type: 'export', actions: ['read', 'write', 'create'] },
  { role: 'appraiser', resource_type: 'settings', actions: ['read'] },
  { role: 'appraiser', resource_type: 'billing', actions: ['read'] },
  { role: 'appraiser', resource_type: 'learning', actions: ['read'] },

  // trainee — read/write on assigned cases only, no export/approve
  { role: 'trainee', resource_type: 'case', actions: ['read', 'write'], conditions: { assigned_only: true } },
  { role: 'trainee', resource_type: 'report', actions: ['read', 'write'], conditions: { assigned_only: true } },
  { role: 'trainee', resource_type: 'settings', actions: ['read'] },
  { role: 'trainee', resource_type: 'learning', actions: ['read'] },

  // reviewer — read/approve on assigned cases, read on reports
  { role: 'reviewer', resource_type: 'case', actions: ['read', 'approve'], conditions: { assigned_only: true } },
  { role: 'reviewer', resource_type: 'report', actions: ['read', 'approve'] },
  { role: 'reviewer', resource_type: 'export', actions: ['read'] },
  { role: 'reviewer', resource_type: 'settings', actions: ['read'] },
  { role: 'reviewer', resource_type: 'learning', actions: ['read'] },

  // readonly — read only on assigned cases
  { role: 'readonly', resource_type: 'case', actions: ['read'], conditions: { assigned_only: true } },
  { role: 'readonly', resource_type: 'report', actions: ['read'] },
  { role: 'readonly', resource_type: 'export', actions: ['read'] },
  { role: 'readonly', resource_type: 'settings', actions: ['read'] },
  { role: 'readonly', resource_type: 'learning', actions: ['read'] },
];

// ── Access Checking ──────────────────────────────────────────────────────────

/**
 * Check if a user has access to perform an action on a resource.
 *
 * @param {string} userId
 * @param {string} resourceType - case | report | export | settings | admin | billing | learning
 * @param {string} action - read | write | create | delete | approve | export | admin
 * @param {Object} [context={}] - Additional context (caseId, ownerId, etc.)
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkAccess(userId, resourceType, action, context = {}) {
  // Get user
  const user = dbGet('SELECT id, role, status, permissions_json FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { allowed: false, reason: 'User not found' };
  }

  // Check user status
  if (user.status !== 'active') {
    return { allowed: false, reason: `User account is ${user.status}` };
  }

  // Check for permission overrides first
  const overrides = parseJSON(user.permissions_json);
  if (overrides && overrides[resourceType]) {
    if (Array.isArray(overrides[resourceType]) && overrides[resourceType].includes(action)) {
      return { allowed: true, reason: 'Granted by permission override' };
    }
  }

  // Find matching active policies for this role + resource
  const policies = dbAll(
    `SELECT * FROM access_policies
     WHERE role = ? AND resource_type = ? AND active = 1
     ORDER BY created_at DESC`,
    [user.role, resourceType]
  );

  // If no policies found, check defaults
  if (policies.length === 0) {
    const defaultPolicy = DEFAULT_POLICIES.find(
      p => p.role === user.role && p.resource_type === resourceType
    );
    if (!defaultPolicy) {
      return { allowed: false, reason: `No policy found for role '${user.role}' on resource '${resourceType}'` };
    }
    if (!defaultPolicy.actions.includes(action)) {
      return { allowed: false, reason: `Action '${action}' not permitted for role '${user.role}' on resource '${resourceType}'` };
    }
    // Check conditions
    if (defaultPolicy.conditions) {
      const condResult = evaluateConditions(defaultPolicy.conditions, context);
      if (!condResult.passed) {
        return { allowed: false, reason: condResult.reason };
      }
    }
    return { allowed: true, reason: `Granted by default policy for role '${user.role}'` };
  }

  // Check stored policies
  for (const policy of policies) {
    const actions = parseJSON(policy.actions_json, []);
    if (!actions.includes(action)) continue;

    const conditions = parseJSON(policy.conditions_json);
    if (conditions) {
      const condResult = evaluateConditions(conditions, context);
      if (!condResult.passed) continue;
    }

    return { allowed: true, reason: `Granted by policy '${policy.name}'` };
  }

  return { allowed: false, reason: `Action '${action}' not permitted for role '${user.role}' on resource '${resourceType}'` };
}

/**
 * Evaluate conditions against context.
 *
 * @param {Object} conditions
 * @param {Object} context
 * @returns {{ passed: boolean, reason: string }}
 */
function evaluateConditions(conditions, context) {
  if (conditions.own_cases_only && context.ownerId && context.userId) {
    if (context.ownerId !== context.userId) {
      return { passed: false, reason: 'Access restricted to own cases only' };
    }
  }
  if (conditions.assigned_only && context.assignedTo && context.userId) {
    if (!context.assignedTo.includes(context.userId)) {
      return { passed: false, reason: 'Access restricted to assigned cases only' };
    }
  }
  if (conditions.same_office && context.userOffice && context.caseOffice) {
    if (context.userOffice !== context.caseOffice) {
      return { passed: false, reason: 'Access restricted to same office' };
    }
  }
  return { passed: true, reason: 'Conditions met' };
}

// ── Policy CRUD ──────────────────────────────────────────────────────────────

/**
 * Create an access policy.
 *
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function createPolicy(data) {
  if (!data.name || !data.role || !data.resource_type || !data.actions) {
    return { error: 'name, role, resource_type, and actions are required' };
  }

  const id = genId();
  const ts = now();

  try {
    dbRun(
      `INSERT INTO access_policies (id, name, description, role, resource_type, actions_json, conditions_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.description || null,
        data.role,
        data.resource_type,
        toJSON(data.actions),
        toJSON(data.conditions),
        data.active !== undefined ? (data.active ? 1 : 0) : 1,
        ts,
        ts,
      ]
    );

    log.info('access-policy:created', { id, name: data.name, role: data.role });
    return { id };
  } catch (err) {
    log.error('access-policy:create-error', { error: err.message });
    return { error: err.message };
  }
}

/**
 * Get a policy by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getPolicy(id) {
  const row = dbGet('SELECT * FROM access_policies WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    actions: parseJSON(row.actions_json, []),
    conditions: parseJSON(row.conditions_json),
  };
}

/**
 * List policies with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.role]
 * @param {string} [opts.resource_type]
 * @param {boolean} [opts.active]
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {{ policies: Object[], total: number }}
 */
export function listPolicies(opts = {}) {
  const conditions = [];
  const params = [];

  if (opts.role) {
    conditions.push('role = ?');
    params.push(opts.role);
  }
  if (opts.resource_type) {
    conditions.push('resource_type = ?');
    params.push(opts.resource_type);
  }
  if (opts.active !== undefined) {
    conditions.push('active = ?');
    params.push(opts.active ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 100;
  const offset = opts.offset || 0;

  const countRow = dbGet(`SELECT COUNT(*) AS n FROM access_policies ${where}`, params);
  const total = countRow?.n ?? 0;

  const rows = dbAll(
    `SELECT * FROM access_policies ${where} ORDER BY role, resource_type LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const policies = rows.map(row => ({
    ...row,
    actions: parseJSON(row.actions_json, []),
    conditions: parseJSON(row.conditions_json),
  }));

  return { policies, total };
}

/**
 * Update a policy.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updatePolicy(id, updates) {
  const policy = dbGet('SELECT id FROM access_policies WHERE id = ?', [id]);
  if (!policy) return { error: 'Policy not found' };

  const allowedFields = ['name', 'description', 'role', 'resource_type', 'active'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'actions') {
      setClauses.push('actions_json = ?');
      params.push(toJSON(value));
    } else if (key === 'conditions') {
      setClauses.push('conditions_json = ?');
      params.push(toJSON(value));
    } else if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(key === 'active' ? (value ? 1 : 0) : value);
    }
  }

  if (setClauses.length === 0) return { error: 'No valid fields to update' };

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  try {
    dbRun(`UPDATE access_policies SET ${setClauses.join(', ')} WHERE id = ?`, params);
    log.info('access-policy:updated', { id });
    return { ok: true };
  } catch (err) {
    log.error('access-policy:update-error', { error: err.message, id });
    return { error: err.message };
  }
}

/**
 * Delete a policy.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deletePolicy(id) {
  const policy = dbGet('SELECT id FROM access_policies WHERE id = ?', [id]);
  if (!policy) return { error: 'Policy not found' };

  dbRun('DELETE FROM access_policies WHERE id = ?', [id]);
  log.info('access-policy:deleted', { id });
  return { ok: true };
}

/**
 * Get the built-in default policies for all roles.
 *
 * @returns {Object[]}
 */
export function getDefaultPolicies() {
  return DEFAULT_POLICIES.map(p => ({
    role: p.role,
    resource_type: p.resource_type,
    actions: p.actions,
    conditions: p.conditions || null,
  }));
}

/**
 * Seed default policies into the database if none exist.
 *
 * @returns {{ created: number }}
 */
export function seedDefaultPolicies() {
  const existing = dbGet('SELECT COUNT(*) AS n FROM access_policies');
  if (existing && existing.n > 0) {
    return { created: 0, message: 'Policies already exist — skipping seed' };
  }

  let created = 0;
  dbTransaction(() => {
    for (const policy of DEFAULT_POLICIES) {
      const id = genId();
      const ts = now();
      dbRun(
        `INSERT INTO access_policies (id, name, description, role, resource_type, actions_json, conditions_json, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          `${policy.role}:${policy.resource_type}`,
          `Default ${policy.role} policy for ${policy.resource_type}`,
          policy.role,
          policy.resource_type,
          JSON.stringify(policy.actions),
          policy.conditions ? JSON.stringify(policy.conditions) : null,
          1,
          ts,
          ts,
        ]
      );
      created++;
    }
  });

  log.info('access-policy:seeded', { created });
  return { created };
}

// ── Access Logging ───────────────────────────────────────────────────────────

/**
 * Record an access attempt in the access_log.
 *
 * @param {Object} data
 * @returns {{ id: string }}
 */
export function logAccess(data) {
  const id = genLogId();
  const ts = now();

  try {
    dbRun(
      `INSERT INTO access_log (id, user_id, username, action, resource_type, resource_id, case_id, ip_address, user_agent, success, denial_reason, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.user_id || null,
        data.username || null,
        data.action,
        data.resource_type,
        data.resource_id || null,
        data.case_id || null,
        data.ip_address || null,
        data.user_agent || null,
        data.success !== undefined ? (data.success ? 1 : 0) : 1,
        data.denial_reason || null,
        toJSON(data.detail),
        ts,
      ]
    );
    return { id };
  } catch (err) {
    log.error('access-log:write-error', { error: err.message });
    return { id: null, error: err.message };
  }
}

/**
 * Query access log with filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.userId]
 * @param {string} [opts.action]
 * @param {string} [opts.resourceType]
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {{ entries: Object[], total: number }}
 */
export function getAccessLog(opts = {}) {
  const conditions = [];
  const params = [];

  if (opts.userId) {
    conditions.push('user_id = ?');
    params.push(opts.userId);
  }
  if (opts.action) {
    conditions.push('action = ?');
    params.push(opts.action);
  }
  if (opts.resourceType) {
    conditions.push('resource_type = ?');
    params.push(opts.resourceType);
  }
  if (opts.since) {
    conditions.push('created_at >= ?');
    params.push(opts.since);
  }
  if (opts.until) {
    conditions.push('created_at <= ?');
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 100;
  const offset = opts.offset || 0;

  const countRow = dbGet(`SELECT COUNT(*) AS n FROM access_log ${where}`, params);
  const total = countRow?.n ?? 0;

  const entries = dbAll(
    `SELECT * FROM access_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    entries: entries.map(e => ({
      ...e,
      detail: parseJSON(e.detail_json),
    })),
    total,
  };
}

/**
 * Get aggregated access statistics.
 *
 * @param {string} [since] - ISO 8601 timestamp
 * @returns {Object} Aggregated stats
 */
export function getAccessStats(since) {
  const sinceClause = since ? 'WHERE created_at >= ?' : '';
  const sinceParams = since ? [since] : [];

  const totalRow = dbGet(`SELECT COUNT(*) AS n FROM access_log ${sinceClause}`, sinceParams);
  const successRow = dbGet(`SELECT COUNT(*) AS n FROM access_log ${sinceClause ? sinceClause + ' AND' : 'WHERE'} success = 1`, sinceParams);
  const failedRow = dbGet(`SELECT COUNT(*) AS n FROM access_log ${sinceClause ? sinceClause + ' AND' : 'WHERE'} success = 0`, sinceParams);

  const byAction = dbAll(
    `SELECT action, COUNT(*) AS count FROM access_log ${sinceClause} GROUP BY action ORDER BY count DESC`,
    sinceParams
  );

  const byResource = dbAll(
    `SELECT resource_type, COUNT(*) AS count FROM access_log ${sinceClause} GROUP BY resource_type ORDER BY count DESC`,
    sinceParams
  );

  const recentFailures = dbAll(
    `SELECT * FROM access_log ${sinceClause ? sinceClause + ' AND' : 'WHERE'} success = 0 ORDER BY created_at DESC LIMIT 20`,
    sinceParams
  );

  return {
    total: totalRow?.n ?? 0,
    successful: successRow?.n ?? 0,
    failed: failedRow?.n ?? 0,
    byAction,
    byResource,
    recentFailures: recentFailures.map(e => ({
      ...e,
      detail: parseJSON(e.detail_json),
    })),
  };
}

export default {
  checkAccess,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  deletePolicy,
  getDefaultPolicies,
  seedDefaultPolicies,
  logAccess,
  getAccessLog,
  getAccessStats,
};
