/**
 * tests/unit/documentQuality.test.mjs
 * ------------------------------------
 * Unit tests for deterministic document quality scoring.
 */

import assert from 'assert/strict';
import { scoreDocumentQuality, summarizeDocumentQuality, qualityBucket } from '../../server/ingestion/documentQuality.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

console.log('\ndocumentQuality');

test('qualityBucket returns expected bucket labels', () => {
  assert.equal(qualityBucket(90), 'strong');
  assert.equal(qualityBucket(74), 'acceptable');
  assert.equal(qualityBucket(55), 'weak');
  assert.equal(qualityBucket(20), 'critical');
});

test('scoreDocumentQuality marks healthy extracted document as strong/acceptable', () => {
  const result = scoreDocumentQuality({
    extraction_status: 'extracted',
    text_length: 1800,
    classification_confidence: 0.95,
    page_count: 8,
  });
  assert.ok(result.score >= 75, 'expected healthy score >= 75');
  assert.ok(['strong', 'acceptable'].includes(result.bucket), 'expected strong or acceptable bucket');
  assert.equal(result.flags.length, 0, 'healthy row should not have quality flags');
});

test('scoreDocumentQuality flags duplicate + warning + no text', () => {
  const result = scoreDocumentQuality({
    extraction_status: 'skipped',
    text_length: 0,
    classification_confidence: 0.5,
    duplicate_of_document_id: 'doc-123',
    ingestion_warning: 'duplicate file',
    page_count: 1,
  });
  assert.ok(result.score < 60, 'expected low score for duplicate with warnings');
  assert.equal(result.bucket, 'critical');
  assert.ok(result.flags.includes('duplicate_document'), 'duplicate flag expected');
  assert.ok(result.flags.includes('ingestion_warning'), 'warning flag expected');
  assert.ok(result.flags.includes('no_extracted_text'), 'no text flag expected');
});

test('scoreDocumentQuality flags failed extraction', () => {
  const result = scoreDocumentQuality({
    extraction_status: 'failed',
    text_length: 40,
    classification_confidence: 0.7,
  });
  assert.equal(result.bucket, 'critical');
  assert.ok(result.flags.includes('extraction_failed'), 'failed extraction flag expected');
});

test('summarizeDocumentQuality returns aggregate counts and flagged docs', () => {
  const summary = summarizeDocumentQuality([
    {
      id: 'd1',
      original_filename: 'contract.pdf',
      doc_type: 'contract',
      extraction_status: 'extracted',
      text_length: 1200,
      classification_confidence: 0.95,
      page_count: 6,
      duplicate_of_document_id: null,
      ingestion_warning: null,
    },
    {
      id: 'd2',
      original_filename: 'duplicate.pdf',
      doc_type: 'contract',
      extraction_status: 'skipped',
      text_length: 0,
      classification_confidence: 0.5,
      page_count: 1,
      duplicate_of_document_id: 'd1',
      ingestion_warning: 'duplicate',
    },
  ]);

  assert.equal(typeof summary.averageScore, 'number');
  assert.equal(summary.duplicateCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.ok(summary.lowQualityCount >= 1, 'expected at least one low quality document');
  assert.ok(Array.isArray(summary.flaggedDocuments), 'flaggedDocuments should be an array');
  assert.ok(summary.flaggedDocuments.length >= 1, 'expected flagged documents');
});

console.log('\n' + '─'.repeat(60));
console.log(`documentQuality: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);

