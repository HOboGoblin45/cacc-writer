/**
 * tests/unit/businessOps.test.mjs
 * --------------------------------
 * Unit tests for Phase 12 Business Operations:
 *   - Fee quote lifecycle
 *   - Engagement tracking
 *   - Invoice management
 *   - Pipeline dashboard
 */

import assert from 'assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

// ── Setup: isolated temp DB ──────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-business-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'business-test.db');

const { getDb } = await import('../../server/db/database.js');
getDb();

// ── Import modules under test ────────────────────────────────────────────────

const {
  createQuote, getQuote, listQuotes, updateQuote,
  sendQuote, acceptQuote, declineQuote, expireQuote,
  convertQuoteToCaseAndEngagement, getQuoteSummary, calculateFee,
} = await import('../../server/business/quoteService.js');

const {
  createEngagement, getEngagement, listEngagements, updateEngagement,
  acceptEngagement, putOnHold, resumeEngagement, completeEngagement,
  cancelEngagement, addFeeAdjustment, getEngagementsByDueDate, getOverdueEngagements,
} = await import('../../server/business/engagementService.js');

const {
  createInvoice, getInvoice, listInvoices, updateInvoice,
  issueInvoice, recordPayment, voidInvoice, sendReminder,
  getInvoiceSummary, getOverdueInvoices, generateInvoiceNumber,
  createInvoiceFromEngagement,
} = await import('../../server/business/invoiceService.js');

const {
  createPipelineEntry, getPipelineEntry, listPipeline, updatePipelineEntry,
  advanceStage, setPriority, addTag, removeTag,
  getPipelineSummary, getAppraisersWorkload,
} = await import('../../server/business/pipelineService.js');

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedCase(caseId) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO case_records (case_id, form_type) VALUES (?, '1004')`).run(caseId);
    db.prepare(`INSERT INTO case_facts (case_id, facts_json, provenance_json, updated_at)
      VALUES (?, '{}', '{}', datetime('now'))`).run(caseId);
  } catch { /* may already exist */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fee Quotes
// ═══════════════════════════════════════════════════════════════════════════

await test('calculateFee returns base fee for standard SFR', () => {
  const result = calculateFee({ propertyType: 'sfr', formType: '1004', complexity: 'standard' });
  assert.ok(result.baseFee > 0, 'should have base fee');
  assert.equal(result.rushFee, 0, 'no rush fee by default');
  assert.equal(result.totalFee, result.baseFee + result.complexityAdjustment + result.rushFee);
});

await test('calculateFee adds rush fee when requested', () => {
  const result = calculateFee({ propertyType: 'sfr', formType: '1004', complexity: 'standard', rush: true });
  assert.ok(result.rushFee > 0, 'should have rush fee');
  assert.ok(result.totalFee > result.baseFee, 'total should exceed base');
});

await test('createQuote creates a quote with calculated totals', () => {
  const quote = createQuote({
    client_name: 'Test AMC',
    client_type: 'amc',
    property_address: '123 Main St',
    property_type: 'sfr',
    form_type: '1004',
    complexity: 'standard',
    base_fee: 450,
    total_fee: 450,
  });
  assert.ok(quote.id.startsWith('quot_'), 'should have quot_ prefix');
  assert.equal(quote.quote_status, 'draft');
  assert.equal(quote.client_name, 'Test AMC');
  assert.ok(quote.total_fee > 0, 'should have total fee');
});

await test('sendQuote transitions draft to sent', () => {
  const quote = createQuote({
    client_name: 'Send Test AMC', client_type: 'amc',
    property_address: '456 Oak Ave', base_fee: 500, total_fee: 500,
  });
  const sent = sendQuote(quote.id);
  assert.equal(sent.quote_status, 'sent');
  assert.ok(sent.valid_until, 'should have valid_until date');
});

await test('acceptQuote and declineQuote work correctly', () => {
  const q1 = createQuote({ client_name: 'Accept Test', client_type: 'lender', property_address: '1 A St', base_fee: 400, total_fee: 400 });
  const q2 = createQuote({ client_name: 'Decline Test', client_type: 'lender', property_address: '2 B St', base_fee: 400, total_fee: 400 });

  sendQuote(q1.id);
  sendQuote(q2.id);

  const accepted = acceptQuote(q1.id);
  assert.equal(accepted.quote_status, 'accepted');

  const declined = declineQuote(q2.id, 'Too expensive');
  assert.equal(declined.quote_status, 'declined');
});

await test('convertQuoteToCaseAndEngagement creates engagement', () => {
  const caseId = 'case-convert-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const quote = createQuote({
    client_name: 'Convert AMC', client_type: 'amc',
    property_address: '789 Convert Ln', property_type: 'sfr',
    form_type: '1004', base_fee: 500, total_fee: 500,
  });
  sendQuote(quote.id);
  acceptQuote(quote.id);

  const result = convertQuoteToCaseAndEngagement(quote.id, caseId);
  assert.ok(result.engagement, 'should create engagement');
  assert.equal(result.engagement.case_id, caseId);

  const updated = getQuote(quote.id);
  assert.equal(updated.quote_status, 'converted');
});

await test('getQuoteSummary returns aggregate stats', () => {
  const summary = getQuoteSummary();
  assert.ok(summary.totalQuotes >= 4, 'should have at least 4 quotes');
  assert.ok(typeof summary.byStatus === 'object', 'should have byStatus breakdown');
});

// ═══════════════════════════════════════════════════════════════════════════
// Engagements
// ═══════════════════════════════════════════════════════════════════════════

await test('createEngagement creates engagement record', () => {
  const caseId = 'case-eng-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const eng = createEngagement({
    case_id: caseId,
    client_name: 'Engagement AMC',
    client_type: 'amc',
    engagement_type: 'standard',
    fee_agreed: 500,
    due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });
  assert.ok(eng.id.startsWith('eng_'), 'should have eng_ prefix');
  assert.equal(eng.engagement_status, 'pending');
  assert.equal(eng.fee_agreed, 500);
});

await test('engagement lifecycle: accept → complete', () => {
  const caseId = 'case-eng2-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const eng = createEngagement({
    case_id: caseId, client_name: 'Lifecycle AMC', client_type: 'amc',
    engagement_type: 'standard', fee_agreed: 600,
  });
  const accepted = acceptEngagement(eng.id);
  assert.equal(accepted.engagement_status, 'accepted');

  const completed = completeEngagement(eng.id);
  assert.equal(completed.engagement_status, 'completed');
});

await test('putOnHold and resumeEngagement work', () => {
  const caseId = 'case-eng3-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const eng = createEngagement({
    case_id: caseId, client_name: 'Hold AMC', client_type: 'amc',
    engagement_type: 'standard', fee_agreed: 550,
  });
  acceptEngagement(eng.id);

  const held = putOnHold(eng.id, 'Waiting for access');
  assert.equal(held.engagement_status, 'on_hold');

  const resumed = resumeEngagement(eng.id);
  assert.equal(resumed.engagement_status, 'active');
});

await test('addFeeAdjustment updates engagement fee', () => {
  const caseId = 'case-eng4-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const eng = createEngagement({
    case_id: caseId, client_name: 'Fee Adj AMC', client_type: 'amc',
    engagement_type: 'standard', fee_agreed: 500,
  });
  const adjusted = addFeeAdjustment(eng.id, { reason: 'Complexity increase', amount: 100 });
  assert.equal(adjusted.fee_agreed, 600);
});

// ═══════════════════════════════════════════════════════════════════════════
// Invoices
// ═══════════════════════════════════════════════════════════════════════════

await test('generateInvoiceNumber produces formatted number', () => {
  const num1 = generateInvoiceNumber();
  assert.ok(num1.startsWith('CACC-INV-'), 'should have prefix');
  assert.ok(num1.length > 10, 'should have sufficient length');
});

await test('createInvoice creates invoice with line items', () => {
  const caseId = 'case-inv-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const inv = createInvoice({
    case_id: caseId, client_name: 'Invoice Client', client_type: 'amc',
    line_items_json: [{ description: 'Appraisal fee', quantity: 1, unit_price: 500, amount: 500 }],
    subtotal: 500, total_amount: 500, balance_due: 500,
  });
  assert.ok(inv.id.startsWith('inv_'), 'should have inv_ prefix');
  assert.equal(inv.invoice_status, 'draft');
  assert.equal(inv.total_amount, 500);
});

await test('issueInvoice sets status and due date', () => {
  const caseId = 'case-inv2-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const inv = createInvoice({
    case_id: caseId, client_name: 'Issue Client', client_type: 'lender',
    line_items_json: [{ description: 'Appraisal', quantity: 1, unit_price: 450, amount: 450 }],
    subtotal: 450, total_amount: 450, balance_due: 450,
  });
  const issued = issueInvoice(inv.id);
  assert.equal(issued.invoice_status, 'sent');
  assert.ok(issued.issued_date, 'should have issued_date');
  assert.ok(issued.due_date, 'should have due_date');
});

await test('recordPayment updates balance and marks paid when full', () => {
  const caseId = 'case-inv3-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const inv = createInvoice({
    case_id: caseId, client_name: 'Payment Client', client_type: 'amc',
    line_items_json: [{ description: 'Appraisal', quantity: 1, unit_price: 400, amount: 400 }],
    subtotal: 400, total_amount: 400, balance_due: 400,
  });
  issueInvoice(inv.id);
  const paid = recordPayment(inv.id, { amount: 400, method: 'check', reference: 'CHK-1234' });
  assert.equal(paid.invoice_status, 'paid');
  assert.equal(paid.balance_due, 0);
  assert.equal(paid.amount_paid, 400);
});

await test('voidInvoice marks invoice as void', () => {
  const caseId = 'case-inv4-' + crypto.randomBytes(4).toString('hex');
  seedCase(caseId);

  const inv = createInvoice({
    case_id: caseId, client_name: 'Void Client', client_type: 'private',
    line_items_json: [{ description: 'Appraisal', quantity: 1, unit_price: 300, amount: 300 }],
    subtotal: 300, total_amount: 300, balance_due: 300,
  });
  const voided = voidInvoice(inv.id, 'Duplicate');
  assert.equal(voided.invoice_status, 'void');
});

await test('getInvoiceSummary returns aggregate stats', () => {
  const summary = getInvoiceSummary();
  assert.ok(typeof summary.totalInvoiced === 'number', 'should have totalInvoiced');
  assert.ok(typeof summary.totalPaid === 'number', 'should have totalPaid');
  assert.ok(typeof summary.outstanding === 'number', 'should have outstanding');
});

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline
// ═══════════════════════════════════════════════════════════════════════════

await test('createPipelineEntry and advanceStage work', () => {
  const entry = createPipelineEntry({
    property_address: '100 Pipeline Dr',
    client_name: 'Pipeline Client',
    stage: 'prospect',
    priority: 'normal',
  });
  assert.ok(entry.id.startsWith('pipe_'), 'should have pipe_ prefix');
  assert.equal(entry.stage, 'prospect');

  const advanced = advanceStage(entry.id, 'quoted');
  assert.equal(advanced.stage, 'quoted');
});

await test('setPriority changes pipeline priority', () => {
  const entry = createPipelineEntry({
    property_address: '200 Priority Ln', client_name: 'Priority Client',
    stage: 'engaged', priority: 'normal',
  });
  const updated = setPriority(entry.id, 'urgent');
  assert.equal(updated.priority, 'urgent');
});

await test('addTag and removeTag manage tags', () => {
  const entry = createPipelineEntry({
    property_address: '300 Tag St', client_name: 'Tag Client', stage: 'in_progress',
  });
  const tagged = addTag(entry.id, 'rush');
  const tags = Array.isArray(tagged.tags_json) ? tagged.tags_json : [];
  assert.ok(tags.includes('rush'), 'should have rush tag');

  const untagged = removeTag(entry.id, 'rush');
  const tags2 = Array.isArray(untagged.tags_json) ? untagged.tags_json : [];
  assert.ok(!tags2.includes('rush'), 'should not have rush tag');
});

await test('getPipelineSummary returns stage counts', () => {
  const summary = getPipelineSummary();
  assert.ok(typeof summary.byStage === 'object', 'should have byStage');
  assert.ok(typeof summary.totalPipelineValue === 'number', 'should have totalPipelineValue');
});

await test('getAppraisersWorkload returns workload data', () => {
  createPipelineEntry({
    property_address: '400 Workload Ct', client_name: 'Workload Client',
    stage: 'in_progress', assigned_appraiser: 'John Smith',
  });
  const workload = getAppraisersWorkload();
  assert.ok(Array.isArray(workload), 'should be an array');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40));
console.log(`businessOps: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const { label, err } of failures) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}
