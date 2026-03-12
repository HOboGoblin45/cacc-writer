/**
 * server/security/userService.js
 * --------------------------------
 * Phase 15 — User Management Service
 *
 * CRUD operations for user accounts, login tracking, and permission resolution.
 * All functions are synchronous (better-sqlite3).
 *
 * Usage:
 *   import { createUser, getUser, listUsers } from './userService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function genId() {
  return 'usr_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

// ── Default role permissions ─────────────────────────────────────────────────

const DEFAULT_ROLE_PERMISSIONS = {
  admin: {
    case: ['read', 'write', 'create', 'delete', 'approve', 'export', 'admin'],
    report: ['read', 'write', 'create', 'delete', 'approve', 'export', 'admin'],
    export: ['read', 'write', 'create', 'delete', 'admin'],
    settings: ['read', 'write', 'admin'],
    admin: ['read', 'write', 'create', 'delete', 'admin'],
    billing: ['read', 'write', 'create', 'delete', 'admin'],
    learning: ['read', 'write', 'create', 'delete', 'admin'],
  },
  supervisor: {
    case: ['read', 'write', 'create', 'approve', 'export'],
    report: ['read', 'write', 'create', 'approve', 'export'],
    export: ['read', 'write', 'create'],
    settings: ['read', 'write', 'admin'],
    admin: ['read'],
    billing: ['read', 'write', 'create'],
    learning: ['read', 'write', 'create'],
  },
  appraiser: {
    case: ['read', 'write', 'create', 'export'],
    report: ['read', 'write', 'create', 'export'],
    export: ['read', 'write', 'create'],
    settings: ['read'],
    admin: [],
    billing: ['read'],
    learning: ['read'],
  },
  trainee: {
    case: ['read', 'write'],
    report: ['read', 'write'],
    export: [],
    settings: ['read'],
    admin: [],
    billing: [],
    learning: ['read'],
  },
  reviewer: {
    case: ['read', 'approve'],
    report: ['read', 'approve'],
    export: ['read'],
    settings: ['read'],
    admin: [],
    billing: [],
    learning: ['read'],
  },
  readonly: {
    case: ['read'],
    report: ['read'],
    export: ['read'],
    settings: ['read'],
    admin: [],
    billing: [],
    learning: ['read'],
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new user.
 *
 * @param {Object} data
 * @param {string} data.username
 * @param {string} data.display_name
 * @param {string} [data.email]
 * @param {string} [data.role='appraiser']
 * @param {string} [data.status='active']
 * @param {Object} [data.permissions]
 * @param {Object} [data.preferences]
 * @returns {{ id: string } | { error: string }}
 */
export function createUser(data) {
  if (!data.username || !data.display_name) {
    return { error: 'username and display_name are required' };
  }

  const validRoles = ['admin', 'supervisor', 'appraiser', 'trainee', 'reviewer', 'readonly'];
  const role = data.role || 'appraiser';
  if (!validRoles.includes(role)) {
    return { error: `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}` };
  }

  // Check for duplicate username
  const existing = dbGet('SELECT id FROM users WHERE username = ?', [data.username]);
  if (existing) {
    return { error: `Username already exists: ${data.username}` };
  }

  const id = genId();
  const ts = now();

  try {
    dbRun(
      `INSERT INTO users (id, username, display_name, email, role, status, permissions_json, preferences_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.username,
        data.display_name,
        data.email || null,
        role,
        data.status || 'active',
        toJSON(data.permissions),
        toJSON(data.preferences),
        ts,
        ts,
      ]
    );

    log.info('user:created', { id, username: data.username, role });
    return { id, username: data.username, role };
  } catch (err) {
    log.error('user:create-error', { error: err.message, username: data.username });
    return { error: err.message };
  }
}

/**
 * Get a user by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getUser(id) {
  const row = dbGet('SELECT * FROM users WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    permissions: parseJSON(row.permissions_json),
    preferences: parseJSON(row.preferences_json),
  };
}

/**
 * Get a user by username.
 *
 * @param {string} username
 * @returns {Object|null}
 */
export function getUserByUsername(username) {
  const row = dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!row) return null;
  return {
    ...row,
    permissions: parseJSON(row.permissions_json),
    preferences: parseJSON(row.preferences_json),
  };
}

/**
 * List users with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.role]
 * @param {string} [opts.status]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {{ users: Object[], total: number }}
 */
export function listUsers(opts = {}) {
  const conditions = [];
  const params = [];

  if (opts.role) {
    conditions.push('role = ?');
    params.push(opts.role);
  }
  if (opts.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const countRow = dbGet(`SELECT COUNT(*) AS n FROM users ${where}`, params);
  const total = countRow?.n ?? 0;

  const rows = dbAll(
    `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const users = rows.map(row => ({
    ...row,
    permissions: parseJSON(row.permissions_json),
    preferences: parseJSON(row.preferences_json),
  }));

  return { users, total };
}

/**
 * Update user fields.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateUser(id, updates) {
  const user = dbGet('SELECT id FROM users WHERE id = ?', [id]);
  if (!user) return { error: 'User not found' };

  const allowedFields = ['display_name', 'email', 'role', 'status', 'permissions_json', 'preferences_json'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'permissions') {
      setClauses.push('permissions_json = ?');
      params.push(toJSON(value));
    } else if (key === 'preferences') {
      setClauses.push('preferences_json = ?');
      params.push(toJSON(value));
    } else if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return { error: 'No valid fields to update' };

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  try {
    dbRun(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);
    log.info('user:updated', { id, fields: Object.keys(updates) });
    return { ok: true };
  } catch (err) {
    log.error('user:update-error', { error: err.message, id });
    return { error: err.message };
  }
}

/**
 * Deactivate a user (set status to 'inactive').
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deactivateUser(id) {
  const user = dbGet('SELECT id, status FROM users WHERE id = ?', [id]);
  if (!user) return { error: 'User not found' };

  dbRun('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['inactive', now(), id]);
  log.info('user:deactivated', { id });
  return { ok: true };
}

/**
 * Suspend a user with a reason.
 *
 * @param {string} id
 * @param {string} [reason]
 * @returns {{ ok: boolean } | { error: string }}
 */
export function suspendUser(id, reason) {
  const user = dbGet('SELECT id, status FROM users WHERE id = ?', [id]);
  if (!user) return { error: 'User not found' };

  const ts = now();
  dbRun('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['suspended', ts, id]);

  // Log the suspension reason in the access log
  dbRun(
    `INSERT INTO access_log (id, user_id, action, resource_type, resource_id, success, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'alog_' + randomUUID().slice(0, 12),
      id,
      'write',
      'admin',
      id,
      1,
      JSON.stringify({ action: 'suspend', reason: reason || 'No reason provided' }),
      ts,
    ]
  );

  log.info('user:suspended', { id, reason });
  return { ok: true };
}

/**
 * Reactivate a user (set status to 'active').
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function reactivateUser(id) {
  const user = dbGet('SELECT id, status FROM users WHERE id = ?', [id]);
  if (!user) return { error: 'User not found' };

  dbRun('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['active', now(), id]);
  log.info('user:reactivated', { id });
  return { ok: true };
}

/**
 * Record a successful login for a user.
 *
 * @param {string} id
 * @param {string} [ipAddress]
 * @param {string} [userAgent]
 * @returns {{ ok: boolean } | { error: string }}
 */
export function recordLogin(id, ipAddress, userAgent) {
  const user = dbGet('SELECT id, username, login_count FROM users WHERE id = ?', [id]);
  if (!user) return { error: 'User not found' };

  const ts = now();
  dbRun(
    'UPDATE users SET last_login_at = ?, login_count = ?, updated_at = ? WHERE id = ?',
    [ts, (user.login_count || 0) + 1, ts, id]
  );

  // Record in access_log
  dbRun(
    `INSERT INTO access_log (id, user_id, username, action, resource_type, ip_address, user_agent, success, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'alog_' + randomUUID().slice(0, 12),
      id,
      user.username,
      'login',
      'admin',
      ipAddress || null,
      userAgent || null,
      1,
      ts,
    ]
  );

  log.info('user:login', { id, username: user.username });
  return { ok: true };
}

/**
 * Record a failed login attempt.
 *
 * @param {string} username
 * @param {string} [ipAddress]
 * @returns {{ ok: boolean }}
 */
export function recordFailedLogin(username, ipAddress) {
  const ts = now();

  // Look up user_id if user exists
  const user = dbGet('SELECT id FROM users WHERE username = ?', [username]);

  dbRun(
    `INSERT INTO access_log (id, user_id, username, action, resource_type, ip_address, success, denial_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'alog_' + randomUUID().slice(0, 12),
      user?.id || null,
      username,
      'failed_login',
      'admin',
      ipAddress || null,
      0,
      'Invalid credentials',
      ts,
    ]
  );

  log.warn('user:failed-login', { username, ipAddress });
  return { ok: true };
}

/**
 * Get effective permissions for a user (role defaults + overrides).
 *
 * @param {string} userId
 * @returns {Object|null} Merged permission map: { resourceType: [actions] }
 */
export function getUserPermissions(userId) {
  const user = dbGet('SELECT role, permissions_json FROM users WHERE id = ?', [userId]);
  if (!user) return null;

  // Start with role defaults
  const rolePerms = DEFAULT_ROLE_PERMISSIONS[user.role] || DEFAULT_ROLE_PERMISSIONS.readonly;
  const result = {};

  // Deep copy role defaults
  for (const [resource, actions] of Object.entries(rolePerms)) {
    result[resource] = [...actions];
  }

  // Apply permission overrides if any
  const overrides = parseJSON(user.permissions_json);
  if (overrides && typeof overrides === 'object') {
    for (const [resource, actions] of Object.entries(overrides)) {
      if (Array.isArray(actions)) {
        result[resource] = actions;
      }
    }
  }

  return { role: user.role, permissions: result };
}

export default {
  createUser,
  getUser,
  getUserByUsername,
  listUsers,
  updateUser,
  deactivateUser,
  suspendUser,
  reactivateUser,
  recordLogin,
  recordFailedLogin,
  getUserPermissions,
};
