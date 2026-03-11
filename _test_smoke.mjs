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

const REQUESTED_BASE = process.env.TEST_BASE_URL || 'http://localhost:5178';
const AUTO_START = process.env.SMOKE_AUTO_START !== '0';
const serverHarness = await ensureServerRunning({
  baseUrl: REQUESTED_BASE,
  autoStart: AUTO_START,
  cwd: process.cwd(),
});
const BASE = serverHarness.baseUrl;
const TIMEOUT_MS = 8000;

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

// ── Test state ────────────────────────────────────────────────────────────────
let testCaseId = null;

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

// ── 5. Feedback & KB ──────────────────────────────────────────────────────────
console.log('\n5. Feedback & KB');

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

// ── 7. Agent Status ───────────────────────────────────────────────────────────
console.log('\n7. Agent Status');

await test('GET /api/agents/status returns agent health', async () => {
  const { status, body } = await api('GET', '/api/agents/status');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'GET /api/agents/status');
  assert(typeof body.aci === 'boolean', 'aci should be boolean');
  assert(typeof body.rq === 'boolean', 'rq should be boolean');
});

// ── 8. AI Endpoints (error handling when no key) ──────────────────────────────
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

await test('POST /api/cases/:caseId/insert-all with no approved sections returns 400', async () => {
  const { status, body } = await api('POST', `/api/cases/${testCaseId}/insert-all`);
  assert(status === 400, `Expected 400, got ${status}`);
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

await test('POST /api/workflow/run-batch with empty cases returns 400 or 503', async () => {
  const { status, body } = await api('POST', '/api/workflow/run-batch', { cases: [] });
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('POST /api/workflow/ingest-pdf without file returns 400 or 503', async () => {
  const { status, body } = await api('POST', '/api/workflow/ingest-pdf', {});
  assert(status === 400 || status === 503, `Expected 400 or 503, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

// ── 9. Voice Examples ─────────────────────────────────────────────────────────
console.log('\n10. Voice Examples');

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

// ── 10. Cleanup ───────────────────────────────────────────────────────────────
console.log('\n11. Cleanup');

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
process.exit(failed > 0 ? 1 : 0);
