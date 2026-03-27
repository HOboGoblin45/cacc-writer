/**
 * tests/unit/comparableIntelligenceService.test.mjs
 * Unit tests for the initial Comparable Intelligence Engine slice.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-comparable-intel-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'comparable-intelligence.db');

const { casePath } = await import('../../server/utils/caseUtils.js');
const { writeJSON } = await import('../../server/utils/fileUtils.js');
const dbModule = await import('../../server/db/database.js');
const { getWorkspaceDefinition, getNestedValue } = await import('../../server/workspace/workspaceService.js');
const { syncCaseRecordFromFilesystem, getCaseProjection } = await import('../../server/caseRecord/caseRecordService.js');
const {
  buildComparableIntelligence,
  acceptComparableCandidate,
  rejectComparableCandidate,
  holdComparableCandidate,
  saveAdjustmentSupportDecision,
} = await import('../../server/comparableIntelligence/comparableIntelligenceService.js');

const createdCaseDirs = [];

function createFilesystemCase(seed = {}) {
  const caseId = randomId(4);
  const caseDir = casePath(caseId);
  createdCaseDirs.push(caseDir);
  fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });

  const now = new Date().toISOString();
  const salesGridDefault = getWorkspaceDefinition('1004').fieldIndex.sales_comp_grid.defaultValue;
  const meta = {
    caseId,
    formType: '1004',
    status: 'active',
    pipelineStage: 'intake',
    workflowStatus: 'facts_incomplete',
    address: seed.address || '100 Subject Ln',
    borrower: 'Comparable Borrower',
    propertyType: seed.propertyType || 'SFR',
    city: seed.city || 'Bloomington',
    state: seed.state || 'IL',
    county: seed.county || 'McLean',
    marketArea: seed.marketArea || 'Central Bloomington',
    effectiveDate: seed.effectiveDate || '2026-03-01',
    createdAt: now,
    updatedAt: now,
  };

  const facts = seed.facts || {
    assignment: {
      effectiveDate: { value: meta.effectiveDate, confidence: 'high', source: 'manual' },
    },
    subject: {
      address: { value: meta.address, confidence: 'high', source: 'manual' },
      city: { value: meta.city, confidence: 'high', source: 'manual' },
      county: { value: meta.county, confidence: 'high', source: 'manual' },
      state: { value: meta.state, confidence: 'high', source: 'manual' },
      style: { value: 'Ranch', confidence: 'high', source: 'manual' },
      condition: { value: 'C3', confidence: 'high', source: 'manual' },
      yearBuilt: { value: '2001', confidence: 'high', source: 'manual' },
      gla: { value: '1800', confidence: 'high', source: 'manual' },
      siteSize: { value: '10000', confidence: 'medium', source: 'manual' },
      beds: { value: '3', confidence: 'high', source: 'manual' },
      baths: { value: '2', confidence: 'high', source: 'manual' },
      garage: { value: '2 car', confidence: 'medium', source: 'manual' },
      zoning: { value: 'R-1', confidence: 'high', source: 'manual' },
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
  };

  writeJSON(path.join(caseDir, 'meta.json'), meta);
  writeJSON(path.join(caseDir, 'facts.json'), facts);
  writeJSON(path.join(caseDir, 'fact_sources.json'), seed.provenance || {});
  writeJSON(path.join(caseDir, 'outputs.json'), {});
  writeJSON(path.join(caseDir, 'history.json'), {});
  writeJSON(path.join(caseDir, 'doc_text.json'), {});
  writeJSON(path.join(caseDir, 'feedback.json'), []);

  syncCaseRecordFromFilesystem(caseId);
  return { caseId, caseDir };
}

function addCompDocument(caseId, docType, facts) {
  const db = dbModule.getDb();
  const docId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();

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

  for (const [factPath, factValue] of Object.entries(facts)) {
    db.prepare(`
      INSERT INTO extracted_facts (
        id, extraction_id, document_id, case_id,
        fact_path, fact_value, confidence, review_status, source_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      crypto.randomUUID(),
      extractionId,
      docId,
      caseId,
      factPath,
      String(factValue),
      'high',
      `${factPath}: ${factValue}`,
    );
  }

  return docId;
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

console.log('\ncomparableIntelligenceService');

await test('buildComparableIntelligence ranks stronger subject matches above weaker candidates', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '101 Match St',
    'comp.city': 'Bloomington',
    'comp.county': 'McLean',
    'comp.state': 'IL',
    'comp.saleDate': '2026-02-10',
    'comp.salePrice': '255000',
    'comp.propertyType': 'SFR',
    'comp.style': 'Ranch',
    'comp.condition': 'C3',
    'comp.yearBuilt': '2002',
    'comp.gla': '1825',
    'comp.siteSize': '9800',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
    'comp.garage': '2 car',
    'comp.zoning': 'R-1',
  });
  addCompDocument(caseId, 'comp_2', {
    'comp.address': '909 Weak Fit Ave',
    'comp.city': 'Chicago',
    'comp.county': 'Cook',
    'comp.state': 'IL',
    'comp.saleDate': '2023-01-15',
    'comp.salePrice': '410000',
    'comp.propertyType': 'Condo',
    'comp.style': 'Two Story',
    'comp.condition': 'C5',
    'comp.yearBuilt': '1980',
    'comp.gla': '2600',
    'comp.siteSize': '2500',
    'comp.bedrooms': '4',
    'comp.bathrooms': '3',
    'comp.garage': 'None',
    'comp.zoning': 'R-4',
  });

  const intelligence = buildComparableIntelligence(caseId);
  assert.ok(intelligence, 'expected comparable intelligence payload');
  assert.equal(intelligence.summary.candidateCount, 2);
  assert.equal(intelligence.candidates[0].candidate.address, '101 Match St');
  assert.ok(intelligence.candidates[0].relevanceScore > intelligence.candidates[1].relevanceScore);
  assert.equal(intelligence.candidates[0].tier, 'tier_1');
  assert.ok(intelligence.candidates[0].weightedBreakdown.glaSimilarity >= 0.98);
  assert.ok(intelligence.candidates[1].weightedBreakdown.glaSimilarity < intelligence.candidates[0].weightedBreakdown.glaSimilarity);
});

await test('acceptComparableCandidate loads candidate preview into workspace grid and legacy comp facts', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '222 Grid Load Rd',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2026-02-20',
    'comp.salePrice': '265000',
    'comp.style': 'Ranch',
    'comp.condition': 'C3',
    'comp.gla': '1810',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
    'comp.garage': '2 car',
  });

  const intelligence = buildComparableIntelligence(caseId);
  const candidateId = intelligence.candidates[0].id;
  const result = acceptComparableCandidate({
    caseId,
    candidateId,
    gridSlot: 'comp1',
  });

  assert.ok(result?.intelligence, 'expected updated intelligence payload');

  const projection = getCaseProjection(caseId);
  const gridLeaf = getNestedValue(projection.facts, 'workspace1004.salesComparison.grid');
  const addressRow = (gridLeaf?.value || []).find((row) => row.feature === 'Address');
  const salePriceRow = (gridLeaf?.value || []).find((row) => row.feature === 'Sale Price');
  assert.equal(addressRow.comp1, '222 Grid Load Rd');
  assert.equal(salePriceRow.comp1, '$265,000');

  assert.equal(projection.facts.comps[0].address.value, '222 Grid Load Rd');
  assert.equal(projection.facts.comps[0].salePrice.value, '$265,000');
  assert.equal(projection.facts.comps[0].saleDate.value, '2026-02-20');

  const acceptedSlot = result.intelligence.acceptedSlots.find((slot) => slot.gridSlot === 'comp1');
  assert.ok(acceptedSlot, 'expected adjustment support slot');
  assert.ok(acceptedSlot.adjustmentSupport.length >= 10, 'expected seeded adjustment support rows');
  assert.ok(acceptedSlot.burdenMetrics.grossAdjustmentPercent >= 0, 'expected burden metrics');
});

await test('reject and hold decisions persist across intelligence rebuilds', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '301 Reject Me Ct',
    'comp.city': 'Chicago',
    'comp.state': 'IL',
    'comp.saleDate': '2022-03-01',
    'comp.salePrice': '290000',
    'comp.style': 'Two Story',
    'comp.condition': 'C5',
    'comp.gla': '2500',
  });
  addCompDocument(caseId, 'comp_2', {
    'comp.address': '302 Hold Me Ct',
    'comp.city': 'Normal',
    'comp.state': 'IL',
    'comp.saleDate': '2025-12-10',
    'comp.salePrice': '248000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1775',
  });

  const firstPass = buildComparableIntelligence(caseId);
  const rejectCandidate = firstPass.candidates.find((candidate) => candidate.candidate.address === '301 Reject Me Ct');
  const holdCandidate = firstPass.candidates.find((candidate) => candidate.candidate.address === '302 Hold Me Ct');

  const rejected = rejectComparableCandidate({
    caseId,
    candidateId: rejectCandidate.id,
    reasonCode: 'too_distant',
  });
  const held = holdComparableCandidate({
    caseId,
    candidateId: holdCandidate.id,
  });

  const finalPass = buildComparableIntelligence(caseId);
  const rejectedFinal = finalPass.candidates.find((candidate) => candidate.id === rejectCandidate.id);
  const heldFinal = finalPass.candidates.find((candidate) => candidate.id === holdCandidate.id);

  assert.ok(rejected?.candidates, 'expected rejected intelligence payload');
  assert.ok(held?.candidates, 'expected held intelligence payload');
  assert.equal(rejectedFinal.reviewStatus, 'rejected');
  assert.equal(heldFinal.reviewStatus, 'held');
  assert.equal(finalPass.summary.rejectedCount, 1);
  assert.equal(finalPass.summary.heldCount, 1);
});

await test('saveAdjustmentSupportDecision persists modified support decisions across rebuilds', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '411 Support Persist Ln',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-10-01',
    'comp.salePrice': '240000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1650',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
    'comp.garage': '1 car',
  });

  const intelligence = buildComparableIntelligence(caseId);
  const candidateId = intelligence.candidates[0].id;
  acceptComparableCandidate({
    caseId,
    candidateId,
    gridSlot: 'comp1',
  });

  const updated = saveAdjustmentSupportDecision({
    caseId,
    gridSlot: 'comp1',
    adjustmentCategory: 'gla',
    decisionStatus: 'modified',
    rationaleNote: 'Finalized using local sensitivity support.',
    finalAmount: 5400,
    supportType: 'appraiser_judgment_with_explanation',
  });

  const rebuilt = buildComparableIntelligence(caseId);
  const supportRecord = rebuilt.acceptedSlots
    .find((slot) => slot.gridSlot === 'comp1')
    .adjustmentSupport
    .find((record) => record.adjustmentCategory === 'gla');

  assert.ok(updated?.acceptedSlots, 'expected updated intelligence with accepted slots');
  assert.equal(supportRecord.decisionStatus, 'modified');
  assert.equal(supportRecord.finalAmount, 5400);
  assert.equal(supportRecord.rationaleNote, 'Finalized using local sensitivity support.');
  assert.equal(rebuilt.acceptedSlots[0].burdenMetrics.burdenByCategory.gla, 5400);

  const projection = getCaseProjection(caseId);
  const gridLeaf = getNestedValue(projection.facts, 'workspace1004.salesComparison.grid');
  const netAdjustmentRow = (gridLeaf?.value || []).find((row) => row.feature === 'Net Adjustment');
  const adjustedPriceRow = (gridLeaf?.value || []).find((row) => row.feature === 'Adjusted Sale Price');
  const indicatedValueLeaf = getNestedValue(projection.facts, 'workspace1004.salesComparison.indicatedValue');
  const reconciliationSalesLeaf = getNestedValue(projection.facts, 'workspace1004.reconciliation.salesComparisonValue');

  assert.ok(netAdjustmentRow?.comp1, 'expected computed net adjustment row value');
  assert.ok(adjustedPriceRow?.comp1, 'expected computed adjusted sale price row value');
  assert.ok(String(indicatedValueLeaf?.value || '').startsWith('$'), 'expected indicated value to sync into sales comparison');
  assert.equal(indicatedValueLeaf?.value, reconciliationSalesLeaf?.value);
});

await test('buildComparableIntelligence generates reconciliation support from accepted comps', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '701 Primary Weight Ln',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2026-01-15',
    'comp.salePrice': '255000',
    'comp.style': 'Ranch',
    'comp.condition': 'C3',
    'comp.gla': '1810',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
    'comp.garage': '2 car',
  });
  addCompDocument(caseId, 'comp_2', {
    'comp.address': '702 Secondary Weight Ln',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-11-10',
    'comp.salePrice': '248000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1730',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
    'comp.garage': '1 car',
  });

  const firstPass = buildComparableIntelligence(caseId);
  acceptComparableCandidate({
    caseId,
    candidateId: firstPass.candidates[0].id,
    gridSlot: 'comp1',
  });
  acceptComparableCandidate({
    caseId,
    candidateId: firstPass.candidates[1].id,
    gridSlot: 'comp2',
  });
  saveAdjustmentSupportDecision({
    caseId,
    gridSlot: 'comp1',
    adjustmentCategory: 'gla',
    decisionStatus: 'accepted',
    finalAmount: 1800,
    rationaleNote: 'Comp 1 GLA support accepted.',
    supportType: 'paired_sales_support',
  });
  saveAdjustmentSupportDecision({
    caseId,
    gridSlot: 'comp2',
    adjustmentCategory: 'condition',
    decisionStatus: 'modified',
    finalAmount: 2500,
    rationaleNote: 'Comp 2 condition support reduced after review.',
    supportType: 'appraiser_judgment_with_explanation',
  });

  const rebuilt = buildComparableIntelligence(caseId);
  assert.ok(rebuilt.reconciliationSupport, 'expected reconciliation support payload');
  assert.equal(rebuilt.summary.acceptedSlotCount, 2);
  assert.equal(rebuilt.reconciliationSupport.summary.consideredCompCount, 2);
  assert.ok(rebuilt.reconciliationSupport.summary.weightedIndication > 0, 'expected weighted indication');
  assert.ok(rebuilt.reconciliationSupport.summary.indicatedRangeHigh >= rebuilt.reconciliationSupport.summary.indicatedRangeLow);
  assert.ok((rebuilt.reconciliationSupport.mostReliable || []).length >= 1, 'expected reliable comp ranking');
  assert.ok((rebuilt.reconciliationSupport.weighting || []).every((slot) => slot.contributionPercent > 0), 'expected contribution percentages');
  assert.match(rebuilt.reconciliationSupport.draftNarrative, /weighted indication/i);
  assert.ok(rebuilt.acceptedSlots.every((slot) => slot.valuationMetrics?.adjustedSalePrice != null), 'expected slot valuation metrics');
});

await test('paired sales library supports later similar assignments', () => {
  const first = createFilesystemCase({});

  addCompDocument(first.caseId, 'comp_1', {
    'comp.address': '510 Library Seed Rd',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-09-01',
    'comp.salePrice': '250000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1700',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
  });

  const firstCandidateId = buildComparableIntelligence(first.caseId).candidates[0].id;
  acceptComparableCandidate({
    caseId: first.caseId,
    candidateId: firstCandidateId,
    gridSlot: 'comp1',
  });
  saveAdjustmentSupportDecision({
    caseId: first.caseId,
    gridSlot: 'comp1',
    adjustmentCategory: 'gla',
    decisionStatus: 'accepted',
    rationaleNote: 'Backed by prior paired-sales review in this market.',
    finalAmount: 4500,
    supportType: 'paired_sales_support',
  });

  const second = createFilesystemCase({});
  addCompDocument(second.caseId, 'comp_1', {
    'comp.address': '511 Library Use Rd',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-10-01',
    'comp.salePrice': '252000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1710',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
  });

  const secondCandidateId = buildComparableIntelligence(second.caseId).candidates[0].id;
  acceptComparableCandidate({
    caseId: second.caseId,
    candidateId: secondCandidateId,
    gridSlot: 'comp1',
  });

  const secondIntelligence = buildComparableIntelligence(second.caseId);
  const glaRecord = secondIntelligence.acceptedSlots[0].adjustmentSupport.find((record) => record.adjustmentCategory === 'gla');

  assert.ok(secondIntelligence.librarySummary.scopedRecordCount >= 1, 'expected scoped library records');
  assert.ok(glaRecord.libraryMatches.length >= 1, 'expected a paired sales library match on gla');
  assert.ok(glaRecord.libraryMatches.some((match) => match.supportMethod === 'paired_sales_support'));
});

await test('accepted comparable flags outlier burden contradictions', () => {
  const { caseId } = createFilesystemCase({});

  addCompDocument(caseId, 'comp_1', {
    'comp.address': '612 Contradiction Way',
    'comp.city': 'Bloomington',
    'comp.state': 'IL',
    'comp.saleDate': '2025-08-01',
    'comp.salePrice': '200000',
    'comp.style': 'Ranch',
    'comp.condition': 'C4',
    'comp.gla': '1500',
    'comp.bedrooms': '3',
    'comp.bathrooms': '2',
  });

  const candidateId = buildComparableIntelligence(caseId).candidates[0].id;
  acceptComparableCandidate({
    caseId,
    candidateId,
    gridSlot: 'comp1',
  });
  saveAdjustmentSupportDecision({
    caseId,
    gridSlot: 'comp1',
    adjustmentCategory: 'gla',
    decisionStatus: 'modified',
    rationaleNote: 'Extreme override for burden test.',
    finalAmount: 80000,
    supportType: 'appraiser_judgment_with_explanation',
  });

  const rebuilt = buildComparableIntelligence(caseId);
  const contradictionCodes = rebuilt.contradictions.map((entry) => entry.code);

  assert.ok(contradictionCodes.includes('outlier_adjustment_burden'));
  assert.ok(rebuilt.summary.contradictionCount >= 1);
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
