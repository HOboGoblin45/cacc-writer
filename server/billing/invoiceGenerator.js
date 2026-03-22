/**
 * server/billing/invoiceGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Invoice generation for appraisal fees.
 *
 * Generates professional invoices that can be:
 *   - Included with report delivery emails
 *   - Downloaded as PDF
 *   - Tracked for payment status
 *   - Exported for accounting
 */

import PDFDocument from 'pdfkit';
import { getDb } from '../db/database.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureInvoiceSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      invoice_number  TEXT NOT NULL UNIQUE,
      case_id         TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      client_name     TEXT,
      client_email    TEXT,
      amount          REAL NOT NULL,
      tax_amount      REAL DEFAULT 0,
      total_amount    REAL NOT NULL,
      status          TEXT DEFAULT 'unpaid',
      due_date        TEXT,
      paid_date       TEXT,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, status);
  `);
}

/**
 * Generate next invoice number.
 */
function nextInvoiceNumber(userId) {
  const db = getDb();
  const last = db.prepare("SELECT invoice_number FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId);
  if (!last) return 'INV-0001';
  const num = parseInt(last.invoice_number.replace('INV-', '')) || 0;
  return `INV-${String(num + 1).padStart(4, '0')}`;
}

/**
 * Create an invoice for a case.
 */
export function createInvoice(caseId, userId, { clientName, clientEmail, amount, taxRate, notes, dueInDays }) {
  const db = getDb();
  const invoiceNumber = nextInvoiceNumber(userId);
  const id = crypto.randomBytes(8).toString('hex');
  const taxAmount = taxRate ? Math.round(amount * (taxRate / 100) * 100) / 100 : 0;
  const totalAmount = amount + taxAmount;
  const dueDate = new Date(Date.now() + (dueInDays || 30) * 86400000).toISOString().split('T')[0];

  // Auto-fill client from case facts
  if (!clientName) {
    const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
    const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
    clientName = facts.amc?.name || facts.lender?.name || 'Client';
    clientEmail = clientEmail || facts.amc?.email || facts.lender?.email;
  }

  db.prepare(`
    INSERT INTO invoices (id, invoice_number, case_id, user_id, client_name, client_email,
      amount, tax_amount, total_amount, due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, invoiceNumber, caseId, userId, clientName, clientEmail || null,
    amount, taxAmount, totalAmount, dueDate, notes || null);

  log.info('invoice:created', { invoiceNumber, caseId, amount: totalAmount });
  return { invoiceId: id, invoiceNumber, totalAmount, dueDate };
}

/**
 * Render invoice as PDF.
 */
export async function renderInvoicePdf(invoiceId) {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error('Invoice not found');

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [invoice.case_id]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
  const appraiser = facts.appraiser || {};
  const subject = facts.subject || {};

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 60, right: 60 } });
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const w = doc.page.width - 120;

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#1a5276');
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff').text('INVOICE', 60, 35);
    doc.fontSize(12).text(invoice.invoice_number, 60, 65);
    doc.fontSize(10).fillColor('#ffffff').text(appraiser.company || 'Cresci Appraisal & Consulting', 350, 35, { align: 'right', width: w - 290 });
    if (appraiser.name) doc.text(appraiser.name, 350, 52, { align: 'right', width: w - 290 });

    // Bill To
    doc.fillColor('#333333');
    doc.font('Helvetica-Bold').fontSize(10).text('BILL TO:', 60, 130);
    doc.font('Helvetica').fontSize(11).text(invoice.client_name || 'Client', 60, 145);
    if (invoice.client_email) doc.text(invoice.client_email, 60, 160);

    // Invoice details
    doc.font('Helvetica-Bold').fontSize(10).text('DATE:', 380, 130);
    doc.font('Helvetica').text(new Date(invoice.created_at).toLocaleDateString(), 430, 130);
    doc.font('Helvetica-Bold').text('DUE:', 380, 148);
    doc.font('Helvetica').text(invoice.due_date || 'Upon receipt', 430, 148);
    doc.font('Helvetica-Bold').text('STATUS:', 380, 166);
    doc.font('Helvetica').fillColor(invoice.status === 'paid' ? '#27ae60' : '#e74c3c')
      .text(invoice.status.toUpperCase(), 430, 166);

    // Property info
    doc.fillColor('#333333');
    doc.moveTo(60, 200).lineTo(60 + w, 200).strokeColor('#cccccc').stroke();
    doc.font('Helvetica-Bold').fontSize(10).text('PROPERTY:', 60, 210);
    doc.font('Helvetica').fontSize(11).text(`${subject.address || 'N/A'}, ${subject.city || ''} ${subject.state || ''} ${subject.zip || ''}`, 130, 210);

    // Line items table
    const tableY = 250;
    doc.rect(60, tableY, w, 30).fill('#f5f5f5');
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(10);
    doc.text('DESCRIPTION', 70, tableY + 10);
    doc.text('AMOUNT', 430, tableY + 10, { align: 'right', width: 100 });

    doc.font('Helvetica').fontSize(11).fillColor('#333');
    const formType = facts.assignment?.type || db.prepare('SELECT form_type FROM case_records WHERE case_id = ?').get(invoice.case_id)?.form_type || '1004';
    doc.text(`Appraisal Services — Form ${formType}`, 70, tableY + 45);
    doc.text(`$${invoice.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 430, tableY + 45, { align: 'right', width: 100 });

    if (invoice.tax_amount > 0) {
      doc.text('Tax', 70, tableY + 70);
      doc.text(`$${invoice.tax_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 430, tableY + 70, { align: 'right', width: 100 });
    }

    // Total
    doc.moveTo(60, tableY + 100).lineTo(60 + w, tableY + 100).strokeColor('#1a5276').lineWidth(2).stroke();
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1a5276');
    doc.text('TOTAL', 70, tableY + 110);
    doc.text(`$${invoice.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 430, tableY + 110, { align: 'right', width: 100 });

    // Notes
    if (invoice.notes) {
      doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Notes: ${invoice.notes}`, 60, tableY + 150, { width: w });
    }

    // Footer
    doc.font('Helvetica').fontSize(8).fillColor('#999');
    doc.text('Generated by Appraisal Agent', 60, doc.page.height - 40, { width: w, align: 'center' });

    doc.end();
  });
}

/**
 * Mark invoice as paid.
 */
export function markInvoicePaid(invoiceId) {
  const db = getDb();
  db.prepare("UPDATE invoices SET status = 'paid', paid_date = date('now') WHERE id = ?").run(invoiceId);
}

/**
 * Get invoices for a user.
 */
export function getUserInvoices(userId, { status } = {}) {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM invoices WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(userId, status);
  }
  return db.prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

/**
 * Get outstanding (unpaid) total.
 */
export function getOutstandingTotal(userId) {
  const db = getDb();
  const result = db.prepare("SELECT SUM(total_amount) as total, COUNT(*) as count FROM invoices WHERE user_id = ? AND status = 'unpaid'").get(userId);
  return { outstanding: result?.total || 0, unpaidCount: result?.count || 0 };
}

export default { createInvoice, renderInvoicePdf, markInvoicePaid, getUserInvoices, getOutstandingTotal, ensureInvoiceSchema };
