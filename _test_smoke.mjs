/**
 * _test_smoke.mjs
 * ---------------
 * Smoke tests for CACC Writer production server.
 *
 * Tests all critical API endpoints to confirm the server starts correctly
 * and all routes respond with expected shapes. Does NOT require a live
 * OpenAI key — AI endpoints are tested for correct error handling only.
 *
 * Run:
 *   node _test_smoke.mjs
 *
 * Prerequisites:
 *   - Server must be running: node cacc-writer-server.js
 *   - Or start it first: npm start
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 */

import { ensureServerRunning } from './tests/helpers/serverHarness.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const smokeRunId = crypto.randomUUID().slice(0, 8);
const smokeTmpRoot = path.join(os.tmpdir(), `cacc-smoke-${smokeRunId}`);
const smokeDbPath = path.join(smokeTmpRoot, 'cacc-smoke.db');
process.env.CACC_QUEUE_STATE_FILE = process.env.CACC_QUEUE_STATE_FILE
  || path.join(smokeTmpRoot, 'queue_state.json');
process.env.CACC_LOGS_DIR = process.env.CACC_LOGS_DIR
  || path.join(smokeTmpRoot, 'logs');
process.env.CACC_DB_PATH = process.env.CACC_DB_PATH || smokeDbPath;
process.env.CACC_DISABLE_FILE_LOGGER = process.env.CACC_DISABLE_FILE_LOGGER || '1';
process.env.CACC_DISABLE_KB_WRITES = process.env.CACC_DISABLE_KB_WRITES || '1';

const defaultSmokePort = 5600 + Math.floor(Math.random() * 2000);
const REQUESTED_BASE = process.env.TEST_BASE_URL || `http://127.0.0.1:${defaultSmokePort}`;
const AUTO_START = process.env.SMOKE_AUTO_START !== '0';
const serverHarness = await ensureServerRunning({
  baseUrl: REQUESTED_BASE,
  autoStart: AUTO_START,
  cwd: process.cwd(),
});
const BASE = serverHarness.baseUrl;
const TIMEOUT_MS = 8000;

function cleanupSmokeArtifacts() {
  const targets = [
    process.env.CACC_QUEUE_STATE_FILE,
    process.env.CACC_DB_PATH,
    process.env.CACC_DB_PATH ? `${process.env.CACC_DB_PATH}-wal` : null,
    process.env.CACC_DB_PATH ? `${process.env.CACC_DB_PATH}-shm` : null,
  ];

  for (const target of targets) {
    if (!target) continue;
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    } catch {
      // best effort cleanup
    }
  }

  const logsDir = process.env.CACC_LOGS_DIR;
  if (logsDir) {
    try {
      if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }

  try {
    if (fs.existsSync(smokeTmpRoot)) fs.rmSync(smokeTmpRoot, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertOk(body, label) {
  assert(body && typeof body === 'object', `${label}: response is not an object`);
  assert(body.ok === true, `${label}: ok !== true (got: ${JSON.stringify(body).slice(0, 200)})`);
}

async function api(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function apiForm(path, formData) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      body: formData,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

// ── Test state ────────────────────────────────────────────────────────────────
let testCaseId = null;
let latestIngestJobId = null;
let smokeQueueBatchId = null;
let smokeQueueJobId = null;

// ── Test suites ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  CACC Writer Smoke Tests');
console.log(`  Target: ${BASE}`);
console.log('══════════════════════════════════════════\n');

// ── 1. Health & Forms ─────────────────────────────────────────────────────────
console.log('1. Health & Forms');

await test('GET /api/health returns ok', async () => {
  const { status, body } = await api('GET', '/api/health');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/health');
  assert(typeof body.model === 'string', 'model should be a string');
});

await test('GET /api/forms returns form list', async () => {
  const { status, body } = await api('GET', '/api/forms');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/forms');
  assert(Array.isArray(body.forms), 'forms should be an array');
  assert(body.forms.length >= 4, `Expected >= 4 forms, got ${body.forms.length}`);
});

await test('GET /api/forms/1004 returns 1004 config', async () => {
  const { status, body } = await api('GET', '/api/forms/1004');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/forms/1004');
  assert(body.config?.id === '1004', 'config.id should be 1004');
  assert(Array.isArray(body.config?.fields), 'config.fields should be an array');
});

await test('GET /api/forms/invalid returns 404', async () => {
  const { status } = await api('GET', '/api/forms/9999');
  assert(status === 404, `Expected 404, got ${status}`);
});

// ── 2. Case Management ────────────────────────────────────────────────────────
console.log('\n2. Case Management');

await test('POST /api/cases/create creates a case', async () => {
  const { status, body } = await api('POST', '/api/cases/create', {
    address: '123 Test St, Miami, FL 33101',
    borrower: 'Test Borrower',
    formType: '1004',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/cases/create');
  assert(typeof body.caseId === 'string' && body.caseId.length === 8, 'caseId should be 8 chars');
  assert(body.meta?.formType === '1004', 'formType should be 1004');
  testCaseId = body.caseId;
  console.log(`    → Created test case: ${testCaseId}`);
});

await test('GET /api/cases returns case list', async () => {
  const { status, body } = await api('GET', '/api/cases');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/cases');
  assert(Array.isArray(body.cases), 'cases should be an array');
  assert(body.cases.some(c => c.caseId === testCaseId), 'test case should appear in list');
});

await test('GET /api/cases/:caseId returns case detail', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/cases/:caseId');
  assert(body.meta?.caseId === testCaseId, 'caseId should match');
  assert(typeof body.facts === 'object', 'facts should be an object');
  assert(typeof body.outputs === 'object', 'outputs should be an object');
});

await test('PATCH /api/cases/:caseId updates case metadata', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}`, {
    notes: 'Smoke test note',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'PATCH /api/cases/:caseId');
  assert(body.meta?.notes === 'Smoke test note', 'notes should be updated');
});

await test('GET /api/cases/invalid returns 400', async () => {
  const { status } = await api('GET', '/api/cases/notavalidid');
  assert(status === 400, `Expected 400, got ${status}`);
});

// ── 3. Pipeline & Approval ────────────────────────────────────────────────────
console.log('\n3. Pipeline & Approval');

await test('PATCH /api/cases/:caseId/pipeline sets stage', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/pipeline`, {
    stage: 'extracting',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'PATCH /api/cases/:caseId/pipeline');
  assert(body.pipelineStage === 'extracting', 'pipelineStage should be extracting');
});

await test('PATCH /api/cases/:caseId/pipeline rejects skipped transitions', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/pipeline`, {
    stage: 'review',
  });
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body.ok === false, 'ok should be false');
  assert(body.code === 'PIPELINE_SKIP_NOT_ALLOWED', 'expected skip-not-allowed code');
});

await test('PATCH /api/cases/:caseId/pipeline rejects backward transitions', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/pipeline`, {
    stage: 'intake',
  });
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body.ok === false, 'ok should be false');
  assert(body.code === 'PIPELINE_BACKWARD_NOT_ALLOWED', 'expected backward-not-allowed code');
});

await test('PATCH /api/cases/:caseId/pipeline rejects invalid stage', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/pipeline`, {
    stage: 'invalid_stage',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('PATCH /api/cases/:caseId/status sets status', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/status`, {
    status: 'active',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'PATCH /api/cases/:caseId/status');
});

await test('PATCH /api/cases/:caseId/workflow-status sets workflow status', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/workflow-status`, {
    workflowStatus: 'facts_incomplete',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(body?.workflowStatus === 'facts_incomplete', 'workflowStatus should be updated');
});

await test('PATCH /api/cases/:caseId/workflow-status rejects invalid workflow status', async () => {
  const { status, body } = await api('PATCH', `/api/cases/${testCaseId}/workflow-status`, {
    workflowStatus: 'not_a_real_status',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_WORKFLOW_STATUS', 'code should be INVALID_WORKFLOW_STATUS');
});

// ── 4. Facts ──────────────────────────────────────────────────────────────────
console.log('\n4. Facts');

await test('PUT /api/cases/:caseId/facts saves facts', async () => {
  const { status, body } = await api('PUT', `/api/cases/${testCaseId}/facts`, {
    subject: { address: { value: '123 Test St', confidence: 'high' } },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'PUT /api/cases/:caseId/facts');
  assert(body.facts?.subject?.address?.value === '123 Test St', 'fact should be saved');
});

await test('PUT /api/cases/:caseId/facts rejects non-object payload', async () => {
  const { status, body } = await api('PUT', `/api/cases/${testCaseId}/facts`, ['bad-payload']);
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('GET /api/cases/:caseId/record returns canonical case record', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/record`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/record');
  assert(body.record?.caseId === testCaseId, 'record.caseId should match');
  assert(typeof body.record?.evidence?.facts === 'object', 'record.evidence.facts should be object');
  assert(typeof body.record?.evidence?.factProvenance === 'object', 'record.evidence.factProvenance should be object');
});

await test('GET /api/cases/:caseId/fact-sources returns source map', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/fact-sources`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/fact-sources');
  assert(typeof body.sources === 'object', 'sources should be an object');
});

await test('PUT /api/cases/:caseId/fact-sources saves source links', async () => {
  const { status, body } = await api('PUT', `/api/cases/${testCaseId}/fact-sources`, {
    sources: {
      'subject.address': {
        sourceType: 'document',
        sourceId: 'order_sheet.pdf',
        page: '1',
        confidence: 'high',
      },
    },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'PUT /api/cases/:caseId/fact-sources');
  assert(body.sources?.['subject.address']?.sourceId === 'order_sheet.pdf', 'source link should be saved');
});

await test('POST /api/cases/:caseId/geocode rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/geocode`, {
    subjectAddress: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/cases/:caseId/missing-facts rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/missing-facts`, {
    fieldIds: 'neighborhood_description',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

// —— 4b. Document Intake & Classification ——————————————————————————————
console.log('\n4b. Document Intake');

await test('POST /api/cases/:caseId/upload rejects invalid docType payload', async () => {
  const pseudoPdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF`;
  const form = new FormData();
  form.append('file', new Blob([pseudoPdf], { type: 'application/pdf' }), 'legacy-upload-smoke.pdf');
  form.append('docType', 'x'.repeat(120));
  const { status, body } = await apiForm(`/api/cases/${testCaseId}/upload`, form);
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/cases/:caseId/documents/upload rejects unsupported file types', async () => {
  const form = new FormData();
  form.append('file', new Blob(['plain text'], { type: 'text/plain' }), 'notes.txt');
  const { status, body } = await apiForm(`/api/cases/${testCaseId}/documents/upload`, form);
  assert(status === 415, `Expected 415, got ${status}`);
  assert(body?.code === 'UNSUPPORTED_FILE_TYPE', 'expected unsupported file type code');
});

await test('POST /api/cases/:caseId/documents/upload accepts PDF upload', async () => {
  const pseudoPdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF`;
  const form = new FormData();
  form.append('file', new Blob([pseudoPdf], { type: 'application/pdf' }), 'contract-smoke.pdf');
  const { status, body } = await apiForm(`/api/cases/${testCaseId}/documents/upload`, form);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(typeof body?.documentId === 'string', 'documentId should be string');
  assert(body?.duplicateDetected === false, 'first upload should not be duplicate');
  assert(typeof body?.ingestJob?.id === 'string', 'ingestJob.id should be present');
  assert(typeof body?.ingestJob?.status === 'string', 'ingestJob.status should be present');
  latestIngestJobId = body.ingestJob.id;
});

await test('POST /api/cases/:caseId/documents/upload flags duplicate PDF by hash', async () => {
  const pseudoPdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF`;
  const form = new FormData();
  form.append('file', new Blob([pseudoPdf], { type: 'application/pdf' }), 'contract-smoke-copy.pdf');
  const { status, body } = await apiForm(`/api/cases/${testCaseId}/documents/upload`, form);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(body?.duplicateDetected === true, 'second identical upload should be duplicate');
  assert(typeof body?.duplicateOfDocumentId === 'string' && body.duplicateOfDocumentId.length > 0, 'duplicate link should be present');
});

await test('POST /api/cases/:caseId/documents/upload accepts image upload', async () => {
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxscAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([tinyPng], { type: 'image/png' }), 'inspection-photo.png');
  const { status, body } = await apiForm(`/api/cases/${testCaseId}/documents/upload`, form);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(typeof body?.extractionMethod === 'string', 'extractionMethod should be string');
});

await test('GET /api/cases/:caseId/extraction-summary includes quality metrics', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/extraction-summary`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(typeof body?.quality === 'object', 'quality should be object');
  assert(typeof body.quality?.averageScore === 'number' || body.quality?.averageScore === null, 'averageScore should be number|null');
  assert(typeof body.quality?.buckets === 'object', 'buckets should be object');
  assert(typeof body.quality?.duplicateCount === 'number', 'duplicateCount should be number');
  assert(typeof body.quality?.warningCount === 'number', 'warningCount should be number');
  assert(Array.isArray(body.quality?.flaggedDocuments), 'flaggedDocuments should be an array');
  assert(body.quality.duplicateCount >= 1, 'duplicateCount should reflect duplicate upload');
});

// ── 5. Feedback & KB ──────────────────────────────────────────────────────────
await test('GET /api/cases/:caseId/ingest-jobs lists ingestion job history', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/ingest-jobs`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(Array.isArray(body?.jobs), 'jobs should be array');
  assert(body.jobs.length >= 1, 'at least one ingest job should exist');
  assert(typeof body.jobs[0]?.status === 'string', 'job status should be string');
});

await test('GET /api/cases/:caseId/ingest-jobs/:jobId returns ingest job details', async () => {
  assert(typeof latestIngestJobId === 'string' && latestIngestJobId.length > 0, 'expected ingest job id from upload');
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/ingest-jobs/${latestIngestJobId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(body?.job?.id === latestIngestJobId, 'job id should match');
  assert(typeof body?.job?.steps === 'object', 'job.steps should be object');
});

await test('POST /api/cases/:caseId/ingest-jobs/:jobId/retry rejects non-failed step retry', async () => {
  assert(typeof latestIngestJobId === 'string' && latestIngestJobId.length > 0, 'expected ingest job id from upload');
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/ingest-jobs/${latestIngestJobId}/retry`, {
    step: 'extract',
  });
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INGEST_STEP_NOT_FAILED', 'code should be INGEST_STEP_NOT_FAILED');
});

await test('POST /api/cases/:caseId/ingest-jobs/:jobId/retry rejects invalid payload type', async () => {
  assert(typeof latestIngestJobId === 'string' && latestIngestJobId.length > 0, 'expected ingest job id from upload');
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/ingest-jobs/${latestIngestJobId}/retry`, {
    step: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/cases/:caseId/ingest-jobs/:jobId/retry returns coded 404 for unknown job', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/ingest-jobs/ingest_missing/retry`, {
    step: 'extract',
  });
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INGEST_JOB_NOT_FOUND', 'code should be INGEST_JOB_NOT_FOUND');
});
console.log('\n5. Feedback & KB');

await test('GET /api/cases/:caseId/fact-conflicts returns conflict summary', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/fact-conflicts`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/fact-conflicts');
  assert(typeof body.summary === 'object', 'summary should be an object');
  assert(Array.isArray(body.conflicts), 'conflicts should be an array');
});

await test('GET /api/cases/:caseId/fact-review-queue returns decision queue', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/fact-review-queue`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/fact-review-queue');
  assert(typeof body.queue === 'object', 'queue should be an object');
  assert(typeof body.queue.summary === 'object', 'queue.summary should be an object');
  assert(Array.isArray(body.queue.pendingFactGroups), 'queue.pendingFactGroups should be an array');
});

await test('POST /api/cases/:caseId/fact-review-queue/resolve accepts manual decision', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/fact-review-queue/resolve`, {
    factPath: 'subject.address',
    selectedValue: '123 Test St',
    sourceType: 'manual',
    note: 'Smoke test manual confirmation',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/cases/:caseId/fact-review-queue/resolve');
  assert(body.result?.factPath === 'subject.address', 'result.factPath should match request');
  assert(body.result?.sourceType === 'manual', 'sourceType should be manual');
});

await test('POST /api/cases/:caseId/fact-review-queue/resolve rejects missing selectedValue', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/fact-review-queue/resolve`, {
    factPath: 'subject.address',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
});

await test('POST /api/cases/:caseId/extracted-facts/review rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/extracted-facts/review`, {
    factId: 123,
    action: 'accepted',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/cases/:caseId/extracted-facts/merge rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/extracted-facts/merge`, {
    factIds: 'not-an-array',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('GET /api/cases/:caseId/pre-draft-check returns gate details', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/pre-draft-check`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/pre-draft-check');
  assert(typeof body.gate === 'object', 'gate should be an object');
  assert(typeof body.gate.ok === 'boolean', 'gate.ok should be boolean');
  assert(Array.isArray(body.gate.blockers), 'gate.blockers should be an array');
  assert(typeof body.factReviewQueuePath === 'string', 'factReviewQueuePath should be a string');
  assert(typeof body.decisionQueueSummary === 'object', 'decisionQueueSummary should be an object');
});

await test('GET /api/cases/:caseId/intelligence/requirements returns deterministic section matrix', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/intelligence/requirements`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/intelligence/requirements');
  assert(typeof body.sectionRequirements === 'object', 'sectionRequirements should be an object');
  assert(Array.isArray(body.sectionRequirements.sections), 'sectionRequirements.sections should be an array');
  assert(Array.isArray(body.sectionRequirements.requiredSectionIds), 'requiredSectionIds should be an array');
});

await test('GET /api/cases/:caseId/intelligence/compliance-check returns deterministic findings', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/intelligence/compliance-check`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/intelligence/compliance-check');
  assert(typeof body.complianceChecks === 'object', 'complianceChecks should be an object');
  assert(Array.isArray(body.complianceChecks.checks), 'complianceChecks.checks should be an array');
  assert(typeof body.complianceChecks.summary === 'object', 'complianceChecks.summary should be an object');
});

await test('GET /api/intelligence/benchmarks/phase-c returns benchmark snapshot', async () => {
  const { status, body } = await api('GET', '/api/intelligence/benchmarks/phase-c');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/intelligence/benchmarks/phase-c');
  assert(typeof body.cached === 'boolean', 'cached should be boolean');
  assert(typeof body.results === 'object', 'results should be an object');
  assert(typeof body.results.summary === 'object', 'results.summary should be an object');
  assert(typeof body.qualityGate === 'object', 'qualityGate should be an object');
  assert(typeof body.qualityGate.ok === 'boolean', 'qualityGate.ok should be boolean');
  assert(typeof body.qualityGateSummary === 'object', 'qualityGateSummary should be an object');
  assert(Array.isArray(body.qualityGateFailures), 'qualityGateFailures should be an array');
  assert(body.thresholdSource === 'default', 'thresholdSource should be default');
});

await test('POST /api/intelligence/benchmarks/phase-c/run executes benchmark run', async () => {
  const { status, body } = await api('POST', '/api/intelligence/benchmarks/phase-c/run?persist=false', {});
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/intelligence/benchmarks/phase-c/run');
  assert(body.persisted === false, 'persisted should be false when persist=false');
  assert(typeof body.results?.summary?.extraction === 'object', 'extraction summary should be present');
  assert(typeof body.results?.summary?.gate === 'object', 'gate summary should be present');
  assert(typeof body.qualityGate === 'object', 'qualityGate should be an object');
  assert(typeof body.qualityGateSummary === 'object', 'qualityGateSummary should be an object');
  assert(Array.isArray(body.qualityGateFailures), 'qualityGateFailures should be an array');
  assert(body.thresholdSource === 'default', 'thresholdSource should be default');
});

await test('POST /api/intelligence/benchmarks/phase-c/run accepts threshold overrides', async () => {
  const { status, body } = await api('POST', '/api/intelligence/benchmarks/phase-c/run?persist=false', {
    thresholds: {
      extraction: { minFixtureCount: 1 },
      gate: { minFixtureCount: 1 },
    },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/intelligence/benchmarks/phase-c/run threshold overrides');
  assert(body.thresholdSource === 'request', 'thresholdSource should be request');
  assert(typeof body.qualityGate?.ok === 'boolean', 'qualityGate.ok should be boolean');
});

await test('POST /api/intelligence/benchmarks/phase-c/run rejects invalid threshold payload type', async () => {
  const { status, body } = await api('POST', '/api/intelligence/benchmarks/phase-c/run?persist=false', {
    thresholds: 'invalid-thresholds',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/cases/:caseId/generate-full-draft blocks on pre-draft gate', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/generate-full-draft`, {});
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body.ok === false, 'ok should be false');
  assert(body.code === 'PRE_DRAFT_GATE_BLOCKED', 'should return pre-draft gate code');
  assert(typeof body.factReviewQueuePath === 'string', 'factReviewQueuePath should be returned when gate blocks');
  assert(typeof body.factReviewQueueSummary === 'object', 'factReviewQueueSummary should be returned when gate blocks');
});

await test('POST /api/cases/:caseId/generate-full-draft rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/generate-full-draft`, {
    options: { forceGateBypass: 'yes' },
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/generation/full-draft rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/generation/full-draft', {
    caseId: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/generation/regenerate-section rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/generation/regenerate-section', {
    runId: 123,
    sectionId: 'neighborhood_description',
    caseId: testCaseId,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/similar-examples rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/similar-examples', {
    limit: { bad: true },
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/cases/:caseId/feedback saves feedback', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/feedback`, {
    fieldId: 'neighborhood_description',
    fieldTitle: 'Neighborhood Description',
    originalText: 'Original text here.',
    editedText: 'Edited and improved text here for smoke test.',
    rating: 'up',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/cases/:caseId/feedback');
  assert(typeof body.count === 'number', 'count should be a number');
  assert(body.savedToKB === true, 'savedToKB should be true for rating=up');
});

await test('POST /api/cases/:caseId/feedback rejects missing fieldId', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/feedback`, {
    editedText: 'Some text',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('GET /api/kb/status returns KB counts', async () => {
  const { status, body } = await api('GET', '/api/kb/status');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/kb/status');
  assert(typeof body.counts === 'object', 'counts should be an object');
  assert(typeof body.totalExamples === 'number', 'totalExamples should be a number');
});

await test('POST /api/kb/reindex runs without error', async () => {
  const { status, body } = await api('POST', '/api/kb/reindex');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/kb/reindex');
  assert(typeof body.total === 'number', 'total should be a number');
});

await test('POST /api/kb/reindex rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/kb/reindex', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/kb/migrate-voice rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/kb/migrate-voice', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/kb/ingest-to-pinecone rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/kb/ingest-to-pinecone', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/db/migrate-legacy-kb rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/db/migrate-legacy-kb', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

// ── 6. History & Templates ────────────────────────────────────────────────────
console.log('\n6. History & Templates');

await test('GET /api/cases/:caseId/history returns history', async () => {
  const { status, body } = await api('GET', `/api/cases/${testCaseId}/history`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/:caseId/history');
  assert(typeof body.history === 'object', 'history should be an object');
});

await test('GET /api/templates/neighborhood returns templates', async () => {
  const { status, body } = await api('GET', '/api/templates/neighborhood');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/templates/neighborhood');
  assert(Array.isArray(body.templates), 'templates should be an array');
});

await test('POST /api/templates/neighborhood rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/templates/neighborhood', {
    name: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/export/bundle rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/export/bundle', {
    includeAllLogs: 'yes',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

// ── 6b. Canonical Migration ───────────────────────────────────────────────────
console.log('\n6b. Canonical Migration');

await test('GET /api/cases/migration/status returns backfill status', async () => {
  const { status, body } = await api('GET', '/api/cases/migration/status?integrity=1&integrityLimit=25');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/cases/migration/status');
  assert(typeof body.filesystemCaseCount === 'number', 'filesystemCaseCount should be number');
  assert(typeof body.canonicalCaseCount === 'number', 'canonicalCaseCount should be number');
  assert(typeof body.missingCanonicalCount === 'number', 'missingCanonicalCount should be number');
  assert(Array.isArray(body.missingCanonicalCaseIds), 'missingCanonicalCaseIds should be array');
});

await test('POST /api/cases/migration/backfill supports targeted idempotent backfill', async () => {
  const { status, body } = await api('POST', '/api/cases/migration/backfill', {
    caseIds: [testCaseId],
    verifyAfterWrite: true,
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/cases/migration/backfill');
  assert(body.totalProcessed === 1, `Expected totalProcessed=1, got ${body.totalProcessed}`);
  assert(body.failed === 0, 'failed should be 0');
  assert(Array.isArray(body.results) && body.results.length === 1, 'results should contain one entry');
});

// ── 7. Agent Status ───────────────────────────────────────────────────────────
console.log('\n7. Agent Status');

await test('GET /api/agents/status returns agent health', async () => {
  const { status, body } = await api('GET', '/api/agents/status');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/agents/status');
  assert(typeof body.aci === 'boolean', 'aci should be boolean');
  assert(typeof body.rq === 'boolean', 'rq should be boolean');
});

await test('POST /api/insert-aci rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/insert-aci', {
    fieldId: 123,
    text: 'Smoke text',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/insert-rq rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/insert-rq', {
    fieldId: 'market_analysis',
    text: false,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

// -- 7b. Insertion Gate --------------------------------------------------------
console.log('\n7b. Insertion Gate');

await test('POST /api/insertion/prepare validates required params', async () => {
  const { status, body } = await api('POST', '/api/insertion/prepare', {});
  assert(status === 400, `Expected 400, got ${status}`);
  assert(typeof body?.error === 'string', 'error should be a string');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/insertion/prepare rejects invalid config shape', async () => {
  const { status, body } = await api('POST', '/api/insertion/prepare', {
    caseId: testCaseId,
    formType: '1004',
    config: { maxRetries: 'not-a-number' },
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(Array.isArray(body?.issues), 'issues should be an array');
});

await test('POST /api/insertion/prepare blocks generation insertion when fresh QC is missing', async () => {
  const { status, body } = await api('POST', '/api/insertion/prepare', {
    caseId: testCaseId,
    formType: '1004',
    generationRunId: `smoke-gen-${Date.now()}`,
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(typeof body?.run?.id === 'string', 'run.id should be present');
  assert(Array.isArray(body?.items), 'items should be an array');
  assert(typeof body?.qcGate === 'object', 'qcGate should be an object');
  assert(body.qcGate.passed === false, 'qcGate should fail when fresh QC is missing');
  assert(body.qcGate.recommendation === 'blocked', 'recommendation should be blocked');
  assert(body.qcGate.reason === 'missing_fresh_generation_qc', 'reason should indicate missing fresh QC');
});

await test('POST /api/insertion/run does not bypass missing fresh QC with skipQcBlockers', async () => {
  const { status, body } = await api('POST', '/api/insertion/run', {
    caseId: testCaseId,
    formType: '1004',
    generationRunId: `smoke-gen-${Date.now()}-run`,
    config: { skipQcBlockers: true, dryRun: true },
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.blocked === true, 'blocked should be true');
  assert(body?.overrideAllowed === false, 'overrideAllowed should be false');
  assert(body?.qcGate?.reason === 'missing_fresh_generation_qc', 'qcGate.reason should match');
});

await test('POST /api/insertion/execute/:runId rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/insertion/execute/irun_missing', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/insertion/execute/:runId returns coded 404 for unknown run', async () => {
  const { status, body } = await api('POST', '/api/insertion/execute/irun_missing');
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INSERTION_RUN_NOT_FOUND', 'code should be INSERTION_RUN_NOT_FOUND');
});

await test('POST /api/insertion/retry/:itemId rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/insertion/retry/iitem_missing', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/insertion/retry/:itemId returns coded 404 for unknown item', async () => {
  const { status, body } = await api('POST', '/api/insertion/retry/iitem_missing');
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INSERTION_ITEM_NOT_FOUND', 'code should be INSERTION_ITEM_NOT_FOUND');
});

await test('POST /api/insertion/run/:runId/cancel rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/insertion/run/irun_missing/cancel', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('PUT /api/insertion/profile/:id rejects invalid payload type', async () => {
  const { status, body } = await api('PUT', '/api/insertion/profile/iprofile_missing', {
    active: 'yes',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/cases/:caseId/sections/:fieldId/insert blocks when QC run is missing', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/sections/neighborhood_description/insert`, {
    text: 'Smoke section insert payload',
  });
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'QC_GATE_BLOCKED', 'code should be QC_GATE_BLOCKED');
  assert(body?.qcGate?.reason === 'missing_qc_run', 'qcGate reason should indicate missing QC run');
});

await test('POST /api/cases/:caseId/sections/:fieldId/insert rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/sections/neighborhood_description/insert`, {
    skipQcBlockers: 'true',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/cases/:caseId/sections/:fieldId/copy saves explicit text payload', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/sections/neighborhood_description/copy`, {
    text: 'Smoke copy payload text',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/cases/:caseId/sections/:fieldId/copy');
  assert(body?.fieldId === 'neighborhood_description', 'fieldId should match route parameter');
  assert(body?.text === 'Smoke copy payload text', 'text should echo payload');
  assert(body?.status === 'copied', 'status should be copied');
});

await test('POST /api/cases/:caseId/sections/:fieldId/copy rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/sections/neighborhood_description/copy`, {
    text: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/cases/:caseId/insert-all blocks approved insertion when QC run is missing', async () => {
  const fieldId = 'neighborhood_description';

  const patch = await api('PATCH', `/api/cases/${testCaseId}/outputs/${fieldId}`, {
    text: 'Approved smoke narrative for insert-all QC gate check.',
  });
  assert(patch.status === 200, `Expected 200, got ${patch.status}`);
  assertOk(patch.body, 'PATCH /api/cases/:caseId/outputs/:fieldId');

  const approve = await api('PATCH', `/api/cases/${testCaseId}/sections/${fieldId}/status`, {
    status: 'approved',
  });
  assert(approve.status === 200, `Expected 200, got ${approve.status}`);
  assertOk(approve.body, 'PATCH /api/cases/:caseId/sections/:fieldId/status');

  const { status, body } = await api('POST', `/api/cases/${testCaseId}/insert-all`, {});
  assert(status === 409, `Expected 409, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'QC_GATE_BLOCKED', 'code should be QC_GATE_BLOCKED');
  assert(typeof body?.qcGate === 'object', 'qcGate should be an object');
  assert(body?.qcGate?.reason === 'missing_qc_run', 'qcGate reason should indicate missing QC run');
});

await test('POST /api/cases/:caseId/insert-all rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/insert-all`, {
    skipQcBlockers: 'true',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

// -- 7c. QC API ---------------------------------------------------------------
console.log('\n7c. QC API');

await test('POST /api/qc/run rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/qc/run', {
    caseId: 12345,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/qc/findings/:findingId/dismiss rejects invalid note payload type', async () => {
  const { status, body } = await api('POST', '/api/qc/findings/smoke-finding-id/dismiss', {
    note: 123,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/qc/findings/:findingId/resolve rejects invalid note payload type', async () => {
  const { status, body } = await api('POST', '/api/qc/findings/smoke-finding-id/resolve', {
    note: false,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/qc/findings/:findingId/reopen rejects invalid note payload type', async () => {
  const { status, body } = await api('POST', '/api/qc/findings/smoke-finding-id/reopen', {
    note: { bad: 'payload' },
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

console.log('\n8. AI Endpoints (error handling)');

await test('POST /api/generate without fieldId or prompt returns 400', async () => {
  const { status, body } = await api('POST', '/api/generate', {});
  // Either 400 (missing params) or 503 (no API key) — both are correct
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/generate-batch with empty fields returns 400', async () => {
  const { status, body } = await api('POST', '/api/generate-batch', { fields: [] });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/cases/:caseId/review-section without draftText returns 400', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/review-section`, {
    fieldId: 'neighborhood_description',
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/cases/:caseId/insert-all enforces insertion preconditions', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/insert-all`);
  assert(status === 400 || status === 409, `Expected 400 or 409, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

console.log('\n9. Workflow Endpoints');

await test('GET /api/workflow/health returns workflow health', async () => {
  const { status, body } = await api('GET', '/api/workflow/health');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/workflow/health');
  assert(body.status === 'healthy', 'status should be healthy');
  assert(typeof body.totalCases === 'number', 'totalCases should be a number');
});

await test('POST /api/workflow/run without caseId returns 400 or 503', async () => {
  const { status, body } = await api('POST', '/api/workflow/run', {});
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/cases/:caseId/generate-core rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/generate-core`, {
    fields: 'neighborhood_description',
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/cases/:caseId/generate-comp-commentary rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/generate-comp-commentary`, {
    compFocus: true,
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/cases/:caseId/generate-all rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/generate-all`, {
    forceGateBypass: 'yes',
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/cases/:caseId/extract-facts rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/extract-facts`, {
    answers: 'not-an-object',
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/cases/:caseId/questionnaire rejects invalid payload type', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/questionnaire`, {
    includeHints: true,
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/workflow/run rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/workflow/run', {
    caseId: 12345,
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/workflow/run-batch with empty cases returns 400 or 503', async () => {
  const { status, body } = await api('POST', '/api/workflow/run-batch', { cases: [] });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/workflow/run-batch rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/workflow/run-batch', { cases: 'not-array' });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

await test('POST /api/workflow/ingest-pdf without file returns 400 or 503', async () => {
  const { status, body } = await api('POST', '/api/workflow/ingest-pdf', {});
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

// ── 10. Queue Endpoints ───────────────────────────────────────────────────────
console.log('\n10. Queue Endpoints');

await test('POST /api/reports/queue rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/reports/queue', {
    cases: 'not-an-array',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/reports/queue/cancel rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/reports/queue/cancel', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/reports/queue/clear rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/reports/queue/clear', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/reports/queue enqueues jobs', async () => {
  const { status, body } = await api('POST', '/api/reports/queue', {
    cases: [{ caseId: testCaseId, formType: '1004' }],
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(typeof body?.batchId === 'string' && body.batchId.length > 10, 'batchId should be present');
  assert(Array.isArray(body?.jobs) && body.jobs.length === 1, 'jobs should contain one entry');
  assert(typeof body.jobs[0]?.jobId === 'string', 'jobId should be present');
  smokeQueueBatchId = body.batchId;
  smokeQueueJobId = body.jobs[0].jobId;
});

await test('GET /api/reports/queue/batch/:batchId returns batch status', async () => {
  const { status, body } = await api('GET', `/api/reports/queue/batch/${smokeQueueBatchId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body?.jobs), 'jobs should be an array');
  assert(body?.jobs?.length >= 1, 'batch should include at least one job');
});

await test('GET /api/reports/queue/job/:jobId returns job status', async () => {
  const { status, body } = await api('GET', `/api/reports/queue/job/${smokeQueueJobId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(typeof body?.jobId === 'string', 'jobId should be present');
  assert(typeof body?.status === 'string', 'job status should be a string');
});

// ── 11. Operations Endpoints ──────────────────────────────────────────────────
console.log('\n11. Operations Endpoints');

await test('POST /api/operations/metrics/daily rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/operations/metrics/daily', {
    date: 20260311,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  assert(typeof body?.error === 'string', 'error should be a string');
});

await test('POST /api/operations/metrics/daily computes daily summary', async () => {
  const { status, body } = await api('POST', '/api/operations/metrics/daily', {
    date: '2026-03-11',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body?.ok === true, 'ok should be true');
  assert(typeof body?.summary === 'object', 'summary should be an object');
  assert(body?.summary?.date === '2026-03-11', 'summary.date should match payload date');
});

await test('POST /api/operations/metrics/compute rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/operations/metrics/compute', {
    force: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/operations/archive/:caseId rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', `/api/operations/archive/${testCaseId}`, {
    reason: 'test',
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

await test('POST /api/operations/archive/:caseId archives and restore unarchives', async () => {
  const archived = await api('POST', `/api/operations/archive/${testCaseId}`, {});
  assert(archived.status === 200, `Expected 200, got ${archived.status}`);
  assert(archived.body?.success === true, 'archive success should be true');

  const restored = await api('POST', `/api/operations/restore/${testCaseId}`, {});
  assert(restored.status === 200, `Expected 200, got ${restored.status}`);
  assert(restored.body?.success === true, 'restore success should be true');
});

await test('POST /api/operations/cleanup rejects unexpected payload fields', async () => {
  const { status, body } = await api('POST', '/api/operations/cleanup', {
    purge: true,
  });
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
});

// ── 12. Voice Examples ────────────────────────────────────────────────────────
console.log('\n12. Voice Examples');

await test('GET /api/voice/examples returns voice data', async () => {
  const { status, body } = await api('GET', '/api/voice/examples');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/voice/examples');
  assert(typeof body.total === 'number', 'total should be a number');
  assert(Array.isArray(body.imports), 'imports should be an array');
});

await test('GET /api/voice/folder-status returns folder info', async () => {
  const { status, body } = await api('GET', '/api/voice/folder-status?formType=1004');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/voice/folder-status');
  assert(typeof body.folderExists === 'boolean', 'folderExists should be boolean');
});

await test('POST /api/voice/import-folder rejects invalid payload type', async () => {
  const { status, body } = await api('POST', '/api/voice/import-folder', {
    formType: 1004,
  });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body?.ok === false, 'ok should be false');
  if (status === 400) {
    assert(body?.code === 'INVALID_PAYLOAD', 'code should be INVALID_PAYLOAD');
  }
});

// ── 13. Cleanup ───────────────────────────────────────────────────────────────
console.log('\n13. Cleanup');

await test('DELETE /api/cases/:caseId removes test case', async () => {
  const { status, body } = await api('DELETE', `/api/cases/${testCaseId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'DELETE /api/cases/:caseId');
});

await test('GET /api/cases/:caseId after delete returns 404', async () => {
  const { status } = await api('GET', `/api/cases/${testCaseId}`);
  assert(status === 404, `Expected 404, got ${status}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  failures.forEach(f => console.log(`    ✗ ${f.name}: ${f.error}`));
}
console.log('══════════════════════════════════════════\n');

await serverHarness.stop();
cleanupSmokeArtifacts();
process.exit(failed > 0 ? 1 : 0);




