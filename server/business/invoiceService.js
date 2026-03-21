/**
 * server/business/invoiceService.js
 * -----------------------------------
 * Invoice management service for Appraisal Agent.
 *
 * Handles the full invoicing lifecycle: creation, issuance, payment recording,
 * reminders, voiding, and reporting.
 *
 * Usage:
 *   import { createInvoice, getInvoice, issueInvoice, ... } from './invoiceService.js';
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { emitAuditEvent, emitCaseEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// â”€â”€ ID helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeId() {
  return 'inv_' + randomUUID().slice(0, 12);
}

// â”€â”€ JSON helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseJson(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function stringifyJson(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// â”€â”€ Row hydration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function hydrateInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    line_items_json: parseJson(row.line_items_json, []),
    adjustments_json: parseJson(row.adjustments_json, null),
  };
}

// â”€â”€ Payment terms â†’ days mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PAYMENT_TERMS_DAYS = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  net_60: 60,
};

// â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Generate a sequential invoice number: CACC-INV-YYYYMM-NNNN
 *
 * @returns {string}
 */
export function generateInvoiceNumber() {
  const db = getDb();
  const now = new Date();
  const yyyymm = now.toISOString().slice(0, 7).replace('-', '');

  const prefix = `CACC-INV-${yyyymm}-`;

  // Find the highest existing number for this month
  const row = db.prepare(`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE ?
    ORDER BY invoice_number DESC
    LIMIT 1
  `).get(`${prefix}%`);

  let seq = 1;
  if (row && row.invoice_number) {
    const lastSeq = parseInt(row.invoice_number.slice(prefix.length), 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Create a new invoice with line items. Auto-calculates totals.
 *
 * @param {Object} data
 * @returns {Object} The created invoice record
 */
export function createInvoice(data) {
  const db = getDb();
  const id = makeId();
  const now = new Date().toISOString();

  const invoiceNumber = data.invoice_number || generateInvoiceNumber();

  // Calculate totals from line items
  const lineItems = data.line_items_json || data.lineItems || [];
  let subtotal = data.subtotal;
  if (subtotal === undefined || subtotal === null) {
    subtotal = lineItems.reduce((sum, item) => {
      const amount = item.amount !== undefined ? item.amount : (item.quantity || 1) * (item.unit_price || 0);
      return sum + amount;
    }, 0);
  }

  const taxAmount = data.tax_amount || 0;

  // Process adjustments (discounts, credits)
  let adjustmentTotal = 0;
  const adjustments = data.adjustments_json || null;
  if (adjustments && Array.isArray(adjustments)) {
    adjustmentTotal = adjustments.reduce((sum, adj) => sum + (adj.amount || 0), 0);
  }

  const totalAmount = data.total_amount !== undefined ? data.total_amount : subtotal + adjustmentTotal + taxAmount;
  const amountPaid = data.amount_paid || 0;
  const balanceDue = data.balance_due !== undefined ? data.balance_due : totalAmount - amountPaid;

  const stmt = db.prepare(`
    INSERT INTO invoices (
      id, case_id, engagement_id, invoice_number, invoice_status,
      client_name, client_type, billing_address, line_items_json,
      subtotal, adjustments_json, tax_amount, total_amount,
      amount_paid, balance_due, payment_terms, issued_date, due_date,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.case_id,
    data.engagement_id || null,
    invoiceNumber,
    data.invoice_status || 'draft',
    data.client_name,
    data.client_type,
    data.billing_address || null,
    JSON.stringify(lineItems),
    subtotal,
    stringifyJson(adjustments),
    taxAmount,
    totalAmount,
    amountPaid,
    balanceDue,
    data.payment_terms || 'net_30',
    data.issued_date || null,
    data.due_date || null,
    data.notes || null,
    now,
    now,
  );

  emitCaseEvent(
    data.case_id,
    'invoice.created',
    `Invoice ${invoiceNumber} created: $${totalAmount}`,
    { invoiceId: id, invoiceNumber, totalAmount, clientName: data.client_name },
    { entityType: 'invoice', entityId: id },
  );

  return getInvoice(id);
}

/**
 * Get a single invoice by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getInvoice(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return hydrateInvoice(row);
}

/**
 * List invoices with optional filters.
 *
 * @param {Object} [opts={}]
 * @param {string} [opts.status]
 * @param {string} [opts.clientName]
 * @param {string} [opts.caseId]
 * @param {string} [opts.dueBefore]
 * @param {string} [opts.dueAfter]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Object[]}
 */
export function listInvoices(opts = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (opts.status) {
    conditions.push('invoice_status = ?');
    params.push(opts.status);
  }
  if (opts.clientName) {
    conditions.push('client_name = ?');
    params.push(opts.clientName);
  }
  if (opts.caseId) {
    conditions.push('case_id = ?');
    params.push(opts.caseId);
  }
  if (opts.dueBefore) {
    conditions.push('due_date <= ?');
    params.push(opts.dueBefore);
  }
  if (opts.dueAfter) {
    conditions.push('due_date >= ?');
    params.push(opts.dueAfter);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const rows = db.prepare(`SELECT * FROM invoices ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all([...params, limit, offset]);

  return rows.map(hydrateInvoice);
}

/**
 * Update draft invoice fields. Only draft invoices can be updated.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
export function updateInvoice(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();

  const invoice = getInvoice(id);
  if (!invoice) return null;
  if (invoice.invoice_status !== 'draft') {
    throw new Error(`Cannot update invoice ${id}: status is '${invoice.invoice_status}', only 'draft' invoices can be updated`);
  }

  const allowedFields = [
    'case_id', 'engagement_id', 'client_name', 'client_type', 'billing_address',
    'line_items_json', 'subtotal', 'adjustments_json', 'tax_amount',
    'total_amount', 'amount_paid', 'balance_due', 'payment_terms', 'notes',
  ];

  const sets = [];
  const params = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      sets.push(`${field} = ?`);
      if (field.endsWith('_json')) {
        params.push(stringifyJson(updates[field]));
      } else {
        params.push(updates[field]);
      }
    }
  }

  if (sets.length === 0) return invoice;

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).run(params);

  return getInvoice(id);
}

/**
 * Issue (send) an invoice. Sets issued_date and calculates due_date from payment_terms.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function issueInvoice(id) {
  const db = getDb();
  const now = new Date();
  const nowStr = now.toISOString();
  const invoice = getInvoice(id);
  if (!invoice) return null;

  const issuedDate = nowStr;
  const termDays = PAYMENT_TERMS_DAYS[invoice.payment_terms] ?? 30;
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + termDays);
  const dueDateStr = dueDate.toISOString();

  db.prepare(`
    UPDATE invoices
    SET invoice_status = 'sent', issued_date = ?, due_date = ?, updated_at = ?
    WHERE id = ?
  `).run(issuedDate, dueDateStr, nowStr, id);

  // Update pipeline stage to invoiced
  try {
    if (invoice.engagement_id) {
      db.prepare(`
        UPDATE pipeline_entries SET stage = 'invoiced', stage_entered_at = ?, updated_at = ?
        WHERE engagement_id = ?
      `).run(nowStr, nowStr, invoice.engagement_id);
    }
  } catch (err) {
    log.warn('invoice:pipeline-update', { error: err.message, invoiceId: id });
  }

  emitCaseEvent(
    invoice.case_id,
    'invoice.issued',
    `Invoice ${invoice.invoice_number} issued: $${invoice.total_amount}`,
    { invoiceId: id, invoiceNumber: invoice.invoice_number, dueDate: dueDateStr },
    { entityType: 'invoice', entityId: id },
  );

  return getInvoice(id);
}

/**
 * Record a payment against an invoice.
 * Updates balance, marks as 'paid' if balance reaches 0, or 'partial' if partial payment.
 *
 * @param {string} id
 * @param {{ amount: number, method?: string, reference?: string }} payment
 * @returns {Object|null}
 */
export function recordPayment(id, { amount, method, reference }) {
  const db = getDb();
  const now = new Date().toISOString();
  const invoice = getInvoice(id);
  if (!invoice) return null;

  const newAmountPaid = (invoice.amount_paid || 0) + amount;
  const newBalance = invoice.total_amount - newAmountPaid;
  const fullyPaid = newBalance <= 0;

  const newStatus = fullyPaid ? 'paid' : 'partial';
  const paidDate = fullyPaid ? now : invoice.paid_date;

  db.prepare(`
    UPDATE invoices
    SET amount_paid = ?, balance_due = ?, invoice_status = ?,
        paid_date = ?, payment_method = ?, payment_reference = ?, updated_at = ?
    WHERE id = ?
  `).run(
    newAmountPaid,
    Math.max(0, newBalance),
    newStatus,
    paidDate,
    method || invoice.payment_method || null,
    reference || invoice.payment_reference || null,
    now,
    id,
  );

  // Update pipeline stage to paid if fully paid
  if (fullyPaid) {
    try {
      if (invoice.engagement_id) {
        db.prepare(`
          UPDATE pipeline_entries SET stage = 'paid', stage_entered_at = ?, updated_at = ?
          WHERE engagement_id = ?
        `).run(now, now, invoice.engagement_id);
      }
    } catch (err) {
      log.warn('invoice:pipeline-paid', { error: err.message, invoiceId: id });
    }
  }

  emitCaseEvent(
    invoice.case_id,
    'invoice.payment_received',
    `Payment received on ${invoice.invoice_number}: $${amount}` + (fullyPaid ? ' (paid in full)' : ''),
    { invoiceId: id, amount, newBalance: Math.max(0, newBalance), fullyPaid, method, reference },
    { entityType: 'invoice', entityId: id },
  );

  return getInvoice(id);
}

/**
 * Void an invoice.
 *
 * @param {string} id
 * @param {string} [reason]
 * @returns {Object|null}
 */
export function voidInvoice(id, reason) {
  const db = getDb();
  const now = new Date().toISOString();
  const invoice = getInvoice(id);
  if (!invoice) return null;

  const notes = reason
    ? (invoice.notes ? invoice.notes + '\nVoid reason: ' + reason : 'Void reason: ' + reason)
    : invoice.notes;

  db.prepare(`
    UPDATE invoices SET invoice_status = 'void', notes = ?, updated_at = ? WHERE id = ?
  `).run(notes, now, id);

  emitCaseEvent(
    invoice.case_id,
    'invoice.voided',
    `Invoice ${invoice.invoice_number} voided` + (reason ? `: ${reason}` : ''),
    { invoiceId: id, reason },
    { entityType: 'invoice', entityId: id },
  );

  return getInvoice(id);
}

/**
 * Mark an invoice as overdue.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function markOverdue(id) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`UPDATE invoices SET invoice_status = 'overdue', updated_at = ? WHERE id = ?`)
    .run(now, id);

  return getInvoice(id);
}

/**
 * Send a reminder for an overdue/sent invoice.
 * Increments reminder_count and sets last_reminder_date.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function sendReminder(id) {
  const db = getDb();
  const now = new Date().toISOString();
  const invoice = getInvoice(id);
  if (!invoice) return null;

  const newCount = (invoice.reminder_count || 0) + 1;

  db.prepare(`
    UPDATE invoices SET reminder_count = ?, last_reminder_date = ?, updated_at = ? WHERE id = ?
  `).run(newCount, now, now, id);

  emitCaseEvent(
    invoice.case_id,
    'invoice.reminder_sent',
    `Payment reminder #${newCount} sent for ${invoice.invoice_number}`,
    { invoiceId: id, reminderCount: newCount },
    { entityType: 'invoice', entityId: id },
  );

  return getInvoice(id);
}

/**
 * Get aggregate invoice stats.
 *
 * @returns {Object} Summary stats
 */
export function getInvoiceSummary() {
  const db = getDb();

  const totalInvoiced = db.prepare(
    "SELECT COALESCE(SUM(total_amount), 0) AS total FROM invoices WHERE invoice_status != 'void'"
  ).get();

  const totalPaid = db.prepare(
    "SELECT COALESCE(SUM(amount_paid), 0) AS total FROM invoices WHERE invoice_status != 'void'"
  ).get();

  const outstanding = db.prepare(
    "SELECT COALESCE(SUM(balance_due), 0) AS total FROM invoices WHERE invoice_status IN ('sent', 'partial', 'overdue')"
  ).get();

  const overdue = db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(balance_due), 0) AS total FROM invoices WHERE invoice_status = 'overdue'"
  ).get();

  // Average days to pay (for paid invoices with both issued and paid dates)
  const avgDays = db.prepare(`
    SELECT AVG(
      CAST((julianday(paid_date) - julianday(issued_date)) AS REAL)
    ) AS avg_days
    FROM invoices
    WHERE invoice_status = 'paid'
      AND issued_date IS NOT NULL
      AND paid_date IS NOT NULL
  `).get();

  return {
    totalInvoiced: totalInvoiced.total,
    totalPaid: totalPaid.total,
    outstanding: outstanding.total,
    overdueCount: overdue.n,
    overdueAmount: overdue.total,
    averageDaysToPay: avgDays.avg_days ? Math.round(avgDays.avg_days * 10) / 10 : null,
  };
}

/**
 * Get overdue invoices (past due, not paid/void).
 *
 * @returns {Object[]}
 */
export function getOverdueInvoices() {
  const db = getDb();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT * FROM invoices
    WHERE due_date IS NOT NULL
      AND due_date < ?
      AND invoice_status IN ('sent', 'partial', 'overdue')
    ORDER BY due_date ASC
  `).all(now);

  return rows.map(hydrateInvoice);
}

/**
 * Auto-create an invoice from an engagement record.
 *
 * @param {string} engagementId
 * @returns {Object} The created invoice
 */
export function createInvoiceFromEngagement(engagementId) {
  const db = getDb();
  const eng = db.prepare('SELECT * FROM engagement_records WHERE id = ?').get(engagementId);
  if (!eng) throw new Error(`Engagement not found: ${engagementId}`);

  const lineItems = [
    {
      description: `Appraisal services â€” ${eng.engagement_type}`,
      quantity: 1,
      unit_price: eng.fee_agreed,
      amount: eng.fee_agreed,
    },
  ];

  // Add fee adjustments as separate line items
  const adjustments = parseJson(eng.fee_adjustments_json, []);
  for (const adj of adjustments) {
    lineItems.push({
      description: `Fee adjustment: ${adj.reason}`,
      quantity: 1,
      unit_price: adj.amount,
      amount: adj.amount,
    });
  }

  return createInvoice({
    case_id: eng.case_id,
    engagement_id: engagementId,
    client_name: eng.client_name,
    client_type: eng.client_type,
    line_items_json: lineItems,
  });
}

export default {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  issueInvoice,
  recordPayment,
  voidInvoice,
  markOverdue,
  sendReminder,
  getInvoiceSummary,
  getOverdueInvoices,
  generateInvoiceNumber,
  createInvoiceFromEngagement,
};

