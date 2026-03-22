/**
 * server/integrations/webhookNotifier.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Outbound webhook + notification integrations.
 *
 * Sends real-time notifications to external services:
 *   - Slack (channel messages)
 *   - SMS (via Twilio)
 *   - Email (quick alerts, separate from report delivery)
 *   - Custom webhooks (Zapier, Make, n8n, etc.)
 *   - Discord
 *
 * Triggers: order received, report complete, revision request, overdue, etc.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureWebhookSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      url         TEXT,
      config_json TEXT DEFAULT '{}',
      is_active   INTEGER DEFAULT 1,
      last_sent   TEXT,
      send_count  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhook_endpoints(user_id, is_active);
  `);
}

/**
 * Register a webhook endpoint.
 */
export function registerEndpoint(userId, { name, type, url, config }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  const validTypes = ['slack', 'discord', 'sms', 'email', 'zapier', 'custom'];
  if (!validTypes.includes(type)) throw new Error(`Invalid type. Use: ${validTypes.join(', ')}`);

  db.prepare('INSERT INTO webhook_endpoints (id, user_id, name, type, url, config_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, type, url || null, JSON.stringify(config || {}));

  return { endpointId: id, name, type };
}

/**
 * Get user's webhook endpoints.
 */
export function getEndpoints(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ? ORDER BY name').all(userId)
    .map(e => ({ ...e, config: JSON.parse(e.config_json || '{}'), is_active: Boolean(e.is_active) }));
}

/**
 * Send notification to all active endpoints for a user.
 */
export async function notifyUser(userId, event) {
  const db = getDb();
  const endpoints = db.prepare('SELECT * FROM webhook_endpoints WHERE user_id = ? AND is_active = 1').all(userId);

  const results = [];
  for (const ep of endpoints) {
    try {
      const config = JSON.parse(ep.config_json || '{}');
      await sendToEndpoint(ep.type, ep.url, config, event);
      db.prepare("UPDATE webhook_endpoints SET last_sent = datetime('now'), send_count = send_count + 1 WHERE id = ?").run(ep.id);
      results.push({ endpointId: ep.id, name: ep.name, type: ep.type, status: 'sent' });
    } catch (err) {
      results.push({ endpointId: ep.id, name: ep.name, type: ep.type, status: 'failed', error: err.message });
    }
  }

  return results;
}

async function sendToEndpoint(type, url, config, event) {
  const message = formatMessage(event);

  switch (type) {
    case 'slack':
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*${event.title}*\n${event.message}` },
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      break;

    case 'discord':
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: message,
          embeds: [{
            title: event.title,
            description: event.message,
            color: event.priority === 'critical' ? 0xff0000 : event.priority === 'high' ? 0xffaa00 : 0x00ff00,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      break;

    case 'sms': {
      const twilioSid = config.twilioSid || process.env.TWILIO_SID;
      const twilioToken = config.twilioToken || process.env.TWILIO_TOKEN;
      const twilioFrom = config.twilioFrom || process.env.TWILIO_FROM;
      const toPhone = config.phone;
      if (!twilioSid || !toPhone) throw new Error('Twilio not configured');

      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
        },
        body: `To=${encodeURIComponent(toPhone)}&From=${encodeURIComponent(twilioFrom)}&Body=${encodeURIComponent(message)}`,
        signal: AbortSignal.timeout(10000),
      });
      break;
    }

    case 'zapier':
    case 'custom':
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
        body: JSON.stringify({
          event: event.type,
          title: event.title,
          message: event.message,
          caseId: event.caseId,
          timestamp: new Date().toISOString(),
          data: event.data || {},
        }),
        signal: AbortSignal.timeout(10000),
      });
      break;

    case 'email': {
      // Quick alert email (not full report delivery)
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: config.email,
        subject: `[Appraisal Agent] ${event.title}`,
        text: message,
      });
      break;
    }
  }
}

function formatMessage(event) {
  let msg = `📋 ${event.title}`;
  if (event.message) msg += `\n${event.message}`;
  if (event.caseId) msg += `\nCase: ${event.caseId}`;
  return msg;
}

export default { ensureWebhookSchema, registerEndpoint, getEndpoints, notifyUser };
