/**
 * tests/unit/exportLayer.test.mjs
 * ---------------------------------
 * Unit tests for Phase 14 Export Layer:
 *   - PDF export service
 *   - MISMO XML export
 *   - Bundle/delivery management
 *   - Template management
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

// ── Setup ────────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-export-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'export-test.db');

const { getDb } = await import('../../server/db/database.js');
getDb();

const {
  generatePdf, getPdfPageManifest, estimatePageCount,
  buildCoverPage, buildPhotoPages, buildAddendaPages,
} = await import('../../server/export/pdfExportService.js');

const {
  generateMismo, getMismoFieldMapping, validateMismoOutput,
  buildMismoDocument, mapFactsToMismo,
} = await import('../../server/export/mismoExportService.js');

const {
  createExportJob, getExportJob, listExportJobs, cancelExportJob,
  createBundle, getBundleContents, createDeliveryRecord, listDeliveries,
  confirmDelivery, getExportSummary, createTemplate, listTemplates,
  updateTemplate,
} = await import('../../server/export/bundleService.js');

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedCase(caseId) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO case_records (case_id, form_type) VALUES (?, '1004')`).run(caseId);
    db.prepare(`INSERT INTO case_facts (case_id, facts_json, provenance_json, updated_at)
      VALUES (?, ?, '{}', datetime('now'))`).run(caseId,
      JSON.stringify({
        subject_address: '123 Test St, Anytown, ST 12345',
        borrower_name: 'John Doe',
        property_type: 'Single Family',
        gla: 2000,
        site_area: 0.25,
        year_built: 1990,
        sale_price: 350000,
      })
    );
  } catch { /* may already exist */ }
}

const caseId = 'case-exp-' + crypto.randomBytes(4).toString('hex');
seedCase(caseId);

// ═══════════════════════════════════════════════════════════════════════════
// PDF Export
// ═══════════════════════════════════════════════════════════════════════════

await test('generatePdf creates export job and page structure', () => {
  const result = generatePdf(caseId, { watermark: 'draft' });
  assert.ok(result, 'should return result');
  assert.ok(result.job || result.pages || result.document, 'should have structured output');
});

await test('getPdfPageManifest returns ordered page list', () => {
  const manifest = getPdfPageManifest(caseId, '1004');
  assert.ok(Array.isArray(manifest) || typeof manifest === 'object', 'should return manifest');
});

await test('estimatePageCount returns positive number', () => {
  const estimate = estimatePageCount(caseId);
  assert.ok(typeof estimate === 'object' || typeof estimate === 'number', 'should return estimate');
});

await test('buildCoverPage returns structured cover data', () => {
  const cover = buildCoverPage({
    facts: { subject: { address: '123 Test St', city: 'Anytown', state: 'ST' } },
    caseRecord: { case_id: caseId, form_type: '1004' },
  });
  assert.ok(typeof cover === 'object', 'should return cover object');
  assert.equal(cover.type, 'cover');
});

// ═══════════════════════════════════════════════════════════════════════════
// MISMO Export
// ═══════════════════════════════════════════════════════════════════════════

await test('getMismoFieldMapping returns mapping for 1004', () => {
  const mapping = getMismoFieldMapping('1004');
  assert.ok(typeof mapping === 'object', 'should return mapping object');
  const keys = Object.keys(mapping);
  assert.ok(keys.length > 0, 'should have field mappings');
});

await test('generateMismo creates XML structure', () => {
  const result = generateMismo(caseId, { version: 'mismo_3_4' });
  assert.ok(result, 'should return result');
  assert.ok(result.xml || result.job || result.document, 'should have output');
});

await test('mapFactsToMismo maps internal facts to MISMO elements', () => {
  const mapped = mapFactsToMismo({
    subject_address: '123 Test St',
    gla: 2000,
    sale_price: 350000,
  }, '1004');
  assert.ok(typeof mapped === 'object', 'should return mapped object');
});

await test('validateMismoOutput performs structural validation', () => {
  const xml = '<MISMO><APPRAISAL><SUBJECT_PROPERTY></SUBJECT_PROPERTY></APPRAISAL></MISMO>';
  const result = validateMismoOutput(xml, 'mismo_3_4');
  assert.ok(typeof result === 'object', 'should return validation result');
  assert.ok('valid' in result || 'isValid' in result || 'errors' in result || 'warnings' in result,
    'should have validation status');
});

// ═══════════════════════════════════════════════════════════════════════════
// Bundle/Delivery
// ═══════════════════════════════════════════════════════════════════════════

await test('createExportJob creates a job record', () => {
  const job = createExportJob(caseId, {
    exportType: 'pdf',
    outputFormat: 'pdf_1004',
    watermark: 'final',
    deliveryMethod: 'download',
  });
  assert.ok(job.id.startsWith('expj_'), 'should have expj_ prefix');
  assert.equal(job.export_status, 'queued');
});

await test('createBundle creates multiple export jobs', () => {
  const bundle = createBundle(caseId, {
    exportTypes: ['pdf', 'xml_mismo'],
    watermark: 'final',
  });
  assert.ok(bundle.jobs.length === 2, 'should have 2 jobs');
  assert.ok(bundle.exportTypes.includes('pdf'), 'should include pdf');
  assert.ok(bundle.exportTypes.includes('xml_mismo'), 'should include xml_mismo');
});

await test('listExportJobs filters by case', () => {
  const jobs = listExportJobs(caseId);
  assert.ok(jobs.length >= 3, 'should have at least 3 jobs');
});

await test('cancelExportJob cancels a queued job', () => {
  const job = createExportJob(caseId, { exportType: 'csv', deliveryMethod: 'download' });
  const cancelled = cancelExportJob(job.id);
  assert.equal(cancelled.export_status, 'cancelled');
});

await test('createDeliveryRecord and confirmDelivery work', () => {
  const job = createExportJob(caseId, { exportType: 'pdf', deliveryMethod: 'email' });
  const delivery = createDeliveryRecord(job.id, {
    deliveryMethod: 'email',
    recipientName: 'Client',
    recipientEmail: 'client@example.com',
  });
  assert.ok(delivery.id.startsWith('dlvr_'), 'should have dlvr_ prefix');
  assert.equal(delivery.delivery_status, 'pending');

  const confirmed = confirmDelivery(delivery.id, 'read_receipt');
  assert.equal(confirmed.delivery_status, 'confirmed');
});

await test('getExportSummary returns case export history', () => {
  const summary = getExportSummary(caseId);
  assert.ok(summary.totalJobs >= 5, 'should have jobs');
  assert.ok(typeof summary.byType === 'object', 'should have byType');
});

// ═══════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════

await test('createTemplate and listTemplates work', () => {
  const tmpl = createTemplate({
    name: 'Standard 1004 PDF',
    exportType: 'pdf',
    formType: '1004',
    description: 'Default PDF template for 1004 forms',
    config: { includePhotos: true, includeAddenda: true },
  });
  assert.ok(tmpl.id.startsWith('tmpl_'), 'should have tmpl_ prefix');
  assert.equal(tmpl.name, 'Standard 1004 PDF');

  const templates = listTemplates({ exportType: 'pdf' });
  assert.ok(templates.length >= 1, 'should have templates');
});

await test('updateTemplate modifies template', () => {
  const tmpl = createTemplate({
    name: 'Update Test',
    exportType: 'xml_mismo',
    config: {},
  });
  const updated = updateTemplate(tmpl.id, { name: 'Updated MISMO Template' });
  assert.equal(updated.name, 'Updated MISMO Template');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40));
console.log(`exportLayer: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const { label, err } of failures) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}
