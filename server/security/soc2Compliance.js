/**
 * server/security/soc2Compliance.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SOC 2 Type II Compliance Implementation
 *
 * Implements controls for:
 *   CC6.1 — Logical and physical access controls
 *   CC6.2 — Prior to issuing system credentials
 *   CC6.3 — Registration and authorization processes
 *   CC7.1 — Detection of unauthorized activity
 *   CC7.2 — Monitoring for anomalies
 *   CC8.1 — Change management
 *
 * Includes: audit logging, access control, password policy, brute force detection.
 */

import crypto from 'crypto';
import { getDb } from '../db/database.js';
import log from '../logger.js';

// ── Audit Logger ───────────────────────────────────────────────────────────────

/**
 * Immutable audit log — append-only, no updates/deletes.
 * Records all security-relevant events for compliance.
 */
export class AuditLogger {
  /**
   * Log a security event (immutable).
   * @param {Object} entry - { userId, event, detail, ipAddress, userAgent }
   */
  static logEvent(entry) {
    const db = getDb();
    const now = new Date().toISOString();

    const sanitized = {
      user_id: entry.userId || null,
      event: entry.event, // 'login', 'logout', 'failed_login', 'password_change', etc.
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent ? entry.userAgent.slice(0, 200) : null,
      created_at: now,
    };

    try {
      db.prepare(`
        INSERT INTO audit_log (user_id, event, detail, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        sanitized.user_id,
        sanitized.event,
        sanitized.detail,
        sanitized.ip_address,
        sanitized.user_agent,
        sanitized.created_at
      );
    } catch (err) {
      log.error('audit:log-failed', { event: entry.event, error: err.message });
    }
  }

  /**
   * Get audit log entries (for admin review).
   */
  static getEntries({ userId, event, startDate, endDate, limit = 100 } = {}) {
    const db = getDb();
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    if (event) {
      query += ' AND event = ?';
      params.push(event);
    }
    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
  }
}

// ── Access Control ─────────────────────────────────────────────────────────────

/**
 * Enforce password policy requirements.
 * Min 12 chars, uppercase, lowercase, number, special char.
 */
export function enforcePasswordPolicy(password) {
  const errors = [];

  if (!password || password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain number');
  }
  if (!/[!@#$%^&*()_+=\-\[\]{};:'",.<>?/\\|`~]/.test(password)) {
    errors.push('Password must contain special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a user's password is older than 90 days.
 * Returns: { needsChange, daysOld }
 */
export function checkPasswordAge(userId) {
  const db = getDb();

  const creds = db.prepare(`
    SELECT updated_at FROM auth_credentials
    WHERE user_id = ?
  `).get(userId);

  if (!creds) {
    return { needsChange: false, daysOld: 0 };
  }

  const updatedAt = new Date(creds.updated_at);
  const now = new Date();
  const daysOld = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));

  return {
    needsChange: daysOld > 90,
    daysOld,
  };
}

/**
 * Express middleware for session timeout enforcement.
 * @param {number} maxAgeMinutes - Max session age in minutes (default: 15)
 */
export function enforceSessionTimeout(maxAgeMinutes = 15) {
  return (req, res, next) => {
    if (!req.user) return next();

    const tokenIssuedAt = req.user.iat; // JWT issue time
    if (!tokenIssuedAt) return next();

    const ageMinutes = (Date.now() / 1000 - tokenIssuedAt) / 60;
    if (ageMinutes > maxAgeMinutes) {
      return res.status(401).json({
        ok: false,
        code: 'SESSION_EXPIRED',
        error: 'Session expired. Please login again.',
      });
    }

    next();
  };
}

/**
 * Detect and prevent brute force attacks.
 * Locks account after 5 failed attempts in 15 minutes.
 *
 * @param {string} identifier - Username or email
 * @returns {{ allowed: boolean, attemptsRemaining: number, lockedUntil: Date | null }}
 */
export function detectBruteForce(identifier) {
  const db = getDb();
  const now = new Date().toISOString();
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Count recent failed login attempts
  const attempts = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_log
    WHERE event = 'failed_login'
      AND detail LIKE ?
      AND created_at >= ?
  `).get(`%${identifier}%`, fifteenMinutesAgo);

  const failedCount = attempts?.count || 0;
  const maxAttempts = 5;
  const allowed = failedCount < maxAttempts;

  let lockedUntil = null;
  if (!allowed) {
    // Account is locked for 15 minutes
    lockedUntil = new Date(Date.now() + 15 * 60 * 1000);

    AuditLogger.logEvent({
      event: 'account_locked',
      detail: { identifier, failedAttempts: failedCount },
    });

    log.warn('security:brute-force-detected', { identifier, failedAttempts: failedCount });
  }

  return {
    allowed,
    attemptsRemaining: Math.max(0, maxAttempts - failedCount),
    lockedUntil,
  };
}

// ── Data Classification ────────────────────────────────────────────────────────

/**
 * Classify data sensitivity level.
 * Returns: 'public' | 'internal' | 'confidential' | 'restricted'
 */
export function classifyData(data) {
  if (!data) return 'internal';

  const dataStr = JSON.stringify(data).toLowerCase();

  // Restricted: PII, financial
  if (/ssn|social security|bank account|credit card|routing number/.test(dataStr)) {
    return 'restricted';
  }

  // Confidential: user data, business logic
  if (/password|secret|key|token|api_key|apikey/.test(dataStr)) {
    return 'restricted';
  }

  // Confidential: user emails, names
  if (/@/.test(dataStr) || /\b[a-z]+ [a-z]+\b/i.test(dataStr)) {
    return 'confidential';
  }

  // Internal: system info
  if (/error|exception|debug|stack|trace/.test(dataStr)) {
    return 'internal';
  }

  return 'public';
}

/**
 * Mask PII patterns in log entries.
 * Replaces SSN, phone, email with masked versions.
 */
export function maskPII(text) {
  if (!text) return text;

  let masked = text;

  // SSN: XXX-XX-XXXX
  masked = masked.replace(/\b\d{3}-\d{2}-\d{4}\b/g, 'XXX-XX-XXXX');

  // Phone: (XXX) XXX-XXXX or similar
  masked = masked.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, 'XXX-XXX-XXXX');

  // Email: user@domain.com → u***@d***.com
  masked = masked.replace(/(\b[a-z0-9]+)@([a-z0-9.]+)/gi, (match, user, domain) => {
    const userMasked = user.charAt(0) + '*'.repeat(Math.max(1, user.length - 1));
    const domainParts = domain.split('.');
    const domainMasked = domainParts.map(part => part.charAt(0) + '*'.repeat(Math.max(1, part.length - 1))).join('.');
    return `${userMasked}@${domainMasked}`;
  });

  // Credit card: XXXX-XXXX-XXXX-1234 (last 4 visible)
  masked = masked.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g, 'XXXX-XXXX-XXXX-$1');

  return masked;
}

/**
 * Sanitize audit entry by masking sensitive data.
 */
export function sanitizeAuditEntry(entry) {
  const sanitized = { ...entry };

  if (sanitized.detail) {
    sanitized.detail = maskPII(JSON.stringify(sanitized.detail));
  }

  if (sanitized.user_agent) {
    sanitized.user_agent = sanitized.user_agent.slice(0, 100);
  }

  return sanitized;
}

// ── Change Management ──────────────────────────────────────────────────────────

/**
 * Log a deployment event for change management audit trail.
 */
export function logDeployment(version, deployedBy, changes) {
  const db = getDb();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO deployment_log (version, deployed_by, changes, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      version,
      deployedBy,
      typeof changes === 'string' ? changes : JSON.stringify(changes),
      now
    );

    AuditLogger.logEvent({
      event: 'deployment',
      detail: { version, deployedBy, changeCount: Array.isArray(changes) ? changes.length : 1 },
    });

    log.info('security:deployment-logged', { version, deployedBy });
  } catch (err) {
    log.error('security:deployment-log-failed', { version, error: err.message });
  }
}

/**
 * Get deployment history for audit review.
 */
export function getDeploymentHistory(limit = 50) {
  const db = getDb();

  return db.prepare(`
    SELECT version, deployed_by, changes, created_at
    FROM deployment_log
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

// ── Compliance Report ──────────────────────────────────────────────────────────

/**
 * Generate a compliance report for a given date range.
 */
export function generateComplianceReport(startDate, endDate) {
  const db = getDb();

  const loginAttempts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN event = 'failed_login' THEN 1 ELSE 0 END) as failed,
      COUNT(DISTINCT user_id) as unique_users
    FROM audit_log
    WHERE event IN ('login', 'failed_login')
      AND created_at BETWEEN ? AND ?
  `).get(startDate, endDate);

  const passwordChanges = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_log
    WHERE event = 'password_change'
      AND created_at BETWEEN ? AND ?
  `).get(startDate, endDate);

  const dataExports = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_log
    WHERE event LIKE '%export%'
      AND created_at BETWEEN ? AND ?
  `).get(startDate, endDate);

  const deployments = db.prepare(`
    SELECT COUNT(*) as count
    FROM deployment_log
    WHERE created_at BETWEEN ? AND ?
  `).get(startDate, endDate);

  const securityEvents = db.prepare(`
    SELECT event, COUNT(*) as count
    FROM audit_log
    WHERE created_at BETWEEN ? AND ?
    GROUP BY event
    ORDER BY count DESC
  `).all(startDate, endDate);

  return {
    period: { startDate, endDate },
    summary: {
      totalLoginAttempts: loginAttempts?.total || 0,
      failedLogins: loginAttempts?.failed || 0,
      uniqueUsers: loginAttempts?.unique_users || 0,
      passwordChanges: passwordChanges?.count || 0,
      dataExports: dataExports?.count || 0,
      deployments: deployments?.count || 0,
    },
    events: securityEvents || [],
    generatedAt: new Date().toISOString(),
  };
}

export default {
  AuditLogger,
  enforcePasswordPolicy,
  checkPasswordAge,
  enforceSessionTimeout,
  detectBruteForce,
  classifyData,
  maskPII,
  sanitizeAuditEntry,
  logDeployment,
  getDeploymentHistory,
  generateComplianceReport,
};
