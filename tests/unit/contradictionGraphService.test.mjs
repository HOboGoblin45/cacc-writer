/**
 * tests/unit/contradictionGraphService.test.mjs
 * Validates the unified contradiction graph service.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-contradiction-graph-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'contradiction-graph.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const dbModule = await import('../../server/db/database.js');
const { getWorkspaceDefinition } = await import('../../server/workspace/workspaceService.js');
const { syncCaseRecordFromFilesystem } = await import('../../server/caseRecord/caseRecordService.js');
const {
  buildComparableIntelligence,
  acceptComparableCandidate,
  saveAdjustmentSupportDecision,
} = await import('../../server/comparableIntelligence/comparableIntelligenceService.js');
const { buildContradictionGraph } = await import('../../server/contradictionGraph/contradictionGraphService.js');

const createdCaseDirs = [];

function createFilesystemCase() {
  const caseId = randomId(4);
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  const salesGridDefault = getWorkspaceDefinition('1004').fieldIndex.sales_comp_grid.defaultValue;
  const dimensionAreaSummary = getWorkspaceDefinition('1004').fieldIndex.dimension_area_summary.defaultValue;
  const priorSalesGrid = getWorkspaceDefinition('1004').fieldIndex.prior_sales_grid.defaultValue;

  writeJSON(path.join(caseDir, 'meta.json'), {
    caseId,
    formType: '1004',
    status: 'active',
    pipelineStage: 'intake',
    workflowStatus: 'facts_incomplete',
    address: '44 Graph Ln',
    borrower: 'Graph Borrower',
    propertyType: 'SFR',
    occupancyType: 'owner_occupied',
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
      address: { value: '44 Graph Ln', confidence: 'high', source: 'manual' },
      city: { value: 'Bloomington', confidence: 'high', source: 'manual' },
      county: { value: 'McLean', confidence: 'high', source: 'manual' },
      state: { value: 'IL', confidence: 'high', source: 'manual' },
      zoning: { value: 'R-1', confidence: 'high', source: 'manual' },
      floodZone: { value: 'AE', confidence: 'high', source: 'manual' },
      style: { value: 'Ranch', confidence: 'high', source: 'manual' },
      condition: { value: 'C3', confidence: 'high', source: 'manual' },
      yearBuilt: { value: '2001', confidence: 'high', source: 'manual' },
      gla: { value: '1800', confidence: 'high', source: 'manual' },
      siteSize: { value: '8000', confidence: 'high', source: 'manual' },
    },
    workspace1004: {
      subject: {
        occupant: { value: 'tenant', confidence: 'high', source: 'workspace-seed', updatedAt: now },
      },
      site: {
        area: { value: '8200', confidence: 'high', source: 'workspace-seed', updatedAt: now },
        zoningClassification: { value: 'R-2', confidence: 'high', source: 'workspace-seed', updatedAt: now },
        femaSpecialFloodHazardArea: { value: 'no', confidence: 'high', source: 'workspace-seed', updatedAt: now },
        femaFloodZone: { value: 'AE', confidence: 'high', source: 'workspace-seed', updatedAt: now },
      },
      improvements: {
        gla: { value: '1800', confidence: 'high', source: 'workspace-seed', updatedAt: now },
      },
      salesComparison: {
        grid: {
          value: JSON.parse(JSON.stringify(salesGridDefault)),
          confidence: 'high',
          source: 'workspace-seed',
          updatedAt: now,
        },
      },
      priorSales: {
        subjectHistoryFound: { value: 'yes', confidence: 'high', source: 'workspace-seed', updatedAt: now },
        compHistoryFound: { value: 'no', confidence: 'high', source: 'workspace-seed', updatedAt: now },
        grid: {
          value: JSON.parse(JSON.stringify(priorSalesGrid)),
          confidence: 'high',
          source: 'workspace-seed',
          updatedAt: now,
        },
      },
      dimensionAddendum: {
        areaSummary: {
          value: JSON.parse(JSON.stringify(dimensionAreaSummary)).map((row) => (
            row.areaLabel === 'Living'
              ? { ...row, area: '1500' }
              : row
          )),
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

function addExtractedFact(caseId, { factPath, value, confidence = 'high', reviewStatus = 'pending', docType = 'assessor_record' }) {
  const db = dbModule.getDb();
  const docId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  const factId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO case_documents (
      id, case_id, original_filename, stored_filename, doc_type
    ) VALUES (?, ?, ?, ?, ?)
  `).run(docId, caseId, `${docType}.pdf`, `${docType}.pdf`, docType);

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
    String(value),
    confidence,
    reviewStatus,
    `${factPath}: ${value}`,
  );

  return factId;
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

console.log('\ncontradictionGraphService');

await test('buildContradictionGraph combines fact, workspace, and comparable contradictions', () => {
  const caseId = createFilesystemCase();

  addExtractedFact(caseId, {
    factPath: 'subject.gla',
    value: '2100',
    confidence: 'high',
    reviewStatus: 'pending',
  });

  addCompDocument(caseId, {
    'comp.address': '45 Graph Comp Rd',
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
    rationaleNote: 'Extreme contradiction graph burden test.',
    finalAmount: 80000,
    supportType: 'appraiser_judgment_with_explanation',
  });

  const graph = buildContradictionGraph(caseId);
  assert.ok(graph, 'expected contradiction graph');
  assert.ok(graph.summary.totalContradictions >= 6, 'expected multiple contradiction sources');
  assert.ok(graph.summary.sourceCounts.fact_conflict >= 1, 'expected fact conflict source count');
  assert.ok(graph.summary.sourceCounts.workspace_alignment >= 1, 'expected workspace contradiction source count');
  assert.ok(graph.summary.sourceCounts.comparable_intelligence >= 1, 'expected comparable contradiction source count');

  const categories = new Set(graph.items.map((item) => item.category));
  assert.ok(categories.has('gla'));
  assert.ok(categories.has('occupancy'));
  assert.ok(categories.has('flood_status'));
  assert.ok(categories.has('prior_sale_history'));
  assert.ok(categories.has('comp_adjustments'));
});

await test('buildContradictionGraph sorts high severity contradictions first', () => {
  const caseId = createFilesystemCase();
  addExtractedFact(caseId, {
    factPath: 'subject.zoning',
    value: 'R-3',
    confidence: 'high',
    reviewStatus: 'pending',
  });

  const graph = buildContradictionGraph(caseId);
  assert.ok(graph.items.length >= 1, 'expected contradiction items');
  const first = graph.items[0];
  assert.ok(['blocker', 'high'].includes(first.severity), 'expected highest severity contradiction first');
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
