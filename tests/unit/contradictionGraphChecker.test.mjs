/**
 * tests/unit/contradictionGraphChecker.test.mjs
 * Ensures deterministic contradiction graph items surface through QC.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-contradiction-qc-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'contradiction-qc.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const { syncCaseRecordFromFilesystem } = await import('../../server/caseRecord/caseRecordService.js');
await import('../../server/qc/checkers/contradictionGraphChecker.js');
const { getRule } = await import('../../server/qc/qcRuleRegistry.js');

const createdCaseDirs = [];

function createFilesystemCase() {
  const caseId = randomId(4);
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  writeJSON(path.join(caseDir, 'meta.json'), {
    caseId,
    formType: '1004',
    status: 'active',
    pipelineStage: 'intake',
    workflowStatus: 'facts_incomplete',
    address: '77 QC Graph Ln',
    borrower: 'QC Graph Borrower',
    occupancyType: 'owner_occupied',
    createdAt: now,
    updatedAt: now,
  });
  writeJSON(path.join(caseDir, 'facts.json'), {
    workspace1004: {
      subject: {
        occupant: { value: 'tenant', confidence: 'high', source: 'workspace-seed', updatedAt: now },
      },
    },
  });
  writeJSON(path.join(caseDir, 'fact_sources.json'), {});
  writeJSON(path.join(caseDir, 'outputs.json'), {});
  writeJSON(path.join(caseDir, 'history.json'), {});
  writeJSON(path.join(caseDir, 'doc_text.json'), {});
  writeJSON(path.join(caseDir, 'feedback.json'), []);

  syncCaseRecordFromFilesystem(caseId);
  return caseId;
}

async function cleanup() {
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

console.log('\ncontradictionGraphChecker');

await test('CTG-001 emits QC findings from contradiction graph items', () => {
  const caseId = createFilesystemCase();
  const rule = getRule('CTG-001');
  assert.ok(rule, 'expected contradiction graph QC rule to be registered');

  const results = rule.check({
    caseId,
    assignmentContext: {},
    flags: {},
    compliance: {},
    sectionPlan: {},
    reportFamily: null,
    canonicalFields: [],
    draftPackage: null,
    sections: {},
    formType: '1004',
    reportFamilyId: 'urar_1004',
  });

  assert.ok(results.length >= 1, 'expected contradiction graph QC findings');
  assert.ok(results.some((finding) => finding.message.includes('occupancy')));
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) {
    console.log('\n - ' + failure.label);
    console.log('   ' + failure.err.stack);
  }
  await cleanup();
  process.exit(1);
}

await cleanup();
