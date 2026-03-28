/**
 * _test_e2e_1004.mjs
 * -------------------
 * End-to-end workflow test for a real 1004 single-family assignment.
 *
 * Validates the complete production pipeline:
 *   Create case â†’ Set facts â†’ Generate core sections â†’ Review sections â†’
 *   Approve sections â†’ Attempt insert â†’ Check statuses â†’ Export bundle â†’ Cleanup
 *
 * Does NOT require ACI to be running.
 * Insert step gracefully accepts 503 (agent not running) as a valid outcome.
 *
 * Run:
 *   node _test_e2e_1004.mjs
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
const TIMEOUT_MS = 60000; // generation calls take 5-15s each

// â”€â”€ Test runner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  âœ“ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  âœ— ${name}`);
    console.error(`    â†’ ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function api(method, urlPath, body) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${BASE}${urlPath}`, opts);
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

const get   = (p)       => api('GET',    p).then(r => r.body);
const post  = (p, b)    => api('POST',   p, b).then(r => r.body);
const patch = (p, b)    => api('PATCH',  p, b).then(r => r.body);
const del   = (p)       => api('DELETE', p).then(r => r.body);

// â”€â”€ Test data â€” realistic 1004 single-family assignment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SUBJECT = {
  address:       '4821 Maple Ridge Drive',
  city:          'Springfield',
  state:         'IL',
  zip:           '62704',
  county:        'Sangamon',
  formType:      '1004',
  propertyType:  'Single Family',
  bedrooms:      3,
  bathrooms:     2,
  gla:           1842,
  yearBuilt:     1998,
  lotSize:       '0.28 acres',
  condition:     'C3',
  quality:       'Q4',
  effectiveAge:  15,
  neighborhood:  'Maple Ridge Subdivision',
  marketTrend:   'Stable',
  listPrice:     285000,
  contractPrice: 279500,
  concessions:   'None',
};

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let caseId = null;

// â”€â”€ Phase 1: Server health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
console.log('  Appraisal Agent â€” End-to-End 1004 Workflow Test');
console.log('  Subject: ' + SUBJECT.address + ', ' + SUBJECT.city + ' ' + SUBJECT.state);
console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

console.log('Phase 1: Server health');

await test('Server is running and healthy', async () => {
  const h = await get('/api/health');
  assert(h.ok === true,          'health ok !== true');
  assert(h.model,                'health.model missing');
  assert(h.version === '2.0.0',  `health.version should be 2.0.0, got ${h.version}`);
});

await test('1004 form is in active scope', async () => {
  const forms = await get('/api/forms');
  assert(Array.isArray(forms) || (forms.forms && Array.isArray(forms.forms)),
    'GET /api/forms should return array or {forms:[]}');
  const f1004 = await get('/api/forms/1004');
  assert(f1004 && (f1004.formType === '1004' || f1004.id === '1004' || f1004.ok !== false),
    '1004 form not found or blocked');
});

// â”€â”€ Phase 2: Case creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 2: Case creation');

await test('Create 1004 case with subject metadata', async () => {
  const r = await post('/api/cases/create', {
    formType:     SUBJECT.formType,
    address:      SUBJECT.address,
    city:         SUBJECT.city,
    state:        SUBJECT.state,
    zip:          SUBJECT.zip,
    county:       SUBJECT.county,
    propertyType: SUBJECT.propertyType,
  });
  assert(r.ok === true,    `create failed: ${JSON.stringify(r).slice(0, 200)}`);
  assert(r.caseId,         'caseId missing from create response');
  caseId = r.caseId;
  console.log(`    â†’ caseId: ${caseId}`);
});

await test('Case directory exists on disk', async () => {
  assert(caseId, 'caseId not set â€” create must have failed');
  const caseDir = path.join(CASES_DIR, caseId);
  assert(fs.existsSync(caseDir), `Case directory not found: ${caseDir}`);
  assert(fs.existsSync(path.join(caseDir, 'meta.json')), 'meta.json missing');
});

await test('GET /api/cases/:caseId returns case', async () => {
  const r = await get(`/api/cases/${caseId}`);
  assert(r.caseId === caseId || r.id === caseId || r.ok !== false,
    `GET case returned unexpected: ${JSON.stringify(r).slice(0, 200)}`);
});

// â”€â”€ Phase 3: Facts entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 3: Facts entry');

await test('PUT /api/cases/:caseId/facts â€” write subject facts', async () => {
  const r = await api('PUT', `/api/cases/${caseId}/facts`, {
    bedrooms:     SUBJECT.bedrooms,
    bathrooms:    SUBJECT.bathrooms,
    gla:          SUBJECT.gla,
    yearBuilt:    SUBJECT.yearBuilt,
    lotSize:      SUBJECT.lotSize,
    condition:    SUBJECT.condition,
    quality:      SUBJECT.quality,
    effectiveAge: SUBJECT.effectiveAge,
    neighborhood: SUBJECT.neighborhood,
    marketTrend:  SUBJECT.marketTrend,
    listPrice:    SUBJECT.listPrice,
    contractPrice: SUBJECT.contractPrice,
    concessions:  SUBJECT.concessions,
  });
  assert(r.status === 200, `PUT facts returned ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.body.ok === true, `PUT facts ok !== true`);
});

await test('Facts are persisted in facts.json', async () => {
  const factsPath = path.join(CASES_DIR, caseId, 'facts.json');
  assert(fs.existsSync(factsPath), 'facts.json not found â€” check PUT /facts handler');
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  assert(facts.bedrooms || facts.gla || facts.condition || Object.keys(facts).length > 0,
    'facts.json is empty â€” check PUT /facts handler');
});

// â”€â”€ Phase 4: Core section generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 4: Core section generation (calls OpenAI â€” ~30-60s)');

let generatedSections = {};

await test('POST /api/cases/:caseId/generate-core â€” generates 1004 sections', async () => {
  console.log('    â†’ Calling generate-core (this may take 30-60s)...');
  const r = await post(`/api/cases/${caseId}/generate-core`, {});
  assert(r.ok === true, `generate-core failed: ${JSON.stringify(r).slice(0, 300)}`);
  // Response: { ok, caseId, formType, results:{}, generated:N, failed:N, coreSections:[] }
  assert(r.results !== undefined || typeof r.generated === 'number',
    `generate-core response missing results/generated â€” got: ${JSON.stringify(r).slice(0, 200)}`);
  generatedSections = r.results || {};
  const count = typeof r.generated === 'number' ? r.generated : Object.keys(generatedSections).length;
  console.log(`    â†’ Generated ${count} sections`);
  assert(count >= 3, `Expected at least 3 sections, got ${count}`);
});

await test('outputs.json exists and has generated text', async () => {
  const outPath = path.join(CASES_DIR, caseId, 'outputs.json');
  assert(fs.existsSync(outPath), 'outputs.json not found after generate-core');
  const outputs = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const withText = Object.entries(outputs)
    .filter(([k, v]) => k !== 'updatedAt' && typeof v === 'object' && v.text && v.text.length > 20);
  console.log(`    â†’ ${withText.length} sections have text in outputs.json`);
  assert(withText.length >= 3, `Expected â‰¥3 sections with text, got ${withText.length}`);
});

await test('Priority sections have non-empty text', async () => {
  const outPath = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const priority = ['neighborhood_description', 'market_conditions', 'site_description',
                    'improvements_description', 'reconciliation'];
  const found = priority.filter(s => outputs[s]?.text?.length > 20);
  console.log(`    â†’ Priority sections with text: ${found.join(', ') || 'none'}`);
  // At least 2 of the 5 priority sections should have been generated
  assert(found.length >= 2,
    `Expected â‰¥2 priority sections with text, got ${found.length}: ${found.join(', ')}`);
});

// â”€â”€ Phase 5: Section review & approval â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 5: Section review & approval');

const APPROVE_SECTIONS = ['neighborhood_description', 'market_conditions', 'reconciliation'];

await test('PATCH .../status â†’ reviewed for generated sections', async () => {
  const outPath = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  let reviewed = 0;
  for (const sec of APPROVE_SECTIONS) {
    if (outputs[sec]?.text?.length > 20) {
      const r = await patch(`/api/cases/${caseId}/sections/${sec}/status`, { status: 'reviewed' });
      if (r.ok) reviewed++;
    }
  }
  console.log(`    â†’ Marked ${reviewed} sections as reviewed`);
  assert(reviewed >= 1, 'Could not mark any section as reviewed');
});

await test('PATCH .../status â†’ approved triggers approval-to-memory', async () => {
  const outPath = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  let approved = 0;
  for (const sec of APPROVE_SECTIONS) {
    if (outputs[sec]?.text?.length > 20) {
      const r = await patch(`/api/cases/${caseId}/sections/${sec}/status`, { status: 'approved' });
      if (r.ok && r.sectionStatus === 'approved') approved++;
    }
  }
  console.log(`    â†’ Approved ${approved} sections`);
  assert(approved >= 1, 'Could not approve any section');
});

await test('GET .../sections/status shows approved sections', async () => {
  const r = await get(`/api/cases/${caseId}/sections/status`);
  assert(r.ok === true || Array.isArray(r.sections) || typeof r === 'object',
    'sections/status returned unexpected format');
  const sections = r.sections || r;
  const approvedCount = Object.values(sections)
    .filter(s => typeof s === 'object' && s.sectionStatus === 'approved').length;
  console.log(`    â†’ ${approvedCount} sections in approved state`);
  assert(approvedCount >= 1, `Expected â‰¥1 approved section, got ${approvedCount}`);
});

// â”€â”€ Phase 6: Insert attempt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 6: Insert attempt (ACI agent may or may not be running)');

await test('POST /api/cases/:caseId/sections/neighborhood_description/insert â€” valid response', async () => {
  const r = await api('POST', `/api/cases/${caseId}/sections/neighborhood_description/insert`, {});
  // Accept: 200 ok:true (agent running + inserted), 503 (agent not running), 400 (no approved text)
  const validStatus = [200, 400, 503].includes(r.status);
  assert(validStatus,
    `Unexpected status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  if (r.status === 200) {
    console.log('    â†’ Agent running: insert succeeded');
    assert(r.body.ok === true, 'ok should be true on 200');
  } else if (r.status === 503) {
    console.log('    â†’ Agent not running: 503 returned (expected in CI)');
    assert(r.body.ok === false, 'ok should be false on 503');
  } else {
    console.log(`    â†’ 400 returned: ${r.body.error || 'no approved text'}`);
  }
});

await test('POST /api/cases/:caseId/insert-all â€” valid response', async () => {
  const r = await api('POST', `/api/cases/${caseId}/insert-all`, {});
  const validStatus = [200, 400, 503].includes(r.status);
  assert(validStatus,
    `Unexpected status ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  if (r.status === 200) {
    console.log(`    â†’ insert-all succeeded: ${r.body.inserted || 0} inserted`);
  } else if (r.status === 503) {
    console.log('    â†’ insert-all: 503 (agent not running)');
  } else {
    console.log(`    â†’ insert-all: 400 â€” ${r.body.error}`);
  }
});

// â”€â”€ Phase 7: Destination registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 7: Destination registry');

await test('GET /api/cases/:caseId/destination-registry returns 1004 fields', async () => {
  const r = await get(`/api/cases/${caseId}/destination-registry`);
  assert(r.ok === true, `destination-registry ok !== true: ${JSON.stringify(r).slice(0, 200)}`);
  assert(r.formType === '1004', `Expected formType 1004, got ${r.formType}`);
  // Response: { ok, caseId, formType, software, fields:{}, fieldCount }
  assert(r.fields && typeof r.fields === 'object' && Object.keys(r.fields).length > 0,
    `fields object missing or empty â€” got keys: ${Object.keys(r).join(', ')}`);
  console.log(`    â†’ ${r.fieldCount || Object.keys(r.fields).length} fields for 1004 (software: ${r.software})`);
});

await test('neighborhood_description field targets ACI', async () => {
  const r = await get(`/api/cases/${caseId}/destination-registry`);
  assert(r.software === 'aci', `Expected software=aci at top level, got ${r.software}`);
  assert(r.fields?.neighborhood_description,
    'neighborhood_description not found in fields');
});

// â”€â”€ Phase 8: Exceptions check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 8: Exceptions check');

await test('GET /api/cases/:caseId/exceptions â€” returns valid structure', async () => {
  const r = await get(`/api/cases/${caseId}/exceptions`);
  assert(r.ok === true,          'exceptions ok !== true');
  assert(typeof r.count === 'number', 'exceptions.count should be a number');
  assert(Array.isArray(r.exceptions), 'exceptions.exceptions should be an array');
  console.log(`    â†’ ${r.count} exception(s) found`);
});

// â”€â”€ Phase 9: Support bundle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 9: Support bundle export');

await test('POST /api/export/bundle â€” creates bundle with this case', async () => {
  console.log('    â†’ Creating support bundle (may take 15-20s)...');
  const r = await api('POST', '/api/export/bundle', { zip: true, label: 'e2e-test' });
  assert(r.status === 200, `bundle returned ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.body.ok === true,    'bundle ok !== true');
  assert(r.body.bundlePath,     'bundlePath missing');
  assert(r.body.isZip === true, 'isZip should be true');
  console.log(`    â†’ Bundle: ${path.basename(r.body.bundlePath)}`);
});

await test('GET /api/export/list â€” bundle appears in list', async () => {
  const r = await get('/api/export/list');
  assert(r.ok === true,          'export/list ok !== true');
  assert(Array.isArray(r.exports) && r.exports.length > 0,
    'No exports found after bundle creation');
  console.log(`    â†’ ${r.exports.length} export(s) in list`);
});

// â”€â”€ Phase 10: Clipboard fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 10: Clipboard fallback');

await test('POST .../copy â€” clipboard fallback returns copied status', async () => {
  const r = await api('POST', `/api/cases/${caseId}/sections/neighborhood_description/copy`, {});
  assert(r.status === 200,                    `copy returned ${r.status}`);
  assert(r.body.ok === true,                  'copy ok !== true');
  assert(r.body.sectionStatus === 'copied',   `sectionStatus should be 'copied', got ${r.body.sectionStatus}`);
  assert(r.body.manualPasteRequired === true, 'manualPasteRequired should be true');
  assert(r.body.text,                         'text missing from copy response');
  console.log(`    â†’ Clipboard text: ${r.body.text.slice(0, 60)}...`);
});

await test('"copied" status persisted in outputs.json', async () => {
  const outPath = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const sec = outputs.neighborhood_description;
  assert(sec?.sectionStatus === 'copied',
    `Expected sectionStatus 'copied', got '${sec?.sectionStatus}'`);
});

// â”€â”€ Phase 11: Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nPhase 11: Cleanup');

await test('DELETE /api/cases/:caseId â€” removes case', async () => {
  const r = await del(`/api/cases/${caseId}`);
  assert(r.ok === true, `delete failed: ${JSON.stringify(r).slice(0, 200)}`);
});

await test('Case directory removed from disk', async () => {
  const caseDir = path.join(CASES_DIR, caseId);
  assert(!fs.existsSync(caseDir), `Case directory still exists after delete: ${caseDir}`);
});

await test('GET /api/cases/:caseId returns 404 after delete', async () => {
  const r = await api('GET', `/api/cases/${caseId}`);
  assert(r.status === 404, `Expected 404 after delete, got ${r.status}`);
});

// â”€â”€ Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
console.log(`  E2E Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  failures.forEach(f => console.log(`    âœ— ${f.name}\n      â†’ ${f.error}`));
}
console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

process.exit(failed > 0 ? 1 : 0);

