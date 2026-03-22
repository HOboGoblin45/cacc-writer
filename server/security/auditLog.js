/**
 * server/security/auditLog.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security audit logging.
 *
 * Tracks ALL security-relevant events for compliance:
 *   - Login attempts (success/failure)
 *   - Data access patterns
 *   - Export events (who downloaded what)
 *   - Admin actions
 *   - API key usage
 *   - Subscription changes
 *   - Permission escalations
 *
 * Required for SOC 2 compliance and E&O insurance documentation.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

export function ensureSecurityAuditSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_audit_log (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT,
      event_type  TEXT NOT NULL,
      resource    TEXT,
      action      TEXT NOT NULL,
      details     TEXT,
      ip_address  TEXT,
      user_agent  TEXT,
      success     INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_security_audit ON security_audit_log(user_id, event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_audit_time ON security_audit_log(created_at DESC);
  `);
}

/**
 * Log a security event.
 */
export function logSecurityEvent({ userId, eventType, resource, action, details, ipAddress, userAgent, success }) {
  try {
    const db = getDb();
    db.prepare(`INSERT INTO security_audit_log (user_id, event_type, resource, action, details, ip_address, user_agent, success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId || null, eventType, resource || null, action,
      typeof details === 'object' ? JSON.stringify(details) : (details || null),
      ipAddress || null, userAgent || null, success !== false ? 1 : 0
    );
  } catch { /* don't let audit logging break the app */ }
}

/**
 * Express middleware that logs all API requests.
 */
export function securityAuditMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    // Only log significant events (not health checks, static files)
    if (req.path.includes('/health') || req.path.includes('/favicon')) return;

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const isSensitive = req.path.includes('/auth') || req.path.includes('/admin') ||
      req.path.includes('/export') || req.path.includes('/deliver') ||
      req.path.includes('/billing') || req.path.includes('/whitelabel');

    if (isWrite || isSensitive) {
      logSecurityEvent({
        userId: req.user?.userId,
        eventType: isWrite ? 'data_modification' : 'data_access',
        resource: req.path,
        action: `${req.method} ${req.path}`,
        details: { statusCode: res.statusCode, durationMs: Date.now() - start },
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']?.slice(0, 200),
        success: res.statusCode < 400,
      });
    }
  });

  next();
}

/**
 * Get security audit log for admin review.
 */
export function getAuditLog({ userId, eventType, startDate, endDate, limit } = {}) {
  const db = getDb();
  let where = '1=1';
  const params = [];

  if (userId) { where += ' AND user_id = ?'; params.push(userId); }
  if (eventType) { where += ' AND event_type = ?'; params.push(eventType); }
  if (startDate) { where += ' AND created_at >= ?'; params.push(startDate); }
  if (endDate) { where += ' AND created_at <= ?'; params.push(endDate); }

  params.push(parseInt(limit || '100'));

  return db.prepare(`SELECT * FROM security_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...params);
}

/**
 * Get security summary for admin dashboard.
 */
export function getSecuritySummary() {
  const db = getDb();

  const last24h = new Date(Date.now() - 86400000).toISOString();

  const loginAttempts = db.prepare("SELECT COUNT(*) as c, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed FROM security_audit_log WHERE event_type = 'auth' AND created_at >= ?").get(last24h);
  const apiCalls = db.prepare("SELECT COUNT(*) as c FROM security_audit_log WHERE created_at >= ?").get(last24h);
  const uniqueUsers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM security_audit_log WHERE created_at >= ? AND user_id IS NOT NULL").get(last24h);
  const exports = db.prepare("SELECT COUNT(*) as c FROM security_audit_log WHERE action LIKE '%export%' AND created_at >= ?").get(last24h);

  return {
    last24Hours: {
      totalEvents: apiCalls?.c || 0,
      loginAttempts: loginAttempts?.c || 0,
      failedLogins: loginAttempts?.failed || 0,
      uniqueUsers: uniqueUsers?.c || 0,
      exports: exports?.c || 0,
    },
  };
}

export default { ensureSecurityAuditSchema, logSecurityEvent, securityAuditMiddleware, getAuditLog, getSecuritySummary };
