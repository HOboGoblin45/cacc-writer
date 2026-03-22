/**
 * server/integrations/emailDelivery.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated email delivery for completed reports.
 *
 * When a report is exported, automatically:
 *   - Emails PDF + XML to the lender/AMC
 *   - Sends portal link for online viewing
 *   - Includes invoice with fee amount
 *   - Tracks delivery status
 *   - Handles delivery confirmation
 *
 * Uses nodemailer with SMTP (Gmail, Outlook, or any SMTP server).
 */

import nodemailer from 'nodemailer';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { getDb } from '../db/database.js';
import { renderPdf } from '../export/pdfRenderer.js';
import { buildUad36Document } from '../export/uad36ExportService.js';
import { createPortalLink } from '../portal/clientPortal.js';
import log from '../logger.js';
import crypto from 'crypto';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Appraisal Agent';
const FROM_EMAIL = process.env.EMAIL_FROM || SMTP_USER;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export function isEmailConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export function ensureDeliverySchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      recipient   TEXT NOT NULL,
      subject     TEXT NOT NULL,
      status      TEXT DEFAULT 'pending',
      attachments TEXT,
      portal_link TEXT,
      message_id  TEXT,
      error       TEXT,
      sent_at     TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_case ON email_deliveries(case_id);
  `);
}

/**
 * Deliver a completed report via email.
 */
export async function deliverReport(caseId, userId, { recipient, ccRecipients, includeXml, includePortalLink, customMessage }) {
  const transport = getTransporter();
  if (!transport) throw new Error('Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};
  const appraiser = facts.appraiser || {};
  const fee = facts.order?.fee;

  const address = subject.address || subject.streetAddress || caseId;
  const emailSubject = `Appraisal Report — ${address}, ${subject.city || ''} ${subject.state || ''}`;

  // Generate attachments
  const attachments = [];

  // PDF
  try {
    const pdfBuffer = await renderPdf(caseId);
    attachments.push({
      filename: `Appraisal_${caseId}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    });
  } catch (e) {
    log.warn('email:pdf-failed', { caseId, error: e.message });
  }

  // XML (optional)
  if (includeXml) {
    try {
      const caseData = loadCaseDataForExport(caseId);
      const xml = buildUad36Document(caseData);
      attachments.push({
        filename: `Appraisal_${caseId}_UAD36.xml`,
        content: Buffer.from(xml, 'utf8'),
        contentType: 'application/xml',
      });
    } catch (e) {
      log.warn('email:xml-failed', { caseId, error: e.message });
    }
  }

  // Portal link
  let portalUrl = null;
  if (includePortalLink !== false) {
    try {
      const link = createPortalLink(userId, caseId, {
        recipientName: recipient.split('@')[0],
        recipientEmail: recipient,
        permissions: 'view_revise',
        expiresInDays: 90,
      });
      portalUrl = `${process.env.APP_URL || 'http://localhost:5178'}${link.url}`;
    } catch (e) {
      log.warn('email:portal-link-failed', { error: e.message });
    }
  }

  // Build email HTML
  const html = buildEmailHtml({
    address,
    city: subject.city,
    state: subject.state,
    appraiserName: appraiser.name || '',
    companyName: appraiser.company || 'Cresci Appraisal & Consulting',
    fee,
    portalUrl,
    customMessage,
  });

  const deliveryId = crypto.randomBytes(8).toString('hex');

  try {
    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: recipient,
      cc: ccRecipients || undefined,
      subject: emailSubject,
      html,
      attachments,
    });

    dbRun(
      `INSERT INTO email_deliveries (id, case_id, user_id, recipient, subject, status, attachments, portal_link, message_id, sent_at)
       VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?, datetime('now'))`,
      [deliveryId, caseId, userId, recipient, emailSubject,
       attachments.map(a => a.filename).join(', '), portalUrl, info.messageId]
    );

    log.info('email:delivered', { caseId, recipient, attachments: attachments.length, messageId: info.messageId });

    return { deliveryId, messageId: info.messageId, status: 'sent', portalUrl };
  } catch (err) {
    dbRun(
      `INSERT INTO email_deliveries (id, case_id, user_id, recipient, subject, status, error)
       VALUES (?, ?, ?, ?, ?, 'failed', ?)`,
      [deliveryId, caseId, userId, recipient, emailSubject, err.message]
    );
    throw err;
  }
}

/**
 * Get delivery history for a case.
 */
export function getDeliveryHistory(caseId) {
  return dbAll('SELECT * FROM email_deliveries WHERE case_id = ? ORDER BY created_at DESC', [caseId]);
}

function buildEmailHtml({ address, city, state, appraiserName, companyName, fee, portalUrl, customMessage }) {
  return `
<!DOCTYPE html>
<html><head><style>
  body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; }
  .header { background: #1a5276; color: white; padding: 24px; border-radius: 8px 8px 0 0; }
  .header h1 { margin: 0; font-size: 20px; }
  .body { padding: 24px; background: #f9f9f9; }
  .property { background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #e0e0e0; }
  .property h2 { margin: 0 0 4px; font-size: 16px; }
  .property p { margin: 0; color: #666; }
  .btn { display: inline-block; padding: 12px 24px; background: #e2b714; color: #111; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 8px 0; }
  .footer { padding: 16px 24px; font-size: 12px; color: #888; border-top: 1px solid #e0e0e0; }
  .fee { background: #f0f8ff; padding: 12px; border-radius: 6px; margin: 12px 0; border-left: 4px solid #1a5276; }
</style></head><body>
  <div class="header">
    <h1>Appraisal Report Delivered</h1>
  </div>
  <div class="body">
    <div class="property">
      <h2>${address}</h2>
      <p>${city || ''}${city && state ? ', ' : ''}${state || ''}</p>
    </div>
    ${customMessage ? `<p>${customMessage}</p>` : ''}
    <p>The completed appraisal report is attached as a PDF${fee ? ' along with the invoice details below' : ''}.</p>
    ${fee ? `<div class="fee"><strong>Appraisal Fee:</strong> $${Number(fee).toLocaleString()}</div>` : ''}
    ${portalUrl ? `<p>You can also view the report online and submit any revision requests:</p><a href="${portalUrl}" class="btn">View Report Online →</a>` : ''}
    <p style="margin-top: 16px;">Please don't hesitate to reach out with any questions.</p>
    <p>Best regards,<br><strong>${appraiserName}</strong><br>${companyName}</p>
  </div>
  <div class="footer">
    <p>This report was generated by Appraisal Agent — AI-powered appraisal software.</p>
    <p>${companyName}</p>
  </div>
</body></html>`;
}

function loadCaseDataForExport(caseId) {
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
  const sections = {};
  try {
    const rows = dbAll('SELECT * FROM generated_sections WHERE case_id = ? ORDER BY section_id, created_at DESC', [caseId]);
    for (const s of rows) { if (!sections[s.section_id]) sections[s.section_id] = s; }
  } catch { /* ok */ }
  let comps = []; try { comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1', [caseId]); } catch { /* ok */ }
  let adjustments = []; try { adjustments = dbAll('SELECT * FROM adjustment_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }
  let reconciliation = null; try { reconciliation = dbGet('SELECT * FROM reconciliation_support_records WHERE case_id = ?', [caseId]); } catch { /* ok */ }
  return { caseRecord, facts, sections, comps, adjustments, reconciliation };
}

export default { deliverReport, getDeliveryHistory, isEmailConfigured, ensureDeliverySchema };
