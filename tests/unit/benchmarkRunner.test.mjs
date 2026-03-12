/**
 * tests/unit/benchmarkRunner.test.mjs
 * ------------------------------------
 * Unit tests for Phase C benchmark runner utilities.
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readPhaseCBenchmarkFixtures,
  runPhaseCBenchmarkSuite,
  runPhaseCBenchmarksFromFile,
  writePhaseCBenchmarkResults,
  readPhaseCBenchmarkResults,
} from '../../server/factIntegrity/benchmarkRunner.js';

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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-phase-c-bench-'));

async function cleanup() {
  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\nbenchmarkRunner');

await test('readPhaseCBenchmarkFixtures parses repo fixture file', () => {
  const fixturePath = path.resolve(process.cwd(), 'benchmarks/phase-c/fixtures.v1.json');
  const fixtures = readPhaseCBenchmarkFixtures(fixturePath);
  assert.equal(typeof fixtures.version, 'string');
  assert.ok(Array.isArray(fixtures.extractionFixtures));
  assert.ok(fixtures.extractionFixtures.length >= 1);
  const complianceFixture = fixtures.gateFixtures.find(f => f.id === 'gate-block-compliance');
  assert.ok(complianceFixture, 'expected compliance gate fixture');
  assert.deepEqual(
    complianceFixture.expectedComplianceRuleIds,
    ['rule.mixed_use.commentary'],
  );
});

await test('runPhaseCBenchmarkSuite returns extraction and gate summaries', async () => {
  const fixtures = {
    version: 'unit-fixture',
    extractionFixtures: [
      {
        id: 'contract-smoke',
        lane: 'residential',
        docType: 'contract',
        text: 'Contract Date: 01/02/2026 Purchase Price: $500,000 Closing Date: 02/14/2026',
        expectedFacts: [
          { factPath: 'contract.salePrice', value: '500000' },
          { factPath: 'contract.contractDate', value: '2026-01-02' },
        ],
      },
    ],
    gateFixtures: [
      {
        id: 'gate-pass',
        lane: 'commercial',
        expectedOk: true,
        expectedBlockerTypes: [],
        expectedComplianceRuleIds: ['rule.fha.repair_commentary'],
        gateResult: { ok: true, blockers: [] },
      },
      {
        id: 'gate-compliance',
        lane: 'residential',
        expectedOk: false,
        expectedBlockerTypes: ['compliance_hard_rules'],
        expectedComplianceRuleIds: ['rule.fha.repair_commentary'],
        gateResult: {
          ok: false,
          blockers: [
            {
              type: 'compliance_hard_rules',
              findings: [{ ruleId: 'rule.fha.repair_commentary' }],
            },
          ],
        },
      },
    ],
  };

  const results = await runPhaseCBenchmarkSuite(fixtures);
  assert.equal(results.version, 'unit-fixture');
  assert.equal(results.extractionRuns.length, 1);
  assert.equal(results.gateRuns.length, 2);
  assert.equal(results.extractionRuns[0].lane, 'residential');
  assert.equal(results.gateRuns[0].lane, 'commercial');
  assert.equal(results.gateRuns[1].lane, 'residential');
  assert.equal(results.summary.extraction.fixtureCount, 1);
  assert.equal(results.summary.gate.fixtureCount, 2);
  assert.equal(results.summary.extraction.byLane.residential.fixtureCount, 1);
  assert.equal(results.summary.gate.byLane.commercial.fixtureCount, 1);
  assert.equal(results.summary.gate.byLane.residential.fixtureCount, 1);
  assert.ok(results.gateRuns[1].actualComplianceRuleIds.includes('rule.fha.repair_commentary'));
  assert.equal(results.gateRuns[1].missingExpectedComplianceRuleIds.length, 0);
  assert.equal(results.gateRuns[1].passed, true);
});

await test('runPhaseCBenchmarksFromFile + write/read result snapshot round-trips', async () => {
  const fixturePath = path.join(tmpRoot, 'fixtures.json');
  const outputPath = path.join(tmpRoot, 'latest-results.json');

  fs.writeFileSync(fixturePath, JSON.stringify({
    version: 'tmp-fixture',
    extractionFixtures: [
      {
        id: 'zoning-1',
        docType: 'zoning_document',
        text: 'Zoning Classification: R-3 legal nonconforming',
        expectedFacts: [
          { factPath: 'site.zoning', value: 'R-3' },
        ],
      },
    ],
    gateFixtures: [],
  }, null, 2));

  const run = await runPhaseCBenchmarksFromFile({ fixturePath });
  assert.equal(run.fixtures.version, 'tmp-fixture');
  assert.equal(run.results.summary.extraction.fixtureCount, 1);

  writePhaseCBenchmarkResults(run.results, outputPath);
  const saved = readPhaseCBenchmarkResults(outputPath);
  assert.ok(saved && typeof saved === 'object');
  assert.equal(saved.summary.extraction.fixtureCount, 1);
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`benchmarkRunner: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
