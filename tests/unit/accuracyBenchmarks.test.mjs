/**
 * tests/unit/accuracyBenchmarks.test.mjs
 * ---------------------------------------
 * Unit tests for Phase C benchmark scoring helpers.
 */

import assert from 'assert/strict';
import {
  scoreExtractionFixture,
  scoreGateFixture,
  summarizeBenchmarkSuite,
} from '../../server/factIntegrity/accuracyBenchmarks.js';

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

console.log('\naccuracyBenchmarks');

test('scoreExtractionFixture handles normalized currency/date/address matches', () => {
  const run = scoreExtractionFixture({
    fixtureId: 'fixture-a',
    expectedFacts: [
      { factPath: 'subject.address', value: '123 Main St., Springfield' },
      { factPath: 'contract.contractPrice', value: '500000' },
      { factPath: 'contract.contractDate', value: '2026-01-01' },
    ],
    extractedFacts: [
      { factPath: 'subject.address', value: '123 Main St Springfield' },
      { factPath: 'contract.contractPrice', value: '$500,000.00' },
      { factPath: 'contract.contractDate', value: '01/01/2026' },
    ],
  });

  assert.equal(run.matchedCount, 3);
  assert.equal(run.falsePositiveCount, 0);
  assert.equal(run.falseNegativeCount, 0);
  assert.equal(run.precision, 1);
  assert.equal(run.recall, 1);
  assert.equal(run.f1, 1);
});

test('scoreExtractionFixture reports misses and extras', () => {
  const run = scoreExtractionFixture({
    fixtureId: 'fixture-b',
    expectedFacts: [
      { factPath: 'subject.gla', value: '1800' },
      { factPath: 'subject.bedrooms', value: '3' },
    ],
    extractedFacts: [
      { factPath: 'subject.gla', value: '1800' },
      { factPath: 'subject.bathrooms', value: '2' },
    ],
  });

  assert.equal(run.matchedCount, 1);
  assert.equal(run.falsePositiveCount, 1);
  assert.equal(run.falseNegativeCount, 1);
  assert.equal(run.precision, 0.5);
  assert.equal(run.recall, 0.5);
  assert.equal(run.f1, 0.5);
});

test('scoreGateFixture validates expected blockers and ok state', () => {
  const run = scoreGateFixture({
    fixtureId: 'gate-a',
    expectedOk: false,
    expectedBlockerTypes: ['pending_fact_reviews', 'missing_required_facts'],
    gateResult: {
      ok: false,
      blockers: [
        { type: 'missing_required_facts' },
        { type: 'pending_fact_reviews' },
      ],
    },
  });

  assert.equal(run.okMatch, true);
  assert.equal(run.missingExpectedBlockers.length, 0);
  assert.equal(run.passed, true);
});

test('scoreGateFixture flags missing expected blockers', () => {
  const run = scoreGateFixture({
    fixtureId: 'gate-b',
    expectedOk: false,
    expectedBlockerTypes: ['compliance_hard_rules'],
    gateResult: {
      ok: false,
      blockers: [{ type: 'missing_required_facts' }],
    },
  });

  assert.equal(run.okMatch, true);
  assert.deepEqual(run.missingExpectedBlockers, ['compliance_hard_rules']);
  assert.equal(run.passed, false);
});

test('summarizeBenchmarkSuite aggregates extraction and gate metrics', () => {
  const summary = summarizeBenchmarkSuite({
    extractionRuns: [
      { lane: 'residential', precision: 1, recall: 0.5, f1: 0.6667 },
      { lane: 'commercial', precision: 0.5, recall: 1, f1: 0.6667 },
    ],
    gateRuns: [
      { lane: 'residential', passed: true },
      { lane: 'commercial', passed: false },
      { lane: 'residential', passed: true },
    ],
  });

  assert.equal(summary.extraction.fixtureCount, 2);
  assert.equal(summary.extraction.avgPrecision, 0.75);
  assert.equal(summary.extraction.avgRecall, 0.75);
  assert.equal(summary.gate.fixtureCount, 3);
  assert.equal(summary.gate.passedCount, 2);
  assert.equal(summary.gate.passRate, 0.6667);
  assert.equal(summary.extraction.byLane.residential.fixtureCount, 1);
  assert.equal(summary.extraction.byLane.commercial.fixtureCount, 1);
  assert.equal(summary.gate.byLane.residential.passedCount, 2);
  assert.equal(summary.gate.byLane.commercial.passedCount, 0);
});

console.log('\n' + '-'.repeat(60));
console.log(`accuracyBenchmarks: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
