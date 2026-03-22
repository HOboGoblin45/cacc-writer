/**
 * server/integrations/amcConnector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AMC (Appraisal Management Company) Integration Hub
 *
 * AMCs are how 80%+ of appraisal orders are delivered. Integrating with
 * their APIs means orders flow directly into cacc-writer without
 * manual PDF uploading.
 *
 * Supported AMC platforms:
 *   - Mercury Network (most popular, used by CoreLogic)
 *   - Reggora (modern API)
 *   - Anow (growing platform)
 *   - Generic webhook receiver (for custom AMCs)
 *
 * Flow:
 *   1. AMC sends order via webhook or API
 *   2. We parse it into our internal format
 *   3. Auto-create case with populated facts
 *   4. Optionally auto-trigger the full pipeline
 *   5. When complete, deliver XML/PDF back to AMC
 */

import { getDb } from '../db/database.js';
import { parseOrderForm } from '../intake/smartOrderParser.js';
import { dbRun, dbGet } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureAmcSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS amc_connections (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id         TEXT NOT NULL,
      platform        TEXT NOT NULL,
      name            TEXT NOT NULL,
      api_key         TEXT,
      api_secret      TEXT,
      webhook_secret  TEXT DEFAULT (lower(hex(randomblob(16)))),
      endpoint_url    TEXT,
      is_active       INTEGER DEFAULT 1,
      config_json     TEXT DEFAULT '{}',
      last_order_at   TEXT,
      total_orders    INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime("now")),
      updated_at      TEXT DEFAULT (datetime("now"))
    );

    CREATE TABLE IF NOT EXISTS amc_orders (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      connection_id   TEXT NOT NULL REFERENCES amc_connections(id),
      external_id     TEXT,
      case_id         TEXT,
      status          TEXT DEFAULT 'received',
      raw_payload     TEXT,
      parsed_facts    TEXT,
      delivery_status TEXT,
      delivery_url    TEXT,
      received_at     TEXT DEFAULT (datetime("now")),
      completed_at    TEXT,
      created_at      TEXT DEFAULT (datetime("now"))
    );
    CREATE INDEX IF NOT EXISTS idx_amc_orders_connection ON amc_orders(connection_id);
    CREATE INDEX IF NOT EXISTS idx_amc_orders_case ON amc_orders(case_id);
  `);
}

/**
 * Register a new AMC connection.
 */
export function registerConnection(userId, { platform, name, apiKey, apiSecret, endpointUrl, config }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  const webhookSecret = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO amc_connections (id, user_id, platform, name, api_key, api_secret, webhook_secret, endpoint_url, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, platform, name, apiKey || null, apiSecret || null, webhookSecret, endpointUrl || null, JSON.stringify(config || {}));

  log.info('amc:connection-registered', { userId, platform, name });

  return {
    id,
    platform,
    name,
    webhookUrl: `/api/amc/webhook/${id}`,
    webhookSecret,
  };
}

/**
 * Get all AMC connections for a user.
 */
export function getConnections(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM amc_connections WHERE user_id = ? ORDER BY name').all(userId)
    .map(c => ({
      ...c,
      config: JSON.parse(c.config_json || '{}'),
      is_active: Boolean(c.is_active),
      // Don't expose secrets
      api_key: c.api_key ? '••••' + c.api_key.slice(-4) : null,
      api_secret: undefined,
    }));
}

/**
 * Process an incoming AMC order webhook.
 */
export async function processWebhookOrder(connectionId, payload, signature) {
  const db = getDb();
  const connection = db.prepare('SELECT * FROM amc_connections WHERE id = ? AND is_active = 1').get(connectionId);
  if (!connection) throw new Error('AMC connection not found or inactive');

  // Verify webhook signature if configured
  if (connection.webhook_secret && signature) {
    const expected = crypto.createHmac('sha256', connection.webhook_secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    if (signature !== expected && signature !== `sha256=${expected}`) {
      throw new Error('Invalid webhook signature');
    }
  }

  const orderId = crypto.randomBytes(8).toString('hex');

  // Store raw order
  db.prepare(`
    INSERT INTO amc_orders (id, connection_id, external_id, raw_payload, status)
    VALUES (?, ?, ?, ?, 'received')
  `).run(orderId, connectionId, payload.orderId || payload.order_id || null, JSON.stringify(payload));

  // Parse based on platform
  let orderText = '';
  const platform = connection.platform;

  if (platform === 'mercury') {
    orderText = parseMercuryPayload(payload);
  } else if (platform === 'reggora') {
    orderText = parseReggoraPayload(payload);
  } else if (platform === 'anow') {
    orderText = parseAnowPayload(payload);
  } else {
    // Generic — stringify the payload
    orderText = formatGenericPayload(payload);
  }

  // Use smart parser to structure the data
  try {
    const parsed = await parseOrderForm(orderText);

    const caseId = crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    const formType = parsed.facts.order?.formType || '1004';

    dbRun('INSERT INTO case_records (case_id, form_type, case_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [caseId, formType, 'received', now, now]);

    dbRun('INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [caseId, JSON.stringify(parsed.facts), now, now]);

    // Update order record
    db.prepare('UPDATE amc_orders SET case_id = ?, parsed_facts = ?, status = ? WHERE id = ?')
      .run(caseId, JSON.stringify(parsed.facts), 'parsed', orderId);

    // Update connection stats
    db.prepare(`UPDATE amc_connections SET last_order_at = datetime("now"), total_orders = total_orders + 1 WHERE id = ?`)
      .run(connectionId);

    log.info('amc:order-processed', { connectionId, platform, orderId, caseId, fieldCount: parsed.meta.fieldCount });

    return { orderId, caseId, formType, fieldCount: parsed.meta.fieldCount, status: 'parsed' };
  } catch (err) {
    db.prepare('UPDATE amc_orders SET status = ? WHERE id = ?').run('parse_failed', orderId);
    log.error('amc:parse-failed', { connectionId, orderId, error: err.message });
    throw err;
  }
}

// ── Platform-specific parsers ────────────────────────────────────────────────

function parseMercuryPayload(payload) {
  // Mercury Network order format
  const parts = [];
  if (payload.PropertyAddress) parts.push(`Property Address: ${payload.PropertyAddress}`);
  if (payload.PropertyCity) parts.push(`City: ${payload.PropertyCity}`);
  if (payload.PropertyState) parts.push(`State: ${payload.PropertyState}`);
  if (payload.PropertyZip) parts.push(`Zip: ${payload.PropertyZip}`);
  if (payload.PropertyCounty) parts.push(`County: ${payload.PropertyCounty}`);
  if (payload.BorrowerName) parts.push(`Borrower: ${payload.BorrowerName}`);
  if (payload.LenderName) parts.push(`Lender: ${payload.LenderName}`);
  if (payload.LoanNumber) parts.push(`Loan Number: ${payload.LoanNumber}`);
  if (payload.OrderType) parts.push(`Form Type: ${payload.OrderType}`);
  if (payload.LoanType) parts.push(`Loan Type: ${payload.LoanType}`);
  if (payload.PurchasePrice) parts.push(`Sale Price: ${payload.PurchasePrice}`);
  if (payload.DueDate) parts.push(`Due Date: ${payload.DueDate}`);
  if (payload.Fee) parts.push(`Fee: ${payload.Fee}`);
  if (payload.Instructions) parts.push(`Special Instructions: ${payload.Instructions}`);
  return parts.join('\n');
}

function parseReggoraPayload(payload) {
  const order = payload.order || payload;
  const parts = [];
  if (order.property?.address) parts.push(`Property Address: ${order.property.address}`);
  if (order.property?.city) parts.push(`City: ${order.property.city}`);
  if (order.property?.state) parts.push(`State: ${order.property.state}`);
  if (order.property?.zip) parts.push(`Zip: ${order.property.zip}`);
  if (order.borrower?.name) parts.push(`Borrower: ${order.borrower.name}`);
  if (order.lender?.name) parts.push(`Lender: ${order.lender.name}`);
  if (order.loan_number) parts.push(`Loan Number: ${order.loan_number}`);
  if (order.product_type) parts.push(`Form Type: ${order.product_type}`);
  if (order.purchase_price) parts.push(`Sale Price: ${order.purchase_price}`);
  if (order.due_date) parts.push(`Due Date: ${order.due_date}`);
  if (order.fee) parts.push(`Fee: ${order.fee}`);
  return parts.join('\n');
}

function parseAnowPayload(payload) {
  const parts = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value && typeof value === 'string') {
      parts.push(`${key}: ${value}`);
    } else if (value && typeof value === 'object') {
      for (const [k2, v2] of Object.entries(value)) {
        if (v2 && typeof v2 === 'string') parts.push(`${key}.${k2}: ${v2}`);
      }
    }
  }
  return parts.join('\n');
}

function formatGenericPayload(payload) {
  const parts = [];
  const flatten = (obj, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flatten(value, fullKey);
      } else if (value != null && value !== '') {
        parts.push(`${fullKey}: ${value}`);
      }
    }
  };
  flatten(payload);
  return parts.join('\n');
}

export default {
  ensureAmcSchema, registerConnection, getConnections, processWebhookOrder,
};
