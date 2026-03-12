/**
 * tests/unit/run.mjs
 * Runs all unit test suites sequentially and reports a combined summary.
 * Run: node tests/unit/run.mjs
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runId = `${Date.now()}-${process.pid}`;
const queueStatePath = process.env.CACC_QUEUE_STATE_FILE
  || path.join(os.tmpdir(), `cacc-unit-${runId}-queue_state.json`);
const logsDir = process.env.CACC_LOGS_DIR
  || path.join(os.tmpdir(), `cacc-unit-${runId}-logs`);
const dbPath = process.env.CACC_DB_PATH
  || path.join(os.tmpdir(), `cacc-unit-${runId}.db`);

const suites = [
  'textUtils.test.mjs',
  'fileUtils.test.mjs',
  'caseUtils.test.mjs',
  'workflowStateMachine.test.mjs',
  'workspaceService.test.mjs',
  'contradictionGraphService.test.mjs',
  'contradictionGraphChecker.test.mjs',
  'comparableIntelligenceService.test.mjs',
  'comparableQcChecker.test.mjs',
  'caseApprovalGate.test.mjs',
  'caseRecordService.test.mjs',
  'accuracyBenchmarks.test.mjs',
  'benchmarkRunner.test.mjs',
  'benchmarkThresholds.test.mjs',
  'factIntegrity.test.mjs',
  'documentIntake.test.mjs',
  'ingestJobService.test.mjs',
  'documentClassifier.test.mjs',
  'documentExtractors.test.mjs',
  'documentQuality.test.mjs',
  'complianceProfile.test.mjs',
  'intelligenceRules.test.mjs',
  'insertionQcGate.test.mjs',
  'envPrecedence.test.mjs',
  'middleware.test.mjs',
  'logger.test.mjs',
  'openaiClient.test.mjs',
  'promptBuilder.test.mjs',
  'knowledgeBase.test.mjs',
  'generationService.test.mjs',
  'generationOrchestrator.test.mjs',
  'reportQueue.test.mjs',
];

let totalPassed = 0;
let totalFailed = 0;
const suiteSummaries = [];

console.log('='.repeat(60));
console.log('CACC Writer — Unit Test Suite');
console.log('='.repeat(60));

for (const suite of suites) {
  const suitePath = path.join(__dirname, suite);
  console.log('\n▶ ' + suite);
  console.log('─'.repeat(60));

  const result = spawnSync(process.execPath, [suitePath], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      ...process.env,
      CACC_QUEUE_STATE_FILE: queueStatePath,
      CACC_LOGS_DIR: logsDir,
      CACC_DB_PATH: dbPath,
      CACC_DISABLE_FILE_LOGGER: process.env.CACC_DISABLE_FILE_LOGGER || '1',
      CACC_DISABLE_KB_WRITES: process.env.CACC_DISABLE_KB_WRITES || '1',
    },
  });

  const output = result.stdout + result.stderr;
  process.stdout.write(output);

  // Parse pass/fail counts from the summary line
  const match = output.match(/(\d+) passed,\s*(\d+) failed/);
  if (match) {
    const p = parseInt(match[1], 10);
    const f = parseInt(match[2], 10);
    totalPassed += p;
    totalFailed += f;
    suiteSummaries.push({ suite, passed: p, failed: f, exitCode: result.status });
  } else {
    // Suite crashed before printing summary
    totalFailed++;
    suiteSummaries.push({ suite, passed: 0, failed: 1, exitCode: result.status ?? 1 });
    if (result.error) {
      console.log('  ERROR: ' + result.error.message);
    }
  }
}

// ── Combined summary ──────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('UNIT TEST SUMMARY');
console.log('='.repeat(60));
suiteSummaries.forEach(({ suite, passed, failed }) => {
  const status = failed === 0 ? '✓' : '✗';
  console.log(`  ${status}  ${suite.padEnd(30)} ${passed} passed, ${failed} failed`);
});
console.log('─'.repeat(60));
console.log(`     ${'TOTAL'.padEnd(30)} ${totalPassed} passed, ${totalFailed} failed`);
console.log('='.repeat(60));

if (totalFailed > 0) {
  console.log('\n✗ ' + totalFailed + ' test(s) failed');
  cleanupUnitArtifacts();
  process.exit(1);
} else {
  console.log('\n✓ All ' + totalPassed + ' tests passed');
  cleanupUnitArtifacts();
}

function cleanupUnitArtifacts() {
  const targets = [
    queueStatePath,
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
  ];

  for (const target of targets) {
    try {
      if (target && process.env.CACC_KEEP_TEST_ARTIFACTS !== '1') {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      }
    } catch {
      // best effort cleanup
    }
  }

  try {
    if (process.env.CACC_KEEP_TEST_ARTIFACTS !== '1') {
      if (fs.existsSync(logsDir)) {
        fs.rmSync(logsDir, { recursive: true, force: true });
      }
    }
  } catch {
    // best effort cleanup
  }
}
