/**
 * tests/unit/comparableQcChecker.test.mjs
 * Ensures comparable contradiction flags surface through QC rule registration.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-comparable-qc-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'comparable-qc.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const { getWorkspaceDefinition } = await import('../../server/workspace/workspaceService.js');
const { syncCaseRecordFromFilesystem } = await import('../../server/caseRecord/caseRecordService.js');
const dbModule = await import('../../server/db/database.js');
const {
  buildComparableIntelligence,
  acceptComparableCandidate,
  saveAdjustmentSupportDecision,
} = await import('../../server/comparableIntelligence/comparableIntelligenceService.js');
await import('../../server/qc/checkers/comparableIntelligenceChecker.js');
const { getRule } = await import('../../server/qc/qcRuleRegistry.js');

const createdCaseDirs = [];

function createFilesystemCase() {
  const caseId = randomId(4);
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  const salesGridDefault = getWorkspaceDefinition('1004').fieldIndex.sales_comp_grid.defaultValue;

  writeJSON(path.join(caseDir, 'meta.json'), {
    caseId,
    formType: '1004',
    status: 'active',
    pipelineStage: 'intake',
    workflowStatus: 'facts_incomplete',
    address: '900 QC Rule Ln',
    borrower: 'QC Borrower',
    propertyType: 'SFR',
    city: 'Bloomington',
    state: 'IL',
    county: 'McLean',
    marketArea: 'Central Bloomington',
    effectiveDate: '2026-03-01',
    createdAt: now,
    updatedAt: now,
  });
  writeJSON(path.join(caseDir, 'facts.json'), {
    assignment: {
      effectiveDate: { value: '2026-03-01', confidence: 'high', source: 'manual' },
    },
    subject: {
      address: { value: '900 QC Rule Ln', confidence: 'high', source: 'manual' },
      city: { value: 'Bloomington', confidence: 'high', source: 'manual' },
      county: { value: 'McLean', confidence: 'high', source: 'manual' },
      state: { value: 'IL', confidence: 'high', source: 'manual' },
      style: { value: 'Ranch', confidence: 'high', source: 'manual' },
      condition: { value: 'C3', confidence: 'high', source: 'manual' },
      yearBuilt: { value: '2001', confidence: 'high', source: 'manual' },
      gla: { value: '1800', confidence: 'high', source: 'manual' },
    },
    workspace1004: {
      salesComparison: {
        grid: {
          value: JSON.parse(JSON.stringify(salesGridDefault)),
          confidence: 'high',
          source: 'workspace-seed',
          updatedAt: now,
        },
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

function addCompDocument(caseId, facts) {
  const db = dbModule.getDb();
  const docId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO case_documents (
      id, case_id, original_filename, stored_filename, doc_type
    ) VALUES (?, ?, ?, ?, 'comp_1')
  `).run(docId, caseId, 'comp_1.pdf', 'comp_1.pdf');

  db.prepare(`
    INSERT INTO document_extractions (
      id, document_id, case_id, doc_type, status
    ) VALUES (?, ?, ?, 'comp_1', 'completed')
  `).run(extractionId, docId, caseId);

  for (const [factPath, factValue] of Object.entries(facts)) {
    db.prepare(`
      INSERT INTO extracted_facts (
        id, extraction_id, document_id, case_id,
        fact_path, fact_value, confidence, review_status, source_text
      ) VALUES (?, ?, ?, ?, ?, ?, 'high', 'pending', ?)
    `).run(
      crypto.randomUUID(),
      extractionId,
      docId,
      caseId,
      factPath,
      String(factValue),
      `${factPath}: ${factValue}`,
    );
  }
}

async function cleanup() {
  try {
    dbModule.closeDb();
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

console.log('\ncomparableQcChecker');

await test('CMP-001 emits QC findings from comparable contradiction flags', () => {
  const caseId = createFilesystemCase();
  addCompDocument(caseId, {
    'comp.address': '901 QC Comp Rd',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-08-01',
    'comp.salePrice': '200000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1500',
  });

  const candidateId = buildComparableIntelligence(caseId).candidates[0].id;
  acceptComparableCandidate({ caseId, candidateId, gridSlot: 'comp1' });
  saveAdjustmentSupportDecision({
    caseId,
    gridSlot: 'comp1',
    adjustmentCategory: 'gla',
    decisionStatus: 'modified',
    rationaleNote: 'Extreme QC contradiction test.',
    finalAmount: 80000,
    supportType: 'appraiser_judgment_with_explanation',
  });

  const rule = getRule('CMP-001');
  assert.ok(rule, 'expected comparable QC rule to be registered');

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

  assert.ok(results.length >= 1, 'expected QC findings');
  assert.ok(results.some((finding) => finding.message.includes('gross adjustment burden exceeds 25%')));
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
