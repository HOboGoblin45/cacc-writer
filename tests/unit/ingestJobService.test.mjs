/**
 * tests/unit/ingestJobService.test.mjs
 * -------------------------------------
 * Unit tests for Phase C document ingest job orchestration service.
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-ingest-job-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'ingest-jobs.db');

const dbModule = await import('../../server/db/database.js');
const {
  createDocumentIngestJob,
  getDocumentIngestJob,
  listCaseDocumentIngestJobs,
  runDocumentIngestStep,
  failDocumentIngestStep,
  finalizeDocumentIngestJob,
  isDocumentIngestStepFailed,
  getDocumentIngestRetryState,
} = await import('../../server/ingestion/ingestJobService.js');

async function cleanup() {
  try {
    dbModule.closeDb();
  } catch {
    // best effort
  }
  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\ningestJobService');

await test('createDocumentIngestJob persists initial running job', () => {
  const job = createDocumentIngestJob({
    caseId: 'abc12345',
    originalFilename: 'contract.pdf',
    maxRetries: 2,
  });

  assert.ok(job?.id, 'expected job id');
  assert.equal(job.caseId, 'abc12345');
  assert.equal(job.status, 'running');
  assert.equal(job.currentStep, 'upload');
  assert.equal(job.maxRetries, 2);
});

await test('runDocumentIngestStep retries and then succeeds', async () => {
  const job = createDocumentIngestJob({
    caseId: 'abc12345',
    originalFilename: 'retry.pdf',
    maxRetries: 2,
  });

  let calls = 0;
  const run = await runDocumentIngestStep(
    job.id,
    'extract',
    { maxAttempts: 2, fatalOnFinalFailure: true },
    async () => {
      calls++;
      if (calls === 1) throw new Error('transient failure');
      return { meta: { factsExtracted: 3 } };
    },
  );

  assert.equal(run.ok, true);
  assert.equal(calls, 2);

  const updated = getDocumentIngestJob(job.id);
  assert.equal(updated.retryCount, 1, 'retry_count should increment on retry');
  assert.equal(updated.steps.extract.status, 'completed');
  assert.equal(updated.steps.extract.attempts, 2);
});

await test('non-fatal step failure stores recoverable actions and finalizes partial', async () => {
  const job = createDocumentIngestJob({
    caseId: 'def67890',
    originalFilename: 'partial.pdf',
    maxRetries: 1,
  });

  await runDocumentIngestStep(
    job.id,
    'stage',
    { maxAttempts: 1, fatalOnFinalFailure: true },
    async () => ({ meta: { done: true } }),
  );

  const step = await runDocumentIngestStep(
    job.id,
    'extract',
    {
      maxAttempts: 1,
      fatalOnFinalFailure: false,
      recoverableActionsOnFailure: [
        { id: 'rerun_extraction', label: 'Retry Extraction' },
      ],
    },
    async () => {
      throw new Error('extract failed');
    },
  );
  assert.equal(step.ok, false);

  const finalized = finalizeDocumentIngestJob(job.id);
  assert.equal(finalized.status, 'partial');
  assert.equal(isDocumentIngestStepFailed(finalized, 'extract'), true);
  assert.equal(finalized.recoverableActions[0]?.id, 'rerun_extraction');
});

await test('fatal failure marks job failed', () => {
  const job = createDocumentIngestJob({
    caseId: 'feedbeef',
    originalFilename: 'fatal.pdf',
  });

  failDocumentIngestStep(job.id, 'classify', {
    errorText: 'classification crashed',
    recoverableActions: [{ id: 'retry_classification', label: 'Retry Classification' }],
    fatal: true,
  });

  const failedJob = getDocumentIngestJob(job.id);
  assert.equal(failedJob.status, 'failed');
  assert.equal(failedJob.currentStep, 'classify');
  assert.equal(failedJob.steps.classify.status, 'failed');
});

await test('listCaseDocumentIngestJobs returns jobs by case', () => {
  const jobs = listCaseDocumentIngestJobs('abc12345', 10);
  assert.ok(Array.isArray(jobs));
  assert.ok(jobs.length >= 1);
  assert.ok(jobs.every(j => j.caseId === 'abc12345'));
});

await test('getDocumentIngestRetryState returns step_not_failed when step is not failed', () => {
  const job = createDocumentIngestJob({
    caseId: 'retry-state-1',
    originalFilename: 'state.pdf',
    maxRetries: 2,
  });

  const state = getDocumentIngestRetryState(job, 'extract');
  assert.equal(state.ok, false);
  assert.equal(state.reason, 'step_not_failed');
  assert.equal(state.maxRetries, 2);
});

await test('getDocumentIngestRetryState returns retry_limit_reached when retries are exhausted', async () => {
  const job = createDocumentIngestJob({
    caseId: 'retry-state-2',
    originalFilename: 'limit.pdf',
    maxRetries: 1,
  });

  const step = await runDocumentIngestStep(
    job.id,
    'extract',
    { maxAttempts: 2, fatalOnFinalFailure: false },
    async () => {
      throw new Error('still failing');
    },
  );
  assert.equal(step.ok, false);

  const updated = getDocumentIngestJob(job.id);
  assert.equal(updated.steps.extract.status, 'failed');

  const state = getDocumentIngestRetryState(updated, 'extract');
  assert.equal(state.ok, false);
  assert.equal(state.reason, 'retry_limit_reached');
  assert.equal(state.retryCount, 1);
  assert.equal(state.maxRetries, 1);
  assert.equal(state.remainingRetries, 0);
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`ingestJobService: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
