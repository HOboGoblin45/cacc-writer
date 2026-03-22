/**
 * server/notifications/notificationService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * In-app notification system.
 *
 * Tracks alerts for:
 *   - Report due dates approaching
 *   - New AMC orders received
 *   - Revision requests
 *   - AI generation completed
 *   - Subscription expiring
 *   - Voice model milestones
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureNotificationSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      message     TEXT,
      priority    TEXT DEFAULT 'normal',
      link        TEXT,
      case_id     TEXT,
      is_read     INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  `);
}

/**
 * Create a notification.
 */
export function createNotification(userId, { type, title, message, priority, link, caseId }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, priority, link, case_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, title, message || null, priority || 'normal', link || null, caseId || null);
  return id;
}

/**
 * Get unread notifications for a user.
 */
export function getNotifications(userId, { limit = 20, includeRead = false } = {}) {
  const db = getDb();
  const where = includeRead ? 'user_id = ?' : 'user_id = ? AND is_read = 0';
  return db.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
}

/**
 * Mark notification(s) as read.
 */
export function markRead(notificationId) {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notificationId);
}

export function markAllRead(userId) {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

/**
 * Check for due date alerts and create notifications.
 * Call this periodically (heartbeat / cron).
 */
export function checkDueDateAlerts(userId) {
  const db = getDb();
  const alerts = [];

  try {
    // Reports due within 24 hours
    const urgent = db.prepare(`
      SELECT r.case_id, json_extract(f.facts_json, '$.order.dueDate') as due_date,
             json_extract(f.facts_json, '$.subject.address') as address
      FROM case_records r
      JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.case_status NOT IN ('complete', 'exported', 'delivered', 'cancelled')
        AND json_extract(f.facts_json, '$.order.dueDate') IS NOT NULL
        AND date(json_extract(f.facts_json, '$.order.dueDate')) <= date('now', '+1 day')
        AND date(json_extract(f.facts_json, '$.order.dueDate')) >= date('now')
    `).all();

    for (const row of urgent) {
      // Check if we already notified
      const existing = db.prepare(
        "SELECT id FROM notifications WHERE case_id = ? AND type = 'due_date_urgent' AND created_at >= datetime('now', '-12 hours')"
      ).get(row.case_id);

      if (!existing) {
        createNotification(userId, {
          type: 'due_date_urgent',
          title: '⚠️ Report due tomorrow',
          message: `${row.address || row.case_id} is due ${row.due_date}`,
          priority: 'high',
          link: `/?case=${row.case_id}`,
          caseId: row.case_id,
        });
        alerts.push(row.case_id);
      }
    }

    // Reports overdue
    const overdue = db.prepare(`
      SELECT r.case_id, json_extract(f.facts_json, '$.order.dueDate') as due_date,
             json_extract(f.facts_json, '$.subject.address') as address
      FROM case_records r
      JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.case_status NOT IN ('complete', 'exported', 'delivered', 'cancelled')
        AND json_extract(f.facts_json, '$.order.dueDate') IS NOT NULL
        AND date(json_extract(f.facts_json, '$.order.dueDate')) < date('now')
    `).all();

    for (const row of overdue) {
      const existing = db.prepare(
        "SELECT id FROM notifications WHERE case_id = ? AND type = 'overdue' AND created_at >= datetime('now', '-24 hours')"
      ).get(row.case_id);

      if (!existing) {
        createNotification(userId, {
          type: 'overdue',
          title: '🔴 Report OVERDUE',
          message: `${row.address || row.case_id} was due ${row.due_date}`,
          priority: 'critical',
          link: `/?case=${row.case_id}`,
          caseId: row.case_id,
        });
        alerts.push(row.case_id);
      }
    }
  } catch { /* tables may not exist */ }

  return alerts;
}

export default {
  ensureNotificationSchema, createNotification, getNotifications,
  markRead, markAllRead, checkDueDateAlerts,
};
