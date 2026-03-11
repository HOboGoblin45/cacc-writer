/**
 * tests/unit/factIntegrity.test.mjs
 * ----------------------------------
 * Unit tests for Phase C fact conflict detection + pre-draft gate.
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

function randomId(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-fact-integrity-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'fact-integrity.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const dbModule = await import('../../server/db/database.js');
const { syncCaseRecordFromFilesystem } = await import('../../server/caseRecord/caseRecordService.js');
const { detectFactConflicts } = await import('../../server/factIntegrity/factConflictEngine.js');
const { evaluatePreDraftGate } = await import('../../server/factIntegrity/preDraftGate.js');

const createdCaseDirs = [];

function createFilesystemCase(seed = {}) {
  const caseId = randomId(4);
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    caseId,
    formType: seed.formType || '1004',
    status: 'active',
    pipelineStage: 'intake',
    workflowStatus: 'facts_incomplete',
    address: seed.address || '10 Integrity Ln',
    borrower: seed.borrower || 'Gate Borrower',
    createdAt: now,
    updatedAt: now,
    unresolvedIssues: seed.unresolvedIssues || [],
  };

  writeJSON(path.join(caseDir, 'meta.json'), meta);
  writeJSON(path.join(caseDir, 'facts.json'), seed.facts || {});
  writeJSON(path.join(caseDir, 'fact_sources.json'), seed.provenance || {});
  writeJSON(path.join(caseDir, 'outputs.json'), {});
  writeJSON(path.join(caseDir, 'history.json'), {});
  writeJSON(path.join(caseDir, 'doc_text.json'), {});
  writeJSON(path.join(caseDir, 'feedback.json'), []);

  syncCaseRecordFromFilesystem(caseId);
  return { caseId, caseDir };
}

function addExtractedFact(caseId, { factPath, value, confidence = 'high', reviewStatus = 'pending', docType = 'assessor_record' }) {
  const db = dbModule.getDb();
  const docId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  const factId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO case_documents (
      id, case_id, original_filename, stored_filename, doc_type
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    docId,
    caseId,
    `${docType}.pdf`,
    `${docType}-${Date.now()}.pdf`,
    docType,
  );

  db.prepare(`
    INSERT INTO document_extractions (
      id, document_id, case_id, doc_type, status
    ) VALUES (?, ?, ?, ?, 'completed')
  `).run(extractionId, docId, caseId, docType);

  db.prepare(`
    INSERT INTO extracted_facts (
      id, extraction_id, document_id, case_id,
      fact_path, fact_value, confidence, review_status, source_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    factId,
    extractionId,
    docId,
    caseId,
    factPath,
    value,
    confidence,
    reviewStatus,
    `${factPath}: ${value}`,
  );
}

function addExtractedSection(caseId, {
  sectionType = 'neighborhood_description',
  sectionLabel = 'Neighborhood Description',
  text = 'Example extracted narrative section.',
  confidence = 'medium',
  reviewStatus = 'pending',
  docType = 'prior_appraisal',
}) {
  const db = dbModule.getDb();
  const docId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const textHash = crypto.createHash('sha256').update(text).digest('hex');

  db.prepare(`
    INSERT INTO case_documents (
      id, case_id, original_filename, stored_filename, doc_type
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    docId,
    caseId,
    `${docType}.pdf`,
    `${docType}-${Date.now()}.pdf`,
    docType,
  );

  db.prepare(`
    INSERT INTO document_extractions (
      id, document_id, case_id, doc_type, status
    ) VALUES (?, ?, ?, ?, 'completed')
  `).run(extractionId, docId, caseId, docType);

  db.prepare(`
    INSERT INTO extracted_sections (
      id, extraction_id, document_id, case_id, section_type, section_label,
      text, text_hash, confidence, review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sectionId,
    extractionId,
    docId,
    caseId,
    sectionType,
    sectionLabel,
    text,
    textHash,
    confidence,
    reviewStatus,
  );
}

async function cleanup() {
  try {
    dbModule.closeDb();
  } catch {
    // best effort
  }

  for (const caseDir of createdCaseDirs) {
    try {
      if (fs.existsSync(caseDir)) fs.rmSync(caseDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\nfactConflictEngine + preDraftGate');

await test('detectFactConflicts flags blocker conflict for critical fact path', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        gla: { value: '1800', confidence: 'high' },
      },
    },
  });

  addExtractedFact(caseId, {
    factPath: 'subject.gla',
    value: '2100',
    confidence: 'high',
    reviewStatus: 'pending',
  });

  const report = detectFactConflicts(caseId);
  assert.ok(report, 'expected conflict report');
  assert.ok(report.summary.totalConflicts >= 1, 'expected at least one conflict');

  const glaConflict = report.conflicts.find(c => c.factPath === 'subject.gla');
  assert.ok(glaConflict, 'expected conflict on subject.gla');
  assert.equal(glaConflict.severity, 'blocker');
  assert.ok(glaConflict.valueCount >= 2, 'expected two distinct values');
});

await test('detectFactConflicts normalizes date, currency, and address variants', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        address: { value: '123 Main St., Springfield', confidence: 'high' },
      },
      contract: {
        contractDate: { value: '2026-01-01', confidence: 'high' },
        contractPrice: { value: '500000', confidence: 'high' },
      },
    },
  });

  addExtractedFact(caseId, {
    factPath: 'subject.address',
    value: '123 Main St Springfield',
    confidence: 'medium',
    reviewStatus: 'pending',
  });
  addExtractedFact(caseId, {
    factPath: 'contract.contractDate',
    value: '01/01/2026',
    confidence: 'medium',
    reviewStatus: 'pending',
  });
  addExtractedFact(caseId, {
    factPath: 'contract.contractPrice',
    value: '$500,000.00',
    confidence: 'medium',
    reviewStatus: 'pending',
  });

  const report = detectFactConflicts(caseId);
  assert.ok(report, 'expected conflict report');
  assert.equal(report.summary.totalConflicts, 0, 'normalized variants should not produce conflicts');
});

await test('detectFactConflicts marks non-critical disagreement as high severity', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        style: { value: 'Ranch', confidence: 'high' },
      },
    },
  });

  addExtractedFact(caseId, {
    factPath: 'subject.style',
    value: 'Colonial',
    confidence: 'medium',
    reviewStatus: 'pending',
  });

  const report = detectFactConflicts(caseId);
  assert.ok(report, 'expected conflict report');
  const styleConflict = report.conflicts.find(c => c.factPath === 'subject.style');
  assert.ok(styleConflict, 'expected subject.style conflict');
  assert.equal(styleConflict.severity, 'high');
});

await test('detectFactConflicts ignores rejected extracted facts', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        gla: { value: '1800', confidence: 'high' },
      },
    },
  });

  addExtractedFact(caseId, {
    factPath: 'subject.gla',
    value: '2500',
    confidence: 'high',
    reviewStatus: 'rejected',
  });

  const report = detectFactConflicts(caseId);
  assert.ok(report, 'expected conflict report');
  assert.equal(report.summary.totalConflicts, 0, 'rejected candidates should not create conflicts');
});

await test('evaluatePreDraftGate blocks when required section facts are missing', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        address: { value: '123 Gate St', confidence: 'high' },
      },
    },
  });

  const gate = evaluatePreDraftGate({
    caseId,
    formType: '1004',
    sectionIds: ['site_description'],
  });

  assert.ok(gate, 'expected gate result');
  assert.equal(gate.ok, false);
  assert.ok(Array.isArray(gate.blockers) && gate.blockers.length > 0, 'expected blocker list');
  assert.ok(gate.blockers.some(b => b.type === 'missing_required_facts'));
  assert.ok(gate.summary.missingRequiredFacts >= 1, 'expected missing required facts');
});

await test('evaluatePreDraftGate blocks when extracted facts are pending review', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        address: { value: '900 Review St', confidence: 'high' },
        siteSize: { value: '7800', confidence: 'high' },
      },
    },
  });

  addExtractedFact(caseId, {
    factPath: 'subject.gla',
    value: '1980',
    confidence: 'high',
    reviewStatus: 'pending',
  });

  const gate = evaluatePreDraftGate({
    caseId,
    formType: '1004',
    sectionIds: ['site_description'],
  });

  assert.ok(gate, 'expected gate result');
  assert.equal(gate.ok, false, 'pending extracted fact reviews should block drafting');
  assert.ok(gate.blockers.some(b => b.type === 'pending_fact_reviews'));
  assert.equal(gate.summary.pendingFactReviews, 1);
});

await test('evaluatePreDraftGate accepts alias fact path and surfaces provenance warnings', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        address: { value: '456 Alias Ave', confidence: 'high' },
        lotSize: { value: '9500', confidence: 'medium' }, // alias for subject.siteSize
      },
    },
    provenance: {
      'subject.address': { sourceType: 'document', sourceId: 'order_sheet.pdf' },
    },
  });

  const gate = evaluatePreDraftGate({
    caseId,
    formType: '1004',
    sectionIds: ['site_description'],
  });

  assert.ok(gate, 'expected gate result');
  assert.equal(gate.ok, true, 'alias should satisfy required section facts');
  assert.ok(gate.summary.provenanceCoveragePct < 100, 'expected provenance gap warning');
  assert.ok(gate.warnings.some(w => w.type === 'provenance_gaps'));
});

await test('evaluatePreDraftGate reports pending extracted sections as warnings only', () => {
  const { caseId } = createFilesystemCase({
    facts: {
      subject: {
        address: { value: '120 Section Ave', confidence: 'high' },
        siteSize: { value: '10200', confidence: 'high' },
      },
    },
  });

  addExtractedSection(caseId, {
    sectionType: 'market_conditions',
    text: 'Pending extracted market conditions narrative.',
    reviewStatus: 'pending',
  });

  const gate = evaluatePreDraftGate({
    caseId,
    formType: '1004',
    sectionIds: ['site_description'],
  });

  assert.ok(gate, 'expected gate result');
  assert.equal(gate.ok, true, 'pending sections should not block pre-draft gate by themselves');
  assert.equal(gate.summary.pendingFactReviews, 0);
  assert.equal(gate.summary.pendingSectionReviews, 1);
  assert.ok(gate.warnings.some(w => w.type === 'pending_section_reviews'));
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`factIntegrity: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
