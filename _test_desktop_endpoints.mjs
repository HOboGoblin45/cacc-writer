/**
 * _test_desktop_endpoints.mjs
 * ----------------------------
 * Test suite for the 8 Desktop Production Phase endpoints.
 *
 * Endpoints covered:
 *   GET  /api/health/services
 *   GET  /api/destination-registry
 *   GET  /api/destination-registry/:formType/:sectionId
 *   GET  /api/logs
 *   GET  /api/logs/:date
 *   GET  /api/export/stats
 *   POST /api/export/bundle
 *   GET  /api/export/list
 *
 * Run:
 *   node _test_desktop_endpoints.mjs
 *
 * Prerequisites:
 *   - Server must be running: node cacc-writer-server.js
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CASES_DIR  = path.join(__dirname, 'cases');

const BASE       = process.env.TEST_BASE_URL || 'http://localhost:5178';
const TIMEOUT_MS = 35000; // bundle creation via PowerShell Compress-Archive can take 15-20s

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
  assert(body.ok === true, `${label}: ok !== true (got: ${JSON.stringify(body).slice(0, 300)})`);
}

async function api(method, path, body) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${BASE}${path}`, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['healthy', 'degraded', 'offline', 'checking']);

function assertServiceChip(svc, name) {
  assert(svc && typeof svc === 'object',          `${name}: service entry missing`);
  assert(VALID_STATUSES.has(svc.status),          `${name}: status "${svc.status}" not in valid set`);
}

// ── Banner ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  CACC Writer — Desktop Production Endpoint Tests');
console.log(`  Target: ${BASE}`);
console.log('══════════════════════════════════════════════════════\n');

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/health/services
// ══════════════════════════════════════════════════════════════════════════════
console.log('1. GET /api/health/services');

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('GET', '/api/health/services');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/health/services');
});

await test('services object contains all 5 chips', async () => {
  const { body } = await api('GET', '/api/health/services');
  const s = body.services;
  assert(s && typeof s === 'object',   'services should be an object');
  assert('server'             in s,    'services.server missing');
  assert('aciAgent'           in s,    'services.aciAgent missing');
  assert('rqAgent'            in s,    'services.rqAgent missing');
  assert('knowledgeBase'      in s,    'services.knowledgeBase missing');
  assert('approvedNarratives' in s,    'services.approvedNarratives missing');
});

await test('each service chip has a valid status field', async () => {
  const { body } = await api('GET', '/api/health/services');
  const s = body.services;
  assertServiceChip(s.server,             'server');
  assertServiceChip(s.aciAgent,           'aciAgent');
  assertServiceChip(s.rqAgent,            'rqAgent');
  assertServiceChip(s.knowledgeBase,      'knowledgeBase');
  assertServiceChip(s.approvedNarratives, 'approvedNarratives');
});

await test('server chip is always healthy (server is running)', async () => {
  const { body } = await api('GET', '/api/health/services');
  assert(body.services.server.status === 'healthy', 'server chip should be healthy');
});

await test('checkedAt is an ISO timestamp string', async () => {
  const { body } = await api('GET', '/api/health/services');
  assert(typeof body.checkedAt === 'string',          'checkedAt should be a string');
  assert(!isNaN(Date.parse(body.checkedAt)),           'checkedAt should be a valid ISO date');
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/destination-registry
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n2. GET /api/destination-registry');

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('GET', '/api/destination-registry');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/destination-registry');
});

await test('entries is an array and count matches', async () => {
  const { body } = await api('GET', '/api/destination-registry');
  assert(Array.isArray(body.entries),                  'entries should be an array');
  assert(typeof body.count === 'number',               'count should be a number');
  assert(body.count === body.entries.length,           'count should equal entries.length');
});

await test('default response excludes deferred entries (includeDeferred:false)', async () => {
  const { body } = await api('GET', '/api/destination-registry');
  assert(body.includeDeferred === false,               'includeDeferred should be false by default');
  // All returned entries should be for active form types only
  const deferredForms = new Set(['1025', '1073', '1004c']);
  const hasDeferredEntry = body.entries.some(e => deferredForms.has(e.formType));
  assert(!hasDeferredEntry, 'default response should not include deferred form entries');
});

await test('?includeDeferred=true returns more or equal entries', async () => {
  const { body: active }   = await api('GET', '/api/destination-registry');
  const { body: withDeferred } = await api('GET', '/api/destination-registry?includeDeferred=true');
  assert(withDeferred.ok === true,                     'includeDeferred=true should return ok:true');
  assert(withDeferred.count >= active.count,           'includeDeferred=true should return >= entries');
  assert(withDeferred.includeDeferred === true,        'includeDeferred should be true');
});

await test('active entries include 1004 and commercial form types', async () => {
  const { body } = await api('GET', '/api/destination-registry');
  const formTypes = new Set(body.entries.map(e => e.formType));
  assert(formTypes.has('1004'),       'entries should include 1004 form type');
  assert(formTypes.has('commercial'), 'entries should include commercial form type');
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/destination-registry/:formType/:sectionId
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n3. GET /api/destination-registry/:formType/:sectionId');

await test('1004/neighborhood_description returns entry', async () => {
  const { status, body } = await api('GET', '/api/destination-registry/1004/neighborhood_description');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '1004/neighborhood_description');
  assert(body.entry && typeof body.entry === 'object', 'entry should be an object');
});

await test('1004/neighborhood_description entry has correct formType and sectionId', async () => {
  const { body } = await api('GET', '/api/destination-registry/1004/neighborhood_description');
  assert(body.entry.formType  === '1004',                    'entry.formType should be 1004');
  assert(body.entry.sectionId === 'neighborhood_description', 'entry.sectionId should match');
});

await test('commercial/neighborhood returns entry', async () => {
  const { status, body } = await api('GET', '/api/destination-registry/commercial/neighborhood');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'commercial/neighborhood');
  assert(body.entry.formType === 'commercial', 'entry.formType should be commercial');
});

await test('unknown formType/sectionId returns 404', async () => {
  const { status, body } = await api('GET', '/api/destination-registry/9999/nonexistent_section');
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body.ok === false, 'ok should be false for 404');
});

await test('deferred form entry returns 404 without includeDeferred', async () => {
  const { status } = await api('GET', '/api/destination-registry/1025/neighborhood_description');
  // Deferred entries are excluded by default — should 404
  assert(status === 404, `Expected 404 for deferred form without includeDeferred, got ${status}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/logs
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n4. GET /api/logs');

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('GET', '/api/logs');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/logs');
});

await test('files is an array and count matches', async () => {
  const { body } = await api('GET', '/api/logs');
  assert(Array.isArray(body.files),              'files should be an array');
  assert(typeof body.count === 'number',         'count should be a number');
  assert(body.count === body.files.length,       'count should equal files.length');
});

await test('logsDir is a non-empty string', async () => {
  const { body } = await api('GET', '/api/logs');
  assert(typeof body.logsDir === 'string',       'logsDir should be a string');
  assert(body.logsDir.length > 0,                'logsDir should not be empty');
});

await test('each log file entry has name, path, sizeBytes, date fields', async () => {
  const { body } = await api('GET', '/api/logs');
  for (const f of body.files) {
    assert(typeof f.name      === 'string',  `file.name should be string (got ${typeof f.name})`);
    assert(typeof f.path      === 'string',  `file.path should be string`);
    assert(typeof f.sizeBytes === 'number',  `file.sizeBytes should be number`);
    assert(typeof f.date      === 'string',  `file.date should be string`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/logs/:date
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n5. GET /api/logs/:date');

await test('valid date format returns 200 with entries shape', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { status, body } = await api('GET', `/api/logs/${today}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, `/api/logs/${today}`);
  assert(body.date === today,                    'date should match requested date');
  assert(Array.isArray(body.entries),            'entries should be an array');
  assert(typeof body.total    === 'number',      'total should be a number');
  assert(typeof body.returned === 'number',      'returned should be a number');
  assert(body.returned <= body.total,            'returned should be <= total');
});

await test('invalid date format returns 400', async () => {
  const { status, body } = await api('GET', '/api/logs/not-a-date');
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('date with wrong format (MM-DD-YYYY) returns 400', async () => {
  const { status, body } = await api('GET', '/api/logs/03-15-2025');
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('valid date with no log file returns ok with empty entries', async () => {
  // Use a date far in the past — no log file will exist
  const { status, body } = await api('GET', '/api/logs/2000-01-01');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/logs/2000-01-01');
  assert(Array.isArray(body.entries),            'entries should be an array');
  assert(body.total === 0,                       'total should be 0 for missing log file');
});

await test('?limit param is respected', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { body } = await api('GET', `/api/logs/${today}?limit=5`);
  assert(body.returned <= 5, `returned (${body.returned}) should be <= limit 5`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/export/stats
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n6. GET /api/export/stats');

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('GET', '/api/export/stats');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/export/stats');
});

await test('contains all required stat fields', async () => {
  const { body } = await api('GET', '/api/export/stats');
  assert('appVersion'         in body, 'appVersion field missing');
  assert('cases'              in body, 'cases field missing');
  assert('approvedNarratives' in body, 'approvedNarratives field missing');
  assert('approvedEdits'      in body, 'approvedEdits field missing');
  assert('logFiles'           in body, 'logFiles field missing');
  assert('exportDir'          in body, 'exportDir field missing');
});

await test('numeric stat fields are numbers >= 0', async () => {
  const { body } = await api('GET', '/api/export/stats');
  assert(typeof body.cases              === 'number' && body.cases              >= 0, 'cases should be number >= 0');
  assert(typeof body.approvedNarratives === 'number' && body.approvedNarratives >= 0, 'approvedNarratives should be number >= 0');
  assert(typeof body.approvedEdits      === 'number' && body.approvedEdits      >= 0, 'approvedEdits should be number >= 0');
  assert(typeof body.logFiles           === 'number' && body.logFiles           >= 0, 'logFiles should be number >= 0');
});

await test('appVersion is a non-empty string', async () => {
  const { body } = await api('GET', '/api/export/stats');
  assert(typeof body.appVersion === 'string' && body.appVersion.length > 0, 'appVersion should be non-empty string');
});

await test('exportDir is a non-empty string', async () => {
  const { body } = await api('GET', '/api/export/stats');
  assert(typeof body.exportDir === 'string' && body.exportDir.length > 0, 'exportDir should be non-empty string');
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. POST /api/export/bundle
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n7. POST /api/export/bundle');

let bundlePath = null;

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('POST', '/api/export/bundle', { zip: true, includeAllLogs: false });
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, 'POST /api/export/bundle');
});

await test('response contains bundlePath, isZip, manifest', async () => {
  const { body } = await api('POST', '/api/export/bundle', { zip: true, includeAllLogs: false });
  assert(typeof body.bundlePath === 'string' && body.bundlePath.length > 0, 'bundlePath should be non-empty string');
  assert(typeof body.isZip      === 'boolean',                               'isZip should be boolean');
  assert(body.manifest && typeof body.manifest === 'object',                 'manifest should be an object');
  bundlePath = body.bundlePath;
  console.log(`    → Bundle created: ${bundlePath}`);
});

await test('isZip is true when zip:true is requested', async () => {
  const { body } = await api('POST', '/api/export/bundle', { zip: true });
  assert(body.isZip === true, 'isZip should be true when zip:true requested');
});

await test('manifest contains expected keys', async () => {
  const { body } = await api('POST', '/api/export/bundle', { zip: false });
  const m = body.manifest;
  assert(m && typeof m === 'object',             'manifest should be an object');
  assert('createdAt' in m || 'bundleDir' in m || 'files' in m || 'appVersion' in m,
    'manifest should contain at least one of: createdAt, bundleDir, files, appVersion');
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. GET /api/export/list
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n8. GET /api/export/list');

await test('returns 200 with ok:true', async () => {
  const { status, body } = await api('GET', '/api/export/list');
  assert(status === 200, `Expected 200, got ${status}`);
  assertOk(body, '/api/export/list');
});

await test('exports is an array and count matches', async () => {
  const { body } = await api('GET', '/api/export/list');
  assert(Array.isArray(body.exports),            'exports should be an array');
  assert(typeof body.count === 'number',         'count should be a number');
  assert(body.count === body.exports.length,     'count should equal exports.length');
});

await test('after bundle creation, list contains at least 1 export', async () => {
  const { body } = await api('GET', '/api/export/list');
  assert(body.count >= 1, `Expected at least 1 export after bundle creation, got ${body.count}`);
});

await test('each export entry has name, path, sizeBytes, isZip, createdAt', async () => {
  const { body } = await api('GET', '/api/export/list');
  for (const e of body.exports) {
    assert(typeof e.name      === 'string',  `export.name should be string`);
    assert(typeof e.path      === 'string',  `export.path should be string`);
    assert(typeof e.sizeBytes === 'number',  `export.sizeBytes should be number`);
    assert(typeof e.isZip     === 'boolean', `export.isZip should be boolean`);
    assert(typeof e.createdAt === 'string',  `export.createdAt should be string`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. GET /api/health — version field (hardening)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n9. GET /api/health — version field');

await test('returns ok:true with model and version fields', async () => {
  const { status, body } = await api('GET', '/api/health');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.ok === true, 'ok should be true');
  assert(typeof body.model   === 'string' && body.model.length   > 0, 'model should be non-empty string');
  assert(typeof body.version === 'string' && body.version.length > 0, 'version should be non-empty string');
});

await test('version field matches semver pattern (X.Y.Z)', async () => {
  const { body } = await api('GET', '/api/health');
  assert(/^\d+\.\d+\.\d+/.test(body.version),
    `version "${body.version}" should match semver pattern X.Y.Z`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. POST /api/cases/:caseId/sections/:fieldId/copy — clipboard fallback
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n10. POST /api/cases/:caseId/sections/:fieldId/copy — clipboard fallback');

// Setup: create a test case and write mock output text directly to outputs.json
// (avoids OpenAI generation cost while still exercising the full copy endpoint)
let clipTestCaseId = null;
{
  const { body } = await api('POST', '/api/cases/create', { formType: '1004' });
  if (body.ok && body.caseId) {
    clipTestCaseId = body.caseId;
    const caseDir    = path.join(CASES_DIR, clipTestCaseId);
    const outputsPath = path.join(caseDir, 'outputs.json');
    const mockOutputs = {
      neighborhood_description: {
        text:          'The subject property is located in a stable residential neighborhood with good access to amenities.',
        sectionStatus: 'drafted',
        generatedAt:   new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    try {
      if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
      fs.writeFileSync(outputsPath, JSON.stringify(mockOutputs, null, 2), 'utf8');
    } catch (e) {
      console.warn('    ⚠ Could not write mock outputs.json:', e.message);
      clipTestCaseId = null;
    }
  }
  if (clipTestCaseId) console.log(`    → Test case created: ${clipTestCaseId}`);
  else                console.log('    ⚠ Test case creation failed — copy tests will be skipped');
}

await test('returns 404 for non-existent case', async () => {
  const { status, body } = await api('POST', '/api/cases/00000000/sections/neighborhood_description/copy', {});
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body.ok === false, 'ok should be false');
});

await test('returns 400 for field with no text', async () => {
  if (!clipTestCaseId) return; // skip if setup failed
  const { status, body } = await api('POST', `/api/cases/${clipTestCaseId}/sections/nonexistent_field/copy`, {});
  assert(status === 400, `Expected 400, got ${status}`);
  assert(body.ok === false, 'ok should be false');
  assert(typeof body.error === 'string', 'error message should be present');
});

await test('happy path: returns ok:true with text and sectionStatus:copied', async () => {
  if (!clipTestCaseId) return;
  const { status, body } = await api('POST', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/copy`, {
    failureReason: 'ACI agent not running',
  });
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.ok === true, 'ok should be true');
  assert(typeof body.text === 'string' && body.text.length > 0, 'text should be non-empty string');
  assert(body.sectionStatus       === 'copied', `sectionStatus should be 'copied', got '${body.sectionStatus}'`);
  assert(body.manualPasteRequired === true,     'manualPasteRequired should be true');
});

await test('response includes target object with software, label, fieldId', async () => {
  if (!clipTestCaseId) return;
  const { body } = await api('POST', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/copy`, {});
  assert(body.target && typeof body.target === 'object', 'target should be an object');
  assert(typeof body.target.software === 'string',       'target.software should be a string');
  assert(typeof body.target.label    === 'string',       'target.label should be a string');
  assert(body.target.fieldId === 'neighborhood_description', 'target.fieldId should match requested fieldId');
});

await test('response includes copiedAt ISO timestamp', async () => {
  if (!clipTestCaseId) return;
  const { body } = await api('POST', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/copy`, {});
  assert(typeof body.copiedAt === 'string',       'copiedAt should be a string');
  assert(!isNaN(Date.parse(body.copiedAt)),        'copiedAt should be a valid ISO date');
});

await test('response includes non-empty message string', async () => {
  if (!clipTestCaseId) return;
  const { body } = await api('POST', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/copy`, {});
  assert(typeof body.message === 'string' && body.message.length > 0, 'message should be non-empty string');
  assert(body.message.toLowerCase().includes('manual') || body.message.toLowerCase().includes('paste'),
    'message should mention manual paste requirement');
});

await test('sectionStatus is persisted as "copied" in outputs.json', async () => {
  if (!clipTestCaseId) return;
  await api('POST', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/copy`, {});
  const outputsPath = path.join(CASES_DIR, clipTestCaseId, 'outputs.json');
  try {
    const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
    const sec = outputs.neighborhood_description;
    assert(sec?.sectionStatus === 'copied',
      `Expected sectionStatus 'copied' in outputs.json, got '${sec?.sectionStatus}'`);
    assert(typeof sec?.copiedAt === 'string',
      'copiedAt should be persisted in outputs.json');
  } catch (e) {
    throw new Error('Could not verify outputs.json: ' + e.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. PATCH .../status — 'copied' is now a valid section status
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n11. PATCH .../status — "copied" is a valid section status');

await test('"copied" is accepted by PATCH .../status (not rejected as invalid)', async () => {
  if (!clipTestCaseId) return;
  const { status, body } = await api(
    'PATCH',
    `/api/cases/${clipTestCaseId}/sections/neighborhood_description/status`,
    { status: 'copied' }
  );
  assert(status === 200,      `Expected 200, got ${status} — body: ${JSON.stringify(body).slice(0, 200)}`);
  assert(body.ok === true,    'ok should be true');
});

await test('"copied" status is distinct from "inserted" and "verified" in persisted state', async () => {
  if (!clipTestCaseId) return;
  await api('PATCH', `/api/cases/${clipTestCaseId}/sections/neighborhood_description/status`, { status: 'copied' });
  const outputsPath = path.join(CASES_DIR, clipTestCaseId, 'outputs.json');
  const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
  const s = outputs.neighborhood_description?.sectionStatus;
  assert(s === 'copied',    `sectionStatus should be 'copied', got '${s}'`);
  assert(s !== 'inserted',  '"copied" must not equal "inserted"');
  assert(s !== 'verified',  '"copied" must not equal "verified"');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  failures.forEach(f => console.log(`    ✗ ${f.name}\n      → ${f.error}`));
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
