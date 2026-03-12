/**
 * tests/unit/benchmarkThresholds.test.mjs
 * ----------------------------------------
 * Unit tests for Phase C benchmark threshold evaluator.
 */

import assert from 'assert/strict';
import {
  evaluatePhaseCBenchmarkThresholds,
  DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
} from '../../server/factIntegrity/benchmarkThresholds.js';

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

function makeResults({
  extraction = {},
  gate = {},
} = {}) {
  return {
    summary: {
      extraction: {
        fixtureCount: extraction.fixtureCount ?? 6,
        avgPrecision: extraction.avgPrecision ?? 0.94,
        avgRecall: extraction.avgRecall ?? 0.91,
        avgF1: extraction.avgF1 ?? 0.92,
        byLane: extraction.byLane ?? {
          residential: { fixtureCount: 5 },
          commercial: { fixtureCount: 1 },
        },
      },
      gate: {
        fixtureCount: gate.fixtureCount ?? 4,
        passRate: gate.passRate ?? 1,
        byLane: gate.byLane ?? {
          residential: { fixtureCount: 3 },
          commercial: { fixtureCount: 1 },
        },
      },
    },
  };
}

console.log('\nbenchmarkThresholds');

await test('passes when benchmark summary exceeds default thresholds', () => {
  const evaluation = evaluatePhaseCBenchmarkThresholds(
    makeResults(),
    DEFAULT_PHASE_C_BENCHMARK_THRESHOLDS,
  );

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.failedChecks, 0);
  assert.equal(evaluation.checks.length, 10);
});

await test('fails and surfaces failed check IDs when extraction quality drops', () => {
  const evaluation = evaluatePhaseCBenchmarkThresholds(
    makeResults({
      extraction: {
        fixtureCount: 6,
        avgPrecision: 0.72,
        avgRecall: 0.65,
        avgF1: 0.68,
      },
      gate: {
        fixtureCount: 4,
        passRate: 1,
      },
    }),
  );

  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.failedCheckIds.includes('extraction.avg_precision'));
  assert.ok(evaluation.failedCheckIds.includes('extraction.avg_recall'));
  assert.ok(evaluation.failedCheckIds.includes('extraction.avg_f1'));
});

await test('fails lane coverage checks when commercial fixtures are missing', () => {
  const evaluation = evaluatePhaseCBenchmarkThresholds(
    makeResults({
      extraction: {
        byLane: {
          residential: { fixtureCount: 6 },
          commercial: { fixtureCount: 0 },
        },
      },
      gate: {
        byLane: {
          residential: { fixtureCount: 4 },
          commercial: { fixtureCount: 0 },
        },
      },
    }),
  );

  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.failedCheckIds.includes('extraction.lane.commercial.fixture_count'));
  assert.ok(evaluation.failedCheckIds.includes('gate.lane.commercial.fixture_count'));
});

await test('honors threshold overrides', () => {
  const evaluation = evaluatePhaseCBenchmarkThresholds(
    makeResults({
      extraction: {
        fixtureCount: 2,
        avgPrecision: 0.8,
        avgRecall: 0.8,
        avgF1: 0.8,
      },
      gate: {
        fixtureCount: 1,
        passRate: 0.9,
      },
    }),
    {
      extraction: {
        minFixtureCount: 2,
        minAvgPrecision: 0.8,
        minAvgRecall: 0.8,
        minAvgF1: 0.8,
        minLaneFixtureCounts: {
          residential: 1,
          commercial: 0,
        },
      },
      gate: {
        minFixtureCount: 1,
        minPassRate: 0.9,
        minLaneFixtureCounts: {
          residential: 1,
          commercial: 0,
        },
      },
    },
  );

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.failedChecks, 0);
});

console.log('\n' + '-'.repeat(60));
console.log(`benchmarkThresholds: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
