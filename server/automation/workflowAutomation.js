/**
 * server/automation/workflowAutomation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Workflow automation rules engine.
 *
 * Users define rules that automatically trigger actions:
 *   - "When an AMC order arrives → auto-create case + schedule inspection"
 *   - "When all sections are approved → auto-export + email to client"
 *   - "When a revision request arrives → notify me + auto-generate AI responses"
 *   - "When a report is overdue → send reminder to AMC"
 *   - "When inspection is complete → auto-start generation"
 *   - "When QC score < B → flag for manual review"
 *
 * This is the "set it and forget it" automation layer.
 */

import { getDb } from '../db/database.js';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { batchGenerate } from '../generation/batchGenerator.js';
import { deliverReport } from '../integrations/emailDelivery.js';
import { createNotification } from '../notifications/notificationService.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureAutomationSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT DEFAULT '{}',
      action_type TEXT NOT NULL,
      action_config TEXT DEFAULT '{}',
      is_active   INTEGER DEFAULT 1,
      run_count   INTEGER DEFAULT 0,
      last_run    TEXT,
      created_at  TEXT DEFAULT (datetime("now"))
    );

    CREATE TABLE IF NOT EXISTS automation_log (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      rule_id     TEXT NOT NULL,
      case_id     TEXT,
      trigger_type TEXT,
      action_type TEXT,
      status      TEXT DEFAULT 'success',
      details     TEXT,
      created_at  TEXT DEFAULT (datetime("now"))
    );
    CREATE INDEX IF NOT EXISTS idx_auto_log ON automation_log(rule_id, created_at DESC);
  `);
}

// ── Trigger Types ────────────────────────────────────────────────────────────

const TRIGGER_TYPES = {
  order_received: { label: 'New order received', description: 'Fires when an AMC/client order arrives' },
  inspection_complete: { label: 'Inspection completed', description: 'Fires when inspection is marked complete' },
  all_sections_approved: { label: 'All sections approved', description: 'Fires when every section is approved' },
  report_exported: { label: 'Report exported', description: 'Fires when a report is exported' },
  revision_received: { label: 'Revision request received', description: 'Fires when a lender requests revisions' },
  due_date_approaching: { label: 'Due date approaching', description: 'Fires 24h before due date' },
  report_overdue: { label: 'Report overdue', description: 'Fires when a report passes its due date' },
  qc_grade_low: { label: 'QC grade below threshold', description: 'Fires when QC review returns a low grade' },
  case_created: { label: 'New case created', description: 'Fires when any new case is created' },
};

const ACTION_TYPES = {
  auto_generate: { label: 'Auto-generate all sections', description: 'Runs batch generation for all sections' },
  auto_export: { label: 'Auto-export report', description: 'Exports UAD 3.6 XML + PDF' },
  email_report: { label: 'Email report to client', description: 'Sends completed report via email' },
  notify: { label: 'Send notification', description: 'Creates an in-app notification' },
  schedule_inspection: { label: 'Auto-schedule inspection', description: 'Creates inspection record' },
  run_qc: { label: 'Run QC review', description: 'Triggers deep AI QC review' },
  create_invoice: { label: 'Auto-create invoice', description: 'Generates invoice from order fee' },
  enrich_data: { label: 'Auto-enrich with public records', description: 'Pulls public records + market context' },
};

/**
 * Create an automation rule.
 */
export function createRule(userId, { name, triggerType, triggerConfig, actionType, actionConfig }) {
  if (!TRIGGER_TYPES[triggerType]) throw new Error(`Invalid trigger: ${triggerType}`);
  if (!ACTION_TYPES[actionType]) throw new Error(`Invalid action: ${actionType}`);

  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO automation_rules (id, user_id, name, trigger_type, trigger_config, action_type, action_config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, triggerType, JSON.stringify(triggerConfig || {}), actionType, JSON.stringify(actionConfig || {}));

  log.info('automation:rule-created', { userId, ruleId: id, trigger: triggerType, action: actionType });
  return { ruleId: id, name, triggerType, actionType };
}

/**
 * Get all rules for a user.
 */
export function getRules(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM automation_rules WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    .map(r => ({ ...r, triggerConfig: JSON.parse(r.trigger_config || '{}'), actionConfig: JSON.parse(r.action_config || '{}'), is_active: Boolean(r.is_active) }));
}

/**
 * Fire a trigger — check all active rules and execute matching actions.
 *
 * @param {string} triggerType
 * @param {Object} context — { caseId, userId, data }
 */
export async function fireTrigger(triggerType, context) {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM automation_rules WHERE trigger_type = ? AND is_active = 1').all(triggerType);

  if (rules.length === 0) return { triggered: 0 };

  const results = [];
  for (const rule of rules) {
    // Check if rule belongs to the right user (if context has userId)
    if (context.userId && rule.user_id !== context.userId && rule.user_id !== 'default') continue;

    try {
      await executeAction(rule.action_type, JSON.parse(rule.action_config || '{}'), context);

      db.prepare(`UPDATE automation_rules SET run_count = run_count + 1, last_run = datetime("now") WHERE id = ?`).run(rule.id);
      db.prepare('INSERT INTO automation_log (rule_id, case_id, trigger_type, action_type, status, details) VALUES (?, ?, ?, ?, ?, ?)')
        .run(rule.id, context.caseId || null, triggerType, rule.action_type, 'success', rule.name);

      results.push({ ruleId: rule.id, name: rule.name, action: rule.action_type, status: 'success' });
      log.info('automation:fired', { ruleId: rule.id, trigger: triggerType, action: rule.action_type, caseId: context.caseId });
    } catch (err) {
      db.prepare('INSERT INTO automation_log (rule_id, case_id, trigger_type, action_type, status, details) VALUES (?, ?, ?, ?, ?, ?)')
        .run(rule.id, context.caseId || null, triggerType, rule.action_type, 'failed', err.message);
      results.push({ ruleId: rule.id, name: rule.name, action: rule.action_type, status: 'failed', error: err.message });
    }
  }

  return { triggered: results.length, results };
}

/**
 * Execute an automation action.
 */
async function executeAction(actionType, config, context) {
  const { caseId, userId } = context;

  switch (actionType) {
    case 'auto_generate':
      if (!caseId) throw new Error('caseId required');
      await batchGenerate(caseId, { userId: userId || 'default', skipExisting: true });
      break;

    case 'email_report':
      if (!caseId || !config.recipient) throw new Error('caseId and recipient required');
      await deliverReport(caseId, userId || 'default', { recipient: config.recipient });
      break;

    case 'notify':
      createNotification(userId || 'default', {
        type: config.notificationType || 'automation',
        title: config.title || 'Automation triggered',
        message: config.message || `Rule fired for case ${caseId}`,
        priority: config.priority || 'normal',
        caseId,
      });
      break;

    case 'create_invoice': {
      const { createInvoice } = await import('../billing/invoiceGenerator.js');
      const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
      const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
      const fee = parseFloat(facts.order?.fee || config.defaultFee || 0);
      if (fee > 0) createInvoice(caseId, userId || 'default', { amount: fee });
      break;
    }

    case 'enrich_data': {
      const { pullPublicRecords } = await import('../data/publicRecordsService.js');
      await pullPublicRecords(caseId);
      break;
    }

    case 'run_qc': {
      const { deepQcReview } = await import('../ai/deepQcReviewer.js');
      await deepQcReview(caseId);
      break;
    }

    default:
      log.warn('automation:unknown-action', { actionType });
  }
}

/**
 * Get automation log for a user.
 */
export function getAutomationLog(userId, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT al.*, ar.name as rule_name
    FROM automation_log al
    JOIN automation_rules ar ON ar.id = al.rule_id
    WHERE ar.user_id = ?
    ORDER BY al.created_at DESC LIMIT ?
  `).all(userId, limit);
}

export { TRIGGER_TYPES, ACTION_TYPES };
export default { ensureAutomationSchema, createRule, getRules, fireTrigger, getAutomationLog, TRIGGER_TYPES, ACTION_TYPES };
