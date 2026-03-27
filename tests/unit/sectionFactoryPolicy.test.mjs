/**
 * tests/unit/sectionFactoryPolicy.test.mjs
 * ----------------------------------------
 * Unit tests for deterministic section policy and regenerate enforcement.
 */

import assert from 'assert/strict';

import {
  resolveSectionPolicy,
  buildDependencySnapshot,
  evaluateRegeneratePolicy,
  scoreSectionOutput,
} from '../../server/sectionFactory/sectionPolicyService.js';
import { RUN_STATUS } from '../../server/db/repositories/generationRepo.js';

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

console.log('\nsectionFactoryPolicy');

test('resolves pinned prompt version and dependency graph for synthesis sections', () => {
  const policy = resolveSectionPolicy({
    formType: '1004',
    sectionDef: {
      id: 'reconciliation',
      generatorProfile: 'synthesis',
      dependsOn: ['market_conditions', 'sales_comparison_summary'],
      analysisRequired: [],
    },
  });

  assert.equal(policy.promptVersion, 'cacc-section-factory/synthesis@1');
  assert.deepEqual(policy.dependencyGraph.upstreamSections, ['market_conditions', 'sales_comparison_summary']);
  assert.equal(policy.regeneratePolicy.requiresCompletedDependencies, true);
});

test('blocks regenerate when required upstream sections are missing', () => {
  const policy = resolveSectionPolicy({
    formType: '1004',
    sectionDef: {
      id: 'reconciliation',
      generatorProfile: 'synthesis',
      dependsOn: ['market_conditions', 'sales_comparison_summary'],
      analysisRequired: [],
    },
  });

  const check = evaluateRegeneratePolicy({
    runStatus: { status: RUN_STATUS.COMPLETE },
    sectionPolicy: policy,
    generatedSections: [
      { section_id: 'market_conditions', final_text: 'Market section present.' },
    ],
  });

  assert.equal(check.ok, false);
  assert.equal(check.code, 'SECTION_DEPENDENCIES_INCOMPLETE');
  assert.deepEqual(check.dependencySnapshot.missingDependencies, ['sales_comparison_summary']);
});

test('builds dependency snapshot from object maps and quality score penalties', () => {
  const policy = resolveSectionPolicy({
    formType: '1004',
    sectionDef: {
      id: 'reconciliation',
      generatorProfile: 'synthesis',
      dependsOn: ['market_conditions'],
      analysisRequired: [],
    },
  });

  const snapshot = buildDependencySnapshot({
    sectionPolicy: policy,
    generatedSections: {
      market_conditions: { text: 'Stable market narrative.' },
    },
  });

  assert.deepEqual(snapshot.satisfiedDependencies, ['market_conditions']);
  assert.deepEqual(snapshot.missingDependencies, []);

  const quality = scoreSectionOutput({
    sectionPolicy: policy,
    text: 'Short.',
    warningsCount: 2,
    dependencySnapshot: snapshot,
    analysisContextUsed: false,
    priorSectionsContextUsed: false,
    retrievalSourceIds: [],
  });

  assert.ok(quality.score < 1);
  assert.ok(quality.metadata.penalties.some(p => p.code === 'thin_output'));
  assert.ok(quality.metadata.penalties.some(p => p.code === 'warning_overflow'));
});

console.log('\n' + '-'.repeat(60));
console.log(`sectionFactoryPolicy: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
