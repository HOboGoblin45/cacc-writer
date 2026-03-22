/**
 * server/realtime/collaborationService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time collaboration for multi-appraiser firms.
 *
 * Enables:
 *   - Multiple appraisers working on the same case
 *   - Real-time cursor/edit presence (who's working on what)
 *   - Case assignment and delegation
 *   - Supervisor review workflow
 *   - Team activity feed
 *   - Workload balancing across the firm
 *
 * Architecture: SSE-based (no WebSocket dependency needed).
 * Each connected user gets an SSE stream with case updates.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureCollabSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      firm_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT DEFAULT 'appraiser',
      is_active   INTEGER DEFAULT 1,
      joined_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(firm_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS firms (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS case_assignments (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      assigned_by TEXT,
      role        TEXT DEFAULT 'primary',
      status      TEXT DEFAULT 'active',
      assigned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(case_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_user ON case_assignments(user_id, status);

    CREATE TABLE IF NOT EXISTS activity_feed (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      firm_id     TEXT,
      case_id     TEXT,
      user_id     TEXT NOT NULL,
      action      TEXT NOT NULL,
      details     TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_firm ON activity_feed(firm_id, created_at DESC);
  `);
}

// ── Active presence tracking (in-memory) ─────────────────────────────────────

const activeUsers = new Map(); // caseId -> Map<userId, { name, section, lastSeen }>
const sseClients = new Map(); // userId -> response object

/**
 * Register a user's presence on a case.
 */
export function setPresence(caseId, userId, { name, section }) {
  if (!activeUsers.has(caseId)) activeUsers.set(caseId, new Map());
  activeUsers.get(caseId).set(userId, {
    name: name || userId,
    section: section || null,
    lastSeen: Date.now(),
  });

  // Notify other users on the same case
  broadcastToCase(caseId, {
    type: 'presence',
    userId,
    name: name || userId,
    section,
  }, userId);
}

/**
 * Remove a user's presence.
 */
export function removePresence(caseId, userId) {
  if (activeUsers.has(caseId)) {
    activeUsers.get(caseId).delete(userId);
    if (activeUsers.get(caseId).size === 0) activeUsers.delete(caseId);
    broadcastToCase(caseId, { type: 'leave', userId }, userId);
  }
}

/**
 * Get who's currently working on a case.
 */
export function getCasePresence(caseId) {
  const users = activeUsers.get(caseId);
  if (!users) return [];
  // Clean stale (>5 min)
  const cutoff = Date.now() - 300000;
  const result = [];
  for (const [userId, info] of users) {
    if (info.lastSeen > cutoff) {
      result.push({ userId, ...info });
    } else {
      users.delete(userId);
    }
  }
  return result;
}

/**
 * Register an SSE client for real-time updates.
 */
export function registerSSEClient(userId, res) {
  sseClients.set(userId, res);
  res.on('close', () => sseClients.delete(userId));
}

/**
 * Broadcast to all users on a case (except sender).
 */
function broadcastToCase(caseId, data, excludeUserId) {
  const users = activeUsers.get(caseId);
  if (!users) return;
  const payload = `data: ${JSON.stringify({ caseId, ...data })}\n\n`;
  for (const [userId] of users) {
    if (userId !== excludeUserId && sseClients.has(userId)) {
      try { sseClients.get(userId).write(payload); } catch { /* ok */ }
    }
  }
}

// ── Firm Management ──────────────────────────────────────────────────────────

export function createFirm(ownerId, name) {
  const db = getDb();
  const firmId = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO firms (id, name, owner_id) VALUES (?, ?, ?)').run(firmId, name, ownerId);
  db.prepare('INSERT INTO team_members (firm_id, user_id, role) VALUES (?, ?, ?)').run(firmId, ownerId, 'owner');
  return { firmId, name };
}

export function inviteToFirm(firmId, userId, role = 'appraiser') {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO team_members (firm_id, user_id, role) VALUES (?, ?, ?)').run(firmId, userId, role);
}

export function getFirmMembers(firmId) {
  const db = getDb();
  return db.prepare(`
    SELECT tm.*, u.username, u.display_name, u.email
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.firm_id = ? AND tm.is_active = 1
    ORDER BY tm.role, u.display_name
  `).all(firmId);
}

// ── Case Assignment ──────────────────────────────────────────────────────────

export function assignCase(caseId, userId, assignedBy, role = 'primary') {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO case_assignments (id, case_id, user_id, assigned_by, role)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?)
  `).run(caseId, userId, assignedBy, role);

  logActivity(null, caseId, assignedBy, 'assign', `Assigned to ${userId} as ${role}`);
}

export function getCaseAssignments(caseId) {
  const db = getDb();
  return db.prepare(`
    SELECT ca.*, u.display_name, u.username
    FROM case_assignments ca
    JOIN users u ON u.id = ca.user_id
    WHERE ca.case_id = ? AND ca.status = 'active'
  `).all(caseId);
}

export function getUserCaseload(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT ca.*, cr.form_type, cr.status as case_status,
           json_extract(f.facts_json, '$.subject.address') as address,
           json_extract(f.facts_json, '$.order.dueDate') as due_date
    FROM case_assignments ca
    JOIN case_records cr ON cr.case_id = ca.case_id
    LEFT JOIN case_facts f ON f.case_id = ca.case_id
    WHERE ca.user_id = ? AND ca.status = 'active'
    ORDER BY json_extract(f.facts_json, '$.order.dueDate')
  `).all(userId);
}

// ── Workload Balancing ───────────────────────────────────────────────────────

export function getTeamWorkload(firmId) {
  const db = getDb();
  return db.prepare(`
    SELECT tm.user_id, u.display_name,
           COUNT(ca.id) as active_cases,
           SUM(CASE WHEN cr.status IN ('complete','exported') THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN json_extract(f.facts_json, '$.order.dueDate') < date('now', '+2 days') THEN 1 ELSE 0 END) as urgent
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN case_assignments ca ON ca.user_id = tm.user_id AND ca.status = 'active'
    LEFT JOIN case_records cr ON cr.case_id = ca.case_id
    LEFT JOIN case_facts f ON f.case_id = ca.case_id
    WHERE tm.firm_id = ? AND tm.is_active = 1
    GROUP BY tm.user_id
    ORDER BY active_cases
  `).all(firmId);
}

// ── Activity Feed ────────────────────────────────────────────────────────────

export function logActivity(firmId, caseId, userId, action, details) {
  const db = getDb();
  db.prepare('INSERT INTO activity_feed (firm_id, case_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(firmId || null, caseId || null, userId, action, details || null);
}

export function getActivityFeed(firmId, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT af.*, u.display_name, u.username
    FROM activity_feed af
    LEFT JOIN users u ON u.id = af.user_id
    WHERE af.firm_id = ? OR af.firm_id IS NULL
    ORDER BY af.created_at DESC LIMIT ?
  `).all(firmId, limit);
}

export default {
  ensureCollabSchema, setPresence, removePresence, getCasePresence,
  registerSSEClient, createFirm, inviteToFirm, getFirmMembers,
  assignCase, getCaseAssignments, getUserCaseload, getTeamWorkload,
  logActivity, getActivityFeed,
};
