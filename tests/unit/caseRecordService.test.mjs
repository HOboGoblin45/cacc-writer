/**
 * tests/unit/caseRecordService.test.mjs
 * Unit tests for Phase B canonical case record persistence + projection service.
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

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

function uniqueCaseId(casePathFn) {
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomBytes(4).toString('hex');
    if (!fs.existsSync(casePathFn(id))) return id;
  }
  throw new Error('Failed to generate unique case id');
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-case-record-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'phaseb-case-record.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const db = await import('../../server/db/database.js');
const repo = await import('../../server/db/repositories/caseRecordRepo.js');
const service = await import('../../server/caseRecord/caseRecordService.js');

const createdCaseDirs = [];

function createFilesystemCase(caseId, seed = {}) {
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    caseId,
    formType: seed.formType || '1004',
    status: seed.status || 'active',
    pipelineStage: seed.pipelineStage || 'intake',
    workflowStatus: seed.workflowStatus || 'facts_incomplete',
    address: seed.address || '100 Test St, Bloomington, IL',
    borrower: seed.borrower || 'Case Borrower',
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now,
  };

  writeJSON(path.join(caseDir, 'meta.json'), meta);
  writeJSON(path.join(caseDir, 'facts.json'), seed.facts || { subject: { address: meta.address } });
  writeJSON(path.join(caseDir, 'outputs.json'), seed.outputs || {
    neighborhood: {
      title: 'Neighborhood',
      text: 'Stable neighborhood conditions with typical market exposure.',
      sectionStatus: 'drafted',
      approved: false,
      updatedAt: now,
    },
  });
  writeJSON(path.join(caseDir, 'history.json'), seed.history || {
    neighborhood: [{ text: 'Older neighborhood text', savedAt: now }],
  });
  writeJSON(path.join(caseDir, 'doc_text.json'), seed.docText || {
    order_sheet: 'Order details and assignment terms.',
  });

  return { caseDir, meta };
}

async function cleanup() {
  try {
    db.closeDb();
  } catch {
    // best effort
  }

  for (const dir of createdCaseDirs) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
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

console.log('\ncaseRecordService + caseRecordRepo');

await test('saveCaseAggregate/getCaseAggregate round-trips canonical payload', () => {
  const caseId = uniqueCaseId(casePath);
  repo.saveCaseAggregate({
    caseId,
    meta: {
      caseId,
      formType: '1004',
      status: 'active',
      pipelineStage: 'intake',
      workflowStatus: 'facts_incomplete',
      address: '501 Canonical Ln, Bloomington, IL',
      borrower: 'Round Trip Borrower',
      unresolvedIssues: ['missing_rent_roll'],
      createdAt: '2026-03-11T10:00:00.000Z',
      updatedAt: '2026-03-11T10:05:00.000Z',
    },
    facts: { site: { areaSqFt: 10000 } },
    outputs: { neighborhood: { text: 'Draft neighborhood paragraph' } },
    history: { neighborhood: [{ text: 'Older draft' }] },
    provenance: { site: { areaSqFt: { source: 'order_sheet.pdf' } } },
  });

  const agg = repo.getCaseAggregate(caseId);
  assert.ok(agg, 'expected aggregate row');
  assert.equal(agg.caseId, caseId);
  assert.equal(agg.meta.address, '501 Canonical Ln, Bloomington, IL');
  assert.equal(agg.facts.site.areaSqFt, 10000);
  assert.equal(agg.outputs.neighborhood.text, 'Draft neighborhood paragraph');
  assert.equal(agg.history.neighborhood[0].text, 'Older draft');
  assert.equal(agg.provenance.site.areaSqFt.source, 'order_sheet.pdf');
});

await test('syncCaseRecordFromFilesystem backfills canonical tables from case folder', () => {
  const caseId = uniqueCaseId(casePath);
  const { meta } = createFilesystemCase(caseId, {
    address: '902 Sync Ave, Bloomington, IL',
    facts: { subject: { gla: 1880 } },
  });

  const projection = service.syncCaseRecordFromFilesystem(caseId);
  assert.ok(projection, 'projection should be returned');
  assert.equal(projection.meta.address, meta.address);
  assert.equal(projection.facts.subject.gla, 1880);
  assert.equal(projection.caseRecord.header.address, meta.address);

  const agg = repo.getCaseAggregate(caseId);
  assert.ok(agg, 'aggregate should be persisted');
  assert.equal(agg.meta.address, meta.address);
  assert.equal(agg.facts.subject.gla, 1880);
});

await test('getCaseProjection serves DB-backed facts even if facts.json is removed', () => {
  const caseId = uniqueCaseId(casePath);
  const { caseDir } = createFilesystemCase(caseId, {
    facts: { subject: { bedroomCount: 4 } },
  });

  service.syncCaseRecordFromFilesystem(caseId);
  fs.rmSync(path.join(caseDir, 'facts.json'), { force: true });

  const projection = service.getCaseProjection(caseId);
  assert.ok(projection, 'projection should still load');
  assert.equal(projection.facts.subject.bedroomCount, 4);
});

await test('listCaseProjections returns canonical records from DB', () => {
  const caseIdA = uniqueCaseId(casePath);
  const caseIdB = uniqueCaseId(casePath);
  createFilesystemCase(caseIdA, { address: '111 Projection Rd' });
  createFilesystemCase(caseIdB, { address: '222 Projection Rd' });

  service.syncCaseRecordFromFilesystem(caseIdA);
  service.syncCaseRecordFromFilesystem(caseIdB);

  const projections = service.listCaseProjections();
  const ids = new Set(projections.map(p => p.caseId));
  assert.ok(ids.has(caseIdA), 'expected case A in projection list');
  assert.ok(ids.has(caseIdB), 'expected case B in projection list');
});

await test('deleteCanonicalCaseRecord removes aggregate row', () => {
  const caseId = uniqueCaseId(casePath);
  createFilesystemCase(caseId, { address: '808 Delete Row Dr' });
  service.syncCaseRecordFromFilesystem(caseId);

  let agg = repo.getCaseAggregate(caseId);
  assert.ok(agg, 'expected aggregate row before delete');

  service.deleteCanonicalCaseRecord(caseId);
  agg = repo.getCaseAggregate(caseId);
  assert.equal(agg, null);
});

const counts = db.getTableCounts();
await test('database status exposes new canonical tables', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(counts, 'case_records'));
  assert.ok(Object.prototype.hasOwnProperty.call(counts, 'case_facts'));
  assert.ok(Object.prototype.hasOwnProperty.call(counts, 'case_outputs'));
  assert.ok(Object.prototype.hasOwnProperty.call(counts, 'case_history'));
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`caseRecordService: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
