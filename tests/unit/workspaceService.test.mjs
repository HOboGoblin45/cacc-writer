/**
 * tests/unit/workspaceService.test.mjs
 * Unit tests for Phase D0 1004 workspace definition + autosave helpers.
 */

import assert from 'assert/strict';

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

const {
  getWorkspaceDefinition,
  getNestedValue,
  buildWorkspacePayload,
  applyWorkspacePatch,
} = await import('../../server/workspace/workspaceService.js');

console.log('\nworkspaceService');

await test('1004 workspace definition exposes the required section order', () => {
  const definition = getWorkspaceDefinition('1004');
  assert.ok(definition, 'expected definition');

  const sectionIds = definition.sections.map((section) => section.id);
  assert.deepEqual(sectionIds, [
    'assignment',
    'subject',
    'contract',
    'neighborhood',
    'site',
    'improvements',
    'sales_comparison',
    'prior_sales',
    'cost_approach',
    'income_approach',
    'reconciliation',
    'uspap_addendum',
    'dimension_addendum',
    'photo_addendum',
    'qc_review',
    'subject_property_addendum',
    'pud_condo_addendum',
    'cost_approach_addendum',
    'income_approach_addendum',
    'small_residential_income_addendum',
  ]);

  assert.ok(definition.fieldIndex.sales_comp_grid, 'expected sales comparison grid field');
  assert.ok(definition.fieldIndex.dimension_measurements, 'expected dimension grid field');
  assert.ok(definition.fieldIndex.assignment_cover_located_at, 'expected cover sheet address field');
  assert.ok(definition.fieldIndex.site_electricity_service, 'expected structured site utility field');
  assert.ok(definition.fieldIndex.improvements_basement_area, 'expected structured improvement basement field');
  assert.ok(definition.fieldIndex.income_pud_project_name, 'expected PUD project field');
  assert.ok(definition.fieldIndex.uspap_appraiser_name, 'expected appraiser certification field');
  assert.ok(definition.fieldIndex.dimension_area_summary, 'expected dimension area summary grid');
  assert.ok(definition.fieldIndex.photo_appraised_value, 'expected photo addendum appraised value field');

  // --- Field completeness audit: new fields added in Priority 1 ---
  assert.ok(definition.fieldIndex.assignment_amc_name, 'expected AMC name field');
  assert.ok(definition.fieldIndex.assignment_amc_address, 'expected AMC address field');
  assert.ok(definition.fieldIndex.assignment_transmittal_appraiser_name, 'expected transmittal appraiser name field');
  assert.ok(definition.fieldIndex.assignment_transmittal_supervisory_name, 'expected transmittal supervisory appraiser name field');
  assert.ok(definition.fieldIndex.subject_data_source_ownership, 'expected data source for owner of record field');
  assert.ok(definition.fieldIndex.improvements_sqft_above_grade, 'expected sqft above grade field');
  assert.ok(definition.fieldIndex.improvements_sqft_below_grade, 'expected sqft below grade field');
  assert.ok(definition.fieldIndex.improvements_accessory_unit_present, 'expected accessory unit present field');
  assert.ok(definition.fieldIndex.improvements_accessory_unit_sqft, 'expected accessory unit sqft field');
  assert.ok(definition.fieldIndex.sales_comp_dom_subject, 'expected subject DOM field');
  assert.ok(definition.fieldIndex.sales_comp_dom_comp1, 'expected comp 1 DOM field');
  assert.ok(definition.fieldIndex.reconciliation_appraiser_name, 'expected reconciliation appraiser name field');
  assert.ok(definition.fieldIndex.reconciliation_inspection_date, 'expected reconciliation inspection date field');
  assert.ok(definition.fieldIndex.reconciliation_report_date, 'expected reconciliation report date field');
  assert.ok(definition.fieldIndex.reconciliation_supervisory_appraiser_name, 'expected reconciliation supervisory appraiser name field');
  assert.ok(definition.fieldIndex.uspap_supervisory_other_description, 'expected supervisory other description field');
  assert.ok(definition.fieldIndex.uspap_supervisory_state_number, 'expected supervisory state number field');
  assert.ok(definition.fieldIndex.photo_front_date, 'expected photo front date field');
  assert.ok(definition.fieldIndex.photo_rear_date, 'expected photo rear date field');
  assert.ok(definition.fieldIndex.photo_street_date, 'expected photo street date field');
});

await test('buildWorkspacePayload exposes suggestions from canonical fact paths', () => {
  const payload = buildWorkspacePayload({
    formType: '1004',
    facts: {
      subject: {
        address: { value: '101 Main St', confidence: 'high', source: 'extractor' },
      },
    },
    provenance: {
      'subject.address': {
        sourceType: 'document',
        sourceId: 'order-sheet.pdf',
        page: '1',
      },
    },
    history: {},
    meta: {},
  });

  const entry = payload.entries.subject_property_address;
  assert.equal(entry.value, '101 Main St');
  assert.equal(entry.suggestion.value, '101 Main St');
  assert.equal(entry.suggestion.provenance.sourceId, 'order-sheet.pdf');
});

await test('buildWorkspacePayload enriches fields with extracted candidates and conflict data', () => {
  const payload = buildWorkspacePayload({
    formType: '1004',
    facts: {},
    provenance: {},
    history: {},
    meta: {},
    extractedFacts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        fact_path: 'subject.address',
        fact_value: '404 Oak Ave',
        confidence: 'high',
        review_status: 'pending',
        document_id: 'doc-1',
        doc_type: 'purchase_contract',
        original_filename: 'purchase_contract.pdf',
        source_text: 'Property address shown as 404 Oak Ave.',
        created_at: '2026-03-12T10:00:00.000Z',
      },
    ],
    conflictReport: {
      conflicts: [{
        factPath: 'subject.address',
        severity: 'blocker',
        valueCount: 2,
        values: [
          { displayValue: '404 Oak Ave', maxConfidence: 'high', sourceCount: 1 },
          { displayValue: '505 Oak Ave', maxConfidence: 'medium', sourceCount: 1 },
        ],
        hasPendingReview: true,
      }],
    },
    decisionQueue: {
      summary: { preDraftBlocked: true },
      pendingFactGroups: [{
        factPath: 'subject.address',
        pendingCount: 1,
      }],
    },
  });

  const entry = payload.entries.subject_property_address;
  assert.equal(entry.suggestion.value, '404 Oak Ave');
  assert.equal(entry.suggestion.origin, 'extracted');
  assert.equal(entry.suggestion.factId, '11111111-1111-4111-8111-111111111111');
  assert.equal(entry.candidates.length, 1);
  assert.equal(entry.candidates[0].filename, 'purchase_contract.pdf');
  assert.equal(entry.pendingReviewCount, 1);
  assert.equal(entry.conflicts.length, 1);
  assert.equal(entry.hasConflict, true);
  assert.equal(payload.qc.factReviewQueueSummary.preDraftBlocked, true);
});

await test('applyWorkspacePatch writes workspace leaf, sync path, provenance, and history', () => {
  const definition = getWorkspaceDefinition('1004');
  const projection = {
    caseId: 'abcd1234',
    meta: { updatedAt: '2026-03-12T12:00:00.000Z' },
    facts: {
      subject: {
        address: { value: '101 Main St', confidence: 'high', source: 'extractor' },
      },
    },
    provenance: {
      'subject.address': {
        sourceType: 'document',
        sourceId: 'contract.pdf',
      },
    },
    history: {},
  };

  const first = applyWorkspacePatch({
    definition,
    projection,
    changes: [{
      fieldId: 'subject_property_address',
      value: '202 Main St',
      provenance: {
        sourceType: 'document',
        sourceId: 'revised-contract.pdf',
        page: '2',
      },
    }],
    actor: 'appraiser',
  });

  assert.equal(getNestedValue(first.facts, 'workspace1004.subject.propertyAddress').value, '202 Main St');
  assert.equal(getNestedValue(first.facts, 'subject.address').value, '202 Main St');
  assert.equal(first.provenance['workspace1004.subject.propertyAddress'].sourceId, 'revised-contract.pdf');
  assert.equal(first.provenance['subject.address'].sourceId, 'revised-contract.pdf');
  assert.equal(first.saved[0].value, '202 Main St');

  const second = applyWorkspacePatch({
    definition,
    projection: {
      ...projection,
      meta: first.meta,
      facts: first.facts,
      provenance: first.provenance,
      history: first.history,
    },
    changes: [{
      fieldId: 'subject_property_address',
      value: '303 Main St',
    }],
    actor: 'appraiser',
  });

  const versions = second.history.workspace.subject_property_address;
  assert.equal(versions.length, 2);
  assert.equal(versions[0].value, '202 Main St');
  assert.equal(versions[1].value, '101 Main St');
  assert.equal(getNestedValue(second.facts, 'workspace1004.subject.propertyAddress').value, '303 Main St');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) {
    console.log('\n - ' + failure.label);
    console.log('   ' + failure.err.stack);
  }
  process.exit(1);
}
