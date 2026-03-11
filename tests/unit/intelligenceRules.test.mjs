/**
 * tests/unit/intelligenceRules.test.mjs
 * --------------------------------------
 * Unit tests for deterministic section requirement matrix + hard compliance rules.
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
const { getManifestForFormType, resolveReportFamily } = await import('../../server/intelligence/reportFamilyManifest.js');
const { getApplicableFields } = await import('../../server/intelligence/canonicalFields.js');
const { buildSectionRequirementMatrix } = await import('../../server/intelligence/sectionRequirementMatrix.js');
const { evaluateHardComplianceRules } = await import('../../server/intelligence/hardComplianceRules.js');

function buildScenario({ caseId = 'intelligence-test', meta = {}, facts = {} } = {}) {
  const context = normalizeAssignmentContextV2(caseId, meta, facts);
  const flags = deriveAssignmentFlags(context);
  const compliance = buildComplianceProfile(context, flags);
  const reportFamilyId = resolveReportFamily(context.formType, flags);
  const manifest = getManifestForFormType(context.formType, flags);
  const applicableFields = getApplicableFields(flags, reportFamilyId);
  const sectionRequirements = buildSectionRequirementMatrix({
    manifest,
    flags,
    applicableFields,
  });
  const complianceChecks = evaluateHardComplianceRules({
    context,
    flags,
    compliance,
    sectionRequirements,
  });

  return {
    context,
    flags,
    compliance,
    reportFamilyId,
    manifest,
    applicableFields,
    sectionRequirements,
    complianceChecks,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

console.log('\nsectionRequirementMatrix + hardComplianceRules');

await test('section matrix promotes triggered commentary blocks to required', () => {
  const scenario = buildScenario({
    meta: {
      formType: '1004',
      loanProgram: 'fha',
      reportConditionMode: 'subject_to_repairs',
    },
    facts: {
      site: {
        floodZone: 'AE',
        zoningConformity: 'legal_nonconforming',
      },
    },
  });

  const required = new Set(scenario.sectionRequirements.requiredSectionIds || []);
  assert.ok(required.has('neighborhood_description'), 'baseline required section missing');
  assert.ok(required.has('flood_comment'), 'flood_comment should be required when flood flag is active');
  assert.ok(required.has('zoning_comment'), 'zoning_comment should be required when zoning flag is active');
  assert.ok(required.has('subject_to_repairs_comment'), 'repairs comment should be required for subject-to repairs');
  assert.ok(required.has('fha_repair_comment'), 'fha_repair_comment should be required for FHA repair scenario');
});

await test('hard compliance rules pass with no blockers for baseline 1004 scenario', () => {
  const scenario = buildScenario({
    meta: { formType: '1004' },
  });

  assert.equal(scenario.complianceChecks.summary.blockerCount, 0, 'expected no compliance blockers');
  assert.equal(Array.isArray(scenario.complianceChecks.blockers), true);
});

await test('hard compliance rules block when reconciliation section is missing', () => {
  const scenario = buildScenario({
    meta: { formType: '1004' },
  });

  const matrix = clone(scenario.sectionRequirements);
  const reconciliation = matrix.sections.find(s => s.sectionId === 'reconciliation');
  assert.ok(reconciliation, 'expected reconciliation section in matrix');
  reconciliation.status = 'excluded';
  reconciliation.required = false;

  const checks = evaluateHardComplianceRules({
    context: scenario.context,
    flags: scenario.flags,
    compliance: scenario.compliance,
    sectionRequirements: matrix,
  });

  const blocker = checks.blockers.find(b => b.ruleId === 'rule.reconciliation.section');
  assert.ok(blocker, 'expected reconciliation blocker finding');
});

await test('hard compliance rules block FHA assignment without fha_repair_comment section', () => {
  const scenario = buildScenario({
    meta: {
      formType: '1004',
      loanProgram: 'fha',
      reportConditionMode: 'subject_to_repairs',
    },
  });

  const matrix = clone(scenario.sectionRequirements);
  const fhaRepair = matrix.sections.find(s => s.sectionId === 'fha_repair_comment');
  assert.ok(fhaRepair, 'expected fha_repair_comment section in matrix');
  fhaRepair.status = 'excluded';
  fhaRepair.required = false;

  const checks = evaluateHardComplianceRules({
    context: scenario.context,
    flags: scenario.flags,
    compliance: scenario.compliance,
    sectionRequirements: matrix,
  });

  const blocker = checks.blockers.find(b => b.ruleId === 'rule.fha.repair_commentary');
  assert.ok(blocker, 'expected FHA repair blocker when section is excluded');
});

await test('hard compliance rules block when income approach is likely but income sections are excluded', () => {
  const scenario = buildScenario({
    meta: {
      formType: 'commercial',
      propertyType: 'commercial',
    },
  });

  const matrix = clone(scenario.sectionRequirements);
  for (const sectionId of ['income_approach', 'market_rent_analysis', 'rental_analysis']) {
    const section = matrix.sections.find(s => s.sectionId === sectionId);
    if (!section) continue;
    section.status = 'excluded';
    section.required = false;
  }

  const checks = evaluateHardComplianceRules({
    context: scenario.context,
    flags: scenario.flags,
    compliance: scenario.compliance,
    sectionRequirements: matrix,
  });

  const blocker = checks.blockers.find(b => b.ruleId === 'rule.income_approach.section');
  assert.ok(blocker, 'expected income approach blocker when income sections are excluded');
});

await test('hard compliance rules block when cost approach is likely but cost section is excluded', () => {
  const scenario = buildScenario({
    meta: {
      formType: '1004',
      costApplicable: true,
    },
  });

  const matrix = clone(scenario.sectionRequirements);
  const cost = matrix.sections.find(s => s.sectionId === 'cost_approach');
  assert.ok(cost, 'expected cost_approach section in matrix');
  cost.status = 'excluded';
  cost.required = false;

  const checks = evaluateHardComplianceRules({
    context: scenario.context,
    flags: scenario.flags,
    compliance: scenario.compliance,
    sectionRequirements: matrix,
  });

  const blocker = checks.blockers.find(b => b.ruleId === 'rule.cost_approach.section');
  assert.ok(blocker, 'expected cost approach blocker when cost section is excluded');
});

await test('hard compliance rules warn when certification-risk disclosures are excluded', () => {
  const scenario = buildScenario({
    meta: {
      formType: '1004',
      extraordinaryAssumptions: ['Assume no hidden structural defects.'],
    },
  });

  const matrix = clone(scenario.sectionRequirements);
  const ea = matrix.sections.find(s => s.sectionId === 'ea_comment');
  assert.ok(ea, 'expected ea_comment section in matrix');
  ea.status = 'excluded';
  ea.required = false;

  const checks = evaluateHardComplianceRules({
    context: scenario.context,
    flags: scenario.flags,
    compliance: scenario.compliance,
    sectionRequirements: matrix,
  });

  const warning = checks.warnings.find(b => b.ruleId === 'rule.certification.disclosure');
  assert.ok(warning, 'expected certification disclosure warning when EA commentary is excluded');
});

console.log('\n' + '-'.repeat(60));
console.log(`intelligenceRules: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);

