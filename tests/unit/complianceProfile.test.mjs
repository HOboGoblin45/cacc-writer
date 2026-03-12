/**
 * tests/unit/complianceProfile.test.mjs
 * --------------------------------------
 * Unit tests for deterministic compliance profile builder outputs.
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

const { normalizeAssignmentContextV2 } = await import('../../server/intelligence/normalizer.js');
const { deriveAssignmentFlags } = await import('../../server/intelligence/derivedFlags.js');
const { buildComplianceProfile } = await import('../../server/intelligence/complianceProfile.js');

function buildProfile({ caseId = 'compliance-profile-test', meta = {}, facts = {} } = {}) {
  const context = normalizeAssignmentContextV2(caseId, meta, facts);
  const flags = deriveAssignmentFlags(context);
  const profile = buildComplianceProfile(context, flags);
  return { context, flags, profile };
}

console.log('\ncomplianceProfile');

await test('builds baseline residential profile for URAR 1004', () => {
  const { profile } = buildProfile({
    meta: { formType: '1004' },
  });

  assert.equal(profile.uspap_applicable, true);
  assert.equal(profile.fha_overlay, false);
  assert.equal(profile.usda_overlay, false);
  assert.equal(profile.va_overlay, false);
  assert.equal(profile.report_family, 'urar_1004');
  assert.ok(profile.likely_commentary_families.includes('reconciliation'));
  assert.ok(profile.likely_qc_categories.includes('uspap_compliance'));
});

await test('activates FHA + flood + repairs profile families and QC tags', () => {
  const { profile } = buildProfile({
    meta: {
      formType: '1004',
      loanProgram: 'fha',
      reportConditionMode: 'subject_to_repairs',
    },
    facts: {
      site: {
        floodZone: 'AE',
      },
    },
  });

  assert.equal(profile.fha_overlay, true);
  assert.ok(profile.assignment_condition_implications.includes('repair_list_required'));
  assert.ok(profile.assignment_condition_implications.includes('fha_repair_requirements_commentary'));
  assert.ok(profile.likely_commentary_families.includes('flood'));
  assert.ok(profile.likely_commentary_families.includes('repairs'));
  assert.ok(profile.likely_commentary_families.includes('fha_requirements'));
  assert.ok(profile.likely_qc_categories.includes('government_program_compliance'));
  assert.ok(profile.likely_qc_categories.includes('fha_minimum_property_requirements'));
  assert.ok(profile.likely_qc_categories.includes('flood_zone_documentation'));
});

await test('resolves manufactured home report family and implications', () => {
  const { profile } = buildProfile({
    meta: { formType: '1004c' },
  });

  assert.equal(profile.report_family, 'urar_1004c');
  assert.ok(profile.property_type_implications.includes('manufactured_home_addendum'));
  assert.ok(profile.likely_commentary_families.includes('manufactured_home'));
  assert.ok(profile.likely_qc_categories.includes('manufactured_home_documentation'));
});

await test('resolves commercial narrative profile and approach implications', () => {
  const { profile } = buildProfile({
    meta: {
      formType: 'commercial',
      propertyType: 'commercial',
    },
  });

  assert.equal(profile.report_family, 'commercial_narrative');
  assert.ok(profile.property_type_implications.includes('commercial_scope_of_work'));
  assert.ok(profile.property_type_implications.includes('three_approach_analysis'));
});

await test('marks USDA overlay and site eligibility obligations', () => {
  const { profile } = buildProfile({
    meta: {
      formType: '1004',
      loanProgram: 'usda',
      rural: true,
    },
  });

  assert.equal(profile.usda_overlay, true);
  assert.ok(profile.property_type_implications.includes('usda_site_eligibility_verification'));
  assert.ok(profile.likely_commentary_families.includes('usda_eligibility'));
  assert.ok(profile.likely_qc_categories.includes('usda_site_eligibility'));
});

console.log('\n' + '-'.repeat(60));
console.log(`complianceProfile: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
