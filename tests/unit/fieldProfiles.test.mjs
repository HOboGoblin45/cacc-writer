import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const fieldMapPath = path.join(projectRoot, 'desktop_agent', 'field_maps', '1004.json');
const surfacePath = path.join(projectRoot, 'desktop_agent', 'field_maps', '1004_surface.json');

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

const fieldMap = JSON.parse(fs.readFileSync(fieldMapPath, 'utf8'));
const surfaceMap = JSON.parse(fs.readFileSync(surfacePath, 'utf8'));

console.log('\nfieldProfiles');

test('1004 surface profile captures the full sample corpus', () => {
  assert.equal(surfaceMap._source_count, 15);
  assert.ok(Array.isArray(surfaceMap._source_files));
  assert.equal(surfaceMap._source_files.length, 15);
});

test('sales and reconciliation fields are marked pending navigation fix', () => {
  for (const fieldId of [
    'offering_history',
    'contract_analysis',
    'sales_comparison_commentary',
    'reconciliation',
  ]) {
    assert.equal(
      fieldMap[fieldId].live_calibration_status,
      'corpus_backed_pending_navigation_fix',
      `${fieldId} should not claim live confirmation`,
    );
    assert.equal(fieldMap[fieldId].calibrated, false, `${fieldId} should fail closed`);
  }
});

test('high-priority Sales/Reco profiles carry stable PDF anchors and page clusters', () => {
  const expected = {
    offering_history: [4, 3],
    contract_analysis: [4, 3],
    sales_comparison_commentary: [5, 4],
    reconciliation: [5, 4],
  };
  for (const [fieldId, pages] of Object.entries(expected)) {
    const profile = surfaceMap[fieldId];
    assert.ok(profile.pdf_anchor_text, `${fieldId} missing pdf anchor`);
    assert.deepEqual(profile.page_cluster.slice(0, 2), pages, `${fieldId} page cluster drifted`);
    assert.ok(profile.sample_hit_counts[String(pages[0])] > 0, `${fieldId} missing dominant page hit`);
  }
});

test('measured 1004 tab ratios exist for the production narrative lanes', () => {
  const expectedRatios = {
    neighborhood_description: 0.173,
    site_comments: 0.231,
    improvements_condition: 0.292,
    offering_history: 0.354,
    reconciliation: 0.370,
    cost_approach: 0.538,
    income_approach: 0.604,
  };
  for (const [fieldId, ratio] of Object.entries(expectedRatios)) {
    assert.equal(surfaceMap[fieldId].visual_tab_ratio, ratio, `${fieldId} tab ratio drifted`);
  }
});

test('site and improvements profiles remain tied to the page 3/4 block', () => {
  for (const fieldId of [
    'neighborhood_description',
    'market_conditions',
    'site_comments',
    'improvements_condition',
    'functional_utility',
    'adverse_conditions',
  ]) {
    const profile = surfaceMap[fieldId];
    assert.deepEqual(profile.page_cluster.slice(0, 2), [4, 3], `${fieldId} page cluster drifted`);
    assert.ok(profile.expected_elements.length >= 3, `${fieldId} needs content expectations`);
  }
});

console.log('\n' + '-'.repeat(60));
console.log(`fieldProfiles: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
