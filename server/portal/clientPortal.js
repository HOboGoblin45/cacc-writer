/**
 * server/portal/clientPortal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client/Lender Portal — read-only access for lenders and AMCs.
 *
 * Instead of emailing PDFs back and forth, give clients a link
 * where they can:
 *   - Track order status in real-time
 *   - View completed report (PDF viewer)
 *   - Download XML and PDF exports
 *   - Submit revision requests / stipulations
 *   - View revision response and status
 *
 * Portal links use a secure token — no login required for clients.
 * Each link is scoped to a single case and expires.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensurePortalSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_links (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id         TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      token           TEXT NOT NULL UNIQUE,
      recipient_name  TEXT,
      recipient_email TEXT,
      permissions     TEXT DEFAULT 'view',
      expires_at      TEXT,
      is_active       INTEGER DEFAULT 1,
      view_count      INTEGER DEFAULT 0,
      last_viewed_at  TEXT,
      created_at      TEXT DEFAULT (datetime("now"))
    );
    CREATE INDEX IF NOT EXISTS idx_portal_token ON portal_links(token);
  `);
}

/**
 * Generate a portal link for a case.
 */
export function createPortalLink(userId, caseId, { recipientName, recipientEmail, permissions, expiresInDays }) {
  const db = getDb();
  const token = crypto.randomBytes(24).toString('base64url');
  const id = crypto.randomBytes(8).toString('hex');

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
    : new Date(Date.now() + 90 * 86400000).toISOString(); // 90 day default

  db.prepare(`
    INSERT INTO portal_links (id, case_id, user_id, token, recipient_name, recipient_email, permissions, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, caseId, userId, token, recipientName || null, recipientEmail || null, permissions || 'view', expiresAt);

  log.info('portal:link-created', { caseId, recipientName, expiresAt });

  return {
    linkId: id,
    token,
    url: `/portal/${token}`,
    expiresAt,
  };
}

/**
 * Validate a portal token and return case data.
 */
export function validatePortalAccess(token) {
  const db = getDb();
  const link = db.prepare(`
    SELECT pl.*, cr.form_type, cr.status
    FROM portal_links pl
    JOIN case_records cr ON cr.case_id = pl.case_id
    WHERE pl.token = ? AND pl.is_active = 1
  `).get(token);

  if (!link) return { valid: false, error: 'Invalid or expired link' };
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return { valid: false, error: 'Link has expired' };
  }

  // Update view stats
  db.prepare(`UPDATE portal_links SET view_count = view_count + 1, last_viewed_at = datetime("now") WHERE id = ?`).run(link.id);

  return {
    valid: true,
    caseId: link.case_id,
    formType: link.form_type,
    caseStatus: link.status,
    permissions: link.permissions,
    recipientName: link.recipient_name,
  };
}

/**
 * Get portal view data for a case (safe subset — no sensitive info).
 */
export function getPortalCaseData(caseId) {
  const db = getDb();

  const caseRecord = db.prepare('SELECT case_id, form_type, status, created_at, updated_at FROM case_records WHERE case_id = ?').get(caseId);
  if (!caseRecord) return null;

  const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  // Only expose safe subject info
  const subject = {
    address: facts.subject?.address || facts.subject?.streetAddress,
    city: facts.subject?.city,
    state: facts.subject?.state,
    zip: facts.subject?.zip,
    county: facts.subject?.county,
  };

  // Status timeline
  const statusMap = {
    'draft': { step: 1, label: 'Order Received' },
    'received': { step: 1, label: 'Order Received' },
    'pipeline': { step: 2, label: 'Processing' },
    'inspection_scheduled': { step: 2, label: 'Inspection Scheduled' },
    'inspected': { step: 3, label: 'Inspection Complete' },
    'generating': { step: 4, label: 'Report Generation' },
    'review': { step: 5, label: 'Quality Review' },
    'complete': { step: 6, label: 'Report Complete' },
    'exported': { step: 7, label: 'Delivered' },
    'delivered': { step: 7, label: 'Delivered' },
    'revision': { step: 5, label: 'Revision In Progress' },
  };

  const currentStatus = statusMap[caseRecord.status] || { step: 1, label: caseRecord.status };

  // Check for exports
  let exports = [];
  try {
    exports = db.prepare(`
      SELECT id, export_type, output_format, file_name, export_status, completed_at
      FROM export_jobs
      WHERE case_id = ? AND export_status = 'completed'
      ORDER BY completed_at DESC
    `).all(caseId);
  } catch { /* ok */ }

  // Revision status
  let revisions = [];
  try {
    const revs = db.prepare('SELECT * FROM revision_requests WHERE case_id = ? ORDER BY revision_number').all(caseId);
    for (const rev of revs) {
      const stips = db.prepare('SELECT text, status, response_text FROM stipulations WHERE revision_id = ?').all(rev.id);
      revisions.push({
        revisionNumber: rev.revision_number,
        status: rev.status,
        receivedAt: rev.received_at,
        stipulations: stips,
      });
    }
  } catch { /* ok */ }

  return {
    caseId: caseRecord.case_id,
    formType: caseRecord.form_type,
    status: currentStatus,
    rawStatus: caseRecord.status,
    subject,
    createdAt: caseRecord.created_at,
    updatedAt: caseRecord.updated_at,
    exports,
    revisions,
    timeline: Object.entries(statusMap).map(([k, v]) => ({
      ...v,
      key: k,
      reached: v.step <= currentStatus.step,
    })),
  };
}

/**
 * Get all portal links for a user.
 */
export function getPortalLinks(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT pl.*, cr.status,
           json_extract(f.facts_json, '$.subject.address') as address
    FROM portal_links pl
    JOIN case_records cr ON cr.case_id = pl.case_id
    LEFT JOIN case_facts f ON f.case_id = pl.case_id
    WHERE pl.user_id = ?
    ORDER BY pl.created_at DESC
  `).all(userId);
}

/**
 * Revoke a portal link.
 */
export function revokePortalLink(linkId, userId) {
  const db = getDb();
  db.prepare('UPDATE portal_links SET is_active = 0 WHERE id = ? AND user_id = ?').run(linkId, userId);
}

export default {
  ensurePortalSchema, createPortalLink, validatePortalAccess,
  getPortalCaseData, getPortalLinks, revokePortalLink,
};
