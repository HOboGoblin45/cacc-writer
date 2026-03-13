/**
 * server/business/billingService.js
 * -----------------------------------
 * Billing event tracking service.
 *
 * Usage:
 *   import { recordBillingEvent, getBillingHistory, getBillingSummary } from './billingService.js';
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return 'bill_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function parseEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    metadata: JSON.parse(row.metadata_json || '{}'),
    createdAt: row.created_at,
  };
}

// ── Billing Operations ───────────────────────────────────────────────────────

/**
 * Record a billing event.
 */
export function recordBillingEvent(data) {
  const id = data.id || genId();

  if (!data.eventType && !data.event_type) return { error: 'eventType is required' };

  dbRun(
    `INSERT INTO billing_events (id, tenant_id, event_type, amount, currency, description, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.tenantId || data.tenant_id || null,
      data.eventType || data.event_type,
      data.amount || 0,
      data.currency || 'USD',
      data.description || '',
      JSON.stringify(data.metadata || {}),
      now(),
    ]
  );

  log.info('billing:event-recorded', { id, eventType: data.eventType || data.event_type });
  return { event: parseEvent(dbGet('SELECT * FROM billing_events WHERE id = ?', [id])) };
}

/**
 * Get billing history for a tenant.
 */
export function getBillingHistory(tenantId, filters = {}) {
  let sql = 'SELECT * FROM billing_events WHERE 1=1';
  const params = [];

  if (tenantId) {
    sql += ' AND tenant_id = ?';
    params.push(tenantId);
  }
  if (filters.eventType || filters.event_type) {
    sql += ' AND event_type = ?';
    params.push(filters.eventType || filters.event_type);
  }
  if (filters.since) {
    sql += ' AND created_at >= ?';
    params.push(filters.since);
  }
  if (filters.until) {
    sql += ' AND created_at <= ?';
    params.push(filters.until);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(filters.limit, 10));
  }

  const rows = dbAll(sql, params);
  return rows.map(parseEvent);
}

/**
 * Get billing summary for a tenant and period.
 */
export function getBillingSummary(tenantId, period = 'month') {
  let since;
  const nowDate = new Date();

  switch (period) {
    case 'week':
      since = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'year':
      since = new Date(nowDate.getFullYear(), 0, 1).toISOString();
      break;
    case 'month':
    default:
      since = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString();
      break;
  }

  let sql = 'SELECT * FROM billing_events WHERE created_at >= ?';
  const params = [since];

  if (tenantId) {
    sql += ' AND tenant_id = ?';
    params.push(tenantId);
  }

  const events = dbAll(sql, params);

  // Aggregate by event type
  const byType = {};
  let totalAmount = 0;

  for (const evt of events) {
    const type = evt.event_type;
    if (!byType[type]) {
      byType[type] = { count: 0, totalAmount: 0 };
    }
    byType[type].count++;
    byType[type].totalAmount += evt.amount || 0;
    totalAmount += evt.amount || 0;
  }

  return {
    tenantId,
    period,
    since,
    totalEvents: events.length,
    totalAmount,
    currency: 'USD',
    byEventType: byType,
  };
}

/**
 * Get available billing plans.
 */
export function getActivePlans() {
  return [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      currency: 'USD',
      maxUsers: 1,
      maxCases: 10,
      features: ['basic_generation', 'manual_export'],
    },
    {
      id: 'standard',
      name: 'Standard',
      price: 99,
      currency: 'USD',
      maxUsers: 5,
      maxCases: 500,
      features: ['ai_generation', 'document_intake', 'export_pdf', 'comp_intelligence'],
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 249,
      currency: 'USD',
      maxUsers: 20,
      maxCases: 2000,
      features: ['ai_generation', 'document_intake', 'export_pdf', 'export_xml', 'comp_intelligence', 'advanced_analytics'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 499,
      currency: 'USD',
      maxUsers: 100,
      maxCases: 10000,
      features: ['ai_generation', 'document_intake', 'export_pdf', 'export_xml', 'comp_intelligence', 'advanced_analytics', 'multi_tenant', 'billing_integration'],
    },
  ];
}

export default {
  recordBillingEvent,
  getBillingHistory,
  getBillingSummary,
  getActivePlans,
};
