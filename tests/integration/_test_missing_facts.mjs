/**
 * _test_missing_facts.mjs
 * -----------------------
 * Tests for POST /api/cases/:caseId/missing-facts (batch endpoint fix)
 * and GET /api/cases/:caseId/missing-facts/:fieldId (single-field endpoint)
 */

const BASE = 'http://localhost:5178';
let passed = 0, failed = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log('  ✓', label);
    passed++;
  } else {
    console.log('  ✗', label, detail ? `(${detail})` : '');
    failed++;
  }
}

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: null, raw: text.slice(0, 200) }; }
}

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Missing Facts Endpoint Tests');
  console.log('══════════════════════════════════════════\n');

  // ── Setup: create test case ───────────────────────────────────────────────
  const { data: created } = await api('/api/cases/create', {
    method: 'POST',
    body: { address: '123 Test St, Bloomington, IL', formType: '1004' },
  });
  const caseId = created?.caseId;
  ok('Setup: create test case', !!caseId, `caseId=${caseId}`);
  if (!caseId) { console.log('Cannot continue without a case.'); process.exit(1); }

  // ── Setup: save PARTIAL facts (missing city, county, market.trend) ────────
  const { data: factsRes } = await api('/api/cases/' + caseId + '/facts', {
    method: 'PUT',
    body: {
      subject: {
        gla:       { value: '1800',    confidence: 'high' },
        condition: { value: 'Average', confidence: 'high' },
        quality:   { value: 'Q3',      confidence: 'high' },
        // intentionally missing: city, county, address, siteSize, zoning
      },
      // intentionally missing: market.trend, comps
    },
  });
  ok('Setup: save partial facts', factsRes?.ok === true);

  console.log('\n1. POST /api/cases/:caseId/missing-facts (batch)');

  // ── Test 1a: happy path — fields with missing required facts ─────────────
  const { status: s1, data: d1 } = await api('/api/cases/' + caseId + '/missing-facts', {
    method: 'POST',
    body: { fieldIds: ['neighborhood_description', 'reconciliation', 'site_description'] },
  });
  ok('1a. Returns ok:true', d1?.ok === true, `status=${s1}`);
  ok('1b. Returns warnings array', Array.isArray(d1?.warnings), `got ${typeof d1?.warnings}`);
  ok('1c. Warnings are non-empty (missing facts detected)', (d1?.warnings?.length ?? 0) > 0,
     `got ${d1?.warnings?.length} warnings`);

  // Check warning shape
  const w = d1?.warnings?.[0];
  ok('1d. Warning has fieldId', typeof w?.fieldId === 'string', `fieldId=${w?.fieldId}`);
  ok('1e. Warning has field (human label)', typeof w?.field === 'string', `field=${w?.field}`);
  ok('1f. Warning has severity (required|recommended)', w?.severity === 'required' || w?.severity === 'recommended',
     `severity=${w?.severity}`);
  ok('1g. Warning has message', typeof w?.message === 'string', `message=${w?.message}`);

  // Check severity values are correct
  const requiredWarnings   = d1?.warnings?.filter(x => x.severity === 'required')   ?? [];
  const recommendedWarnings = d1?.warnings?.filter(x => x.severity === 'recommended') ?? [];
  ok('1h. Has required-severity warnings', requiredWarnings.length > 0,
     `required=${requiredWarnings.length}`);
  ok('1i. Has recommended-severity warnings', recommendedWarnings.length > 0,
     `recommended=${recommendedWarnings.length}`);

  // Check fieldId tagging — each warning should have the originating fieldId
  const fieldIds = ['neighborhood_description', 'reconciliation', 'site_description'];
  const allTagged = d1?.warnings?.every(x => fieldIds.includes(x.fieldId)) ?? false;
  ok('1j. All warnings tagged with originating fieldId', allTagged);

  console.log(`     Sample warnings (first 3):`);
  (d1?.warnings ?? []).slice(0, 3).forEach(w =>
    console.log(`       [${w.severity}] ${w.fieldId} → ${w.field}: ${w.message}`)
  );

  // ── Test 1k: empty fieldIds → returns empty warnings ─────────────────────
  const { data: d2 } = await api('/api/cases/' + caseId + '/missing-facts', {
    method: 'POST',
    body: { fieldIds: [] },
  });
  ok('1k. Empty fieldIds → ok:true, warnings:[]', d2?.ok === true && d2?.warnings?.length === 0,
     `ok=${d2?.ok} warnings=${d2?.warnings?.length}`);

  // ── Test 1l: field with no dependency config → skipped gracefully ─────────
  const { data: d3 } = await api('/api/cases/' + caseId + '/missing-facts', {
    method: 'POST',
    body: { fieldIds: ['unknown_field_xyz', 'neighborhood_description'] },
  });
  ok('1l. Unknown field skipped gracefully (no crash)', d3?.ok === true,
     `ok=${d3?.ok}`);

  // ── Test 1m: case not found → 404 ────────────────────────────────────────
  const { status: s4, data: d4 } = await api('/api/cases/deadbeef/missing-facts', {
    method: 'POST',
    body: { fieldIds: ['neighborhood_description'] },
  });
  ok('1m. Non-existent case → 404', s4 === 404, `status=${s4}`);
  ok('1n. Non-existent case → ok:false', d4?.ok === false, `ok=${d4?.ok}`);

  console.log('\n2. GET /api/cases/:caseId/missing-facts/:fieldId (single-field)');

  // ── Test 2a: single-field endpoint still works ────────────────────────────
  const { status: s5, data: d5 } = await api(
    '/api/cases/' + caseId + '/missing-facts/neighborhood_description'
  );
  ok('2a. Returns ok:true', d5?.ok === true, `status=${s5}`);
  ok('2b. Returns required array', Array.isArray(d5?.required), `got ${typeof d5?.required}`);
  ok('2c. Returns recommended array', Array.isArray(d5?.recommended), `got ${typeof d5?.recommended}`);
  ok('2d. Returns hasBlockers bool', typeof d5?.hasBlockers === 'boolean', `got ${typeof d5?.hasBlockers}`);
  ok('2e. Required facts are non-empty (city/county missing)', (d5?.required?.length ?? 0) > 0,
     `required=${d5?.required?.length}`);
  console.log(`     required: ${JSON.stringify(d5?.required)}`);
  console.log(`     recommended: ${JSON.stringify(d5?.recommended?.slice(0,3))}`);

  // ── Test 2f: single-field with fully-satisfied facts ─────────────────────
  // Add the required facts for site_description (just needs address + siteSize)
  await api('/api/cases/' + caseId + '/facts', {
    method: 'PUT',
    body: {
      subject: {
        gla:       { value: '1800',                    confidence: 'high' },
        condition: { value: 'Average',                 confidence: 'high' },
        quality:   { value: 'Q3',                      confidence: 'high' },
        address:   { value: '123 Test St',             confidence: 'high' },
        siteSize:  { value: '0.25 acres',              confidence: 'high' },
        city:      { value: 'Bloomington',             confidence: 'high' },
        county:    { value: 'McLean',                  confidence: 'high' },
      },
    },
  });
  const { data: d6 } = await api(
    '/api/cases/' + caseId + '/missing-facts/site_description'
  );
  ok('2f. site_description with address+siteSize → required empty', (d6?.required?.length ?? 1) === 0,
     `required=${d6?.required?.length}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await api('/api/cases/' + caseId, { method: 'DELETE' });
  console.log('\n  Test case deleted.');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test runner error:', err); process.exit(1); });
