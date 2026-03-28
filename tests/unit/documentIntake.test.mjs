/**
 * tests/unit/documentIntake.test.mjs
 * -----------------------------------
 * Unit tests for document intake registration hardening:
 *  - deterministic content hash usage
 *  - duplicate detection/linkage
 *  - extraction skip behavior for duplicates
 */

import assert from 'assert/strict';
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-document-intake-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'document-intake.db');

const dbModule = await import('../../server/db/database.js');
const {
  registerDocument,
  getCaseDocuments,
  findDuplicateDocumentByHash,
  getCaseExtractionSummary,
} = await import('../../server/ingestion/stagingService.js');

async function cleanup() {
  try {
    dbModule.closeDb();
  } catch {
    // best effort
  }

  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\ndocumentIntake');

await test('registerDocument marks second identical hash as duplicate', () => {
  const caseId = 'abc12345';
  const fileHash = 'f'.repeat(64);

  const first = registerDocument({
    caseId,
    originalFilename: 'contract.pdf',
    storedFilename: 'abc12345_contract_1.pdf',
    legacyDocType: 'contract',
    fileSizeBytes: 1024,
    pageCount: 3,
    extractedText: 'Purchase contract price 500000 closing date 01/01/2026',
    fileHash,
  });

  assert.equal(first.duplicateDetected, false, 'first insert should not be duplicate');
  assert.equal(first.duplicateOfDocumentId, null, 'first insert should have no duplicate link');

  const duplicateProbe = findDuplicateDocumentByHash(caseId, fileHash);
  assert.ok(duplicateProbe, 'expected duplicate probe to find first row');
  assert.equal(duplicateProbe.id, first.documentId, 'probe should resolve to first document');

  const second = registerDocument({
    caseId,
    originalFilename: 'contract-copy.pdf',
    storedFilename: 'abc12345_contract_2.pdf',
    legacyDocType: 'contract',
    fileSizeBytes: 1024,
    pageCount: 3,
    extractedText: 'Purchase contract price 500000 closing date 01/01/2026',
    fileHash,
  });

  assert.equal(second.duplicateDetected, true, 'second insert should be detected as duplicate');
  assert.equal(second.duplicateOfDocumentId, first.documentId, 'duplicate link should point at first document');
});

await test('duplicate row is stored with skipped extraction status', () => {
  const caseId = 'def67890';
  const fileHash = 'a'.repeat(64);

  const first = registerDocument({
    caseId,
    originalFilename: 'mls.pdf',
    storedFilename: 'def67890_mls_1.pdf',
    legacyDocType: 'mls_sheet',
    fileSizeBytes: 2048,
    pageCount: 2,
    extractedText: 'MLS listing with DOM 7 and list price 425000',
    fileHash,
  });

  const second = registerDocument({
    caseId,
    originalFilename: 'mls-duplicate.pdf',
    storedFilename: 'def67890_mls_2.pdf',
    legacyDocType: 'mls_sheet',
    fileSizeBytes: 2048,
    pageCount: 2,
    extractedText: 'MLS listing with DOM 7 and list price 425000',
    fileHash,
  });

  const docs = getCaseDocuments(caseId);
  assert.equal(docs.length, 2, 'expected two rows for case');

  const duplicateRow = docs.find(d => d.id === second.documentId);
  assert.ok(duplicateRow, 'expected duplicate row');
  assert.equal(duplicateRow.extraction_status, 'skipped', 'duplicate extraction should be skipped');
  assert.equal(duplicateRow.duplicate_of_document_id, first.documentId, 'duplicate row should link to first row');
  assert.equal(duplicateRow.classification_method, 'duplicate', 'classification method should be duplicate');
});

await test('getCaseExtractionSummary includes deterministic quality metrics', () => {
  const caseId = '1122aabb';
  const hashA = 'b'.repeat(64);

  registerDocument({
    caseId,
    originalFilename: 'order.pdf',
    storedFilename: '1122aabb_order_1.pdf',
    legacyDocType: 'order_sheet',
    fileSizeBytes: 4096,
    pageCount: 2,
    extractedText: 'Order Number 100 Product Type 1004 Loan Program FHA Due Date 01/01/2026',
    fileHash: hashA,
  });

  registerDocument({
    caseId,
    originalFilename: 'order-copy.pdf',
    storedFilename: '1122aabb_order_2.pdf',
    legacyDocType: 'order_sheet',
    fileSizeBytes: 4096,
    pageCount: 2,
    extractedText: 'Order Number 100 Product Type 1004 Loan Program FHA Due Date 01/01/2026',
    fileHash: hashA,
    ingestionWarning: 'duplicate upload',
  });

  const summary = getCaseExtractionSummary(caseId);
  assert.equal(summary.totalDocuments, 2);
  assert.equal(summary.pendingFacts, 0);
  assert.equal(summary.pendingSections, 0);
  assert.equal(summary.quality.duplicateCount, 1);
  assert.equal(summary.quality.warningCount, 1);
  assert.ok(summary.quality.averageScore !== null);
  assert.ok(Array.isArray(summary.quality.flaggedDocuments));
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`documentIntake: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);

