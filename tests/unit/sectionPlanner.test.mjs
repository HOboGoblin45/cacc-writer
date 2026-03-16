/**
 * tests/unit/sectionPlanner.test.mjs
 * Verifies manifest-backed conditional sections are preserved in the section plan.
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

const { buildSectionPlanV2 } = await import('../../server/intelligence/sectionPlanner.js');
const { getApplicableFields } = await import('../../server/intelligence/canonicalFields.js');
const { getManifestForFormType } = await import('../../server/intelligence/reportFamilyManifest.js');

console.log('\nsectionPlanner');

await test('commercial plan includes active conditional market rent and income sub-sections', () => {
  const flags = {
    commercial_property: true,
    income_approach_likely: true,
    cost_approach_likely: false,
  };
  const manifest = getManifestForFormType('commercial', flags);
  const applicableFields = getApplicableFields(flags, manifest.id);
  const plan = buildSectionPlanV2(
    { caseId: 'plan-test-commercial', formType: 'commercial' },
    flags,
    { likely_qc_categories: [] },
    manifest,
    applicableFields,
  );

  for (const sectionId of [
    'market_rent_analysis',
    'rent_roll_remarks',
    'expense_remarks',
    'direct_capitalization_conclusion',
  ]) {
    const section = plan.sections.find(entry => entry.id === sectionId);
    assert.ok(section, `expected ${sectionId} in section plan`);
    assert.equal(section.required, true, `${sectionId} should be required when income_approach_likely is active`);
  }
});

console.log('\n' + '-'.repeat(60));
console.log(`sectionPlanner: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
