/**
 * _test_phase2_endpoints.mjs
 * Phase 2 endpoint tests:
 *   PATCH /api/cases/:caseId/sections/:fieldId/status
 *   GET   /api/cases/:caseId/sections/status
 *   POST  /api/cases/:caseId/generate-core (scope + structure)
 */
import fs   from 'fs';
import path from 'path';

const BASE = 'http://localhost:5178';
const H    = { 'Content-Type': 'application/json' };

const post  = (url, body) => fetch(BASE + url, { method: 'POST',  headers: H, body: JSON.stringify(body) }).then(r => r.json());
const patch = (url, body) => fetch(BASE + url, { method: 'PATCH', headers: H, body: JSON.stringify(body) }).then(r => r.json());
const get   = (url)       => fetch(BASE + url, { headers: H }).then(r => r.json());
const del   = (url)       => fetch(BASE + url, { method: 'DELETE', headers: H }).then(r => r.json());

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log('  ✅ PASS', label); pass++; }
  else       { console.log('  ❌ FAIL', label, detail ? `→ ${detail}` : ''); fail++; }
}

const CASES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'cases');

(async () => {
  console.log('══════════════════════════════════════════');
  console.log('  Phase 2 Endpoint Tests');
  console.log('══════════════════════════════════════════\n');

  // ── Setup ──────────────────────────────────────────────────────────────────
  const c1 = await post('/api/cases/create', { address: '123 Test St, Springfield IL', formType: '1004' });
  check('Setup: create 1004 case', c1.ok, JSON.stringify(c1));
  const caseId = c1.caseId;

  const c2 = await post('/api/cases/create', { address: '456 Commerce Blvd, Chicago IL', formType: 'commercial' });
  check('Setup: create commercial case', c2.ok, JSON.stringify(c2));
  const commId = c2.caseId;

  // ── [1] PATCH section status ───────────────────────────────────────────────
  console.log('\n[1] PATCH /api/cases/:caseId/sections/:fieldId/status');

  const s1 = await patch(`/api/cases/${caseId}/sections/neighborhood_description/status`, { status: 'drafted' });
  check('1a. drafted → ok:true',           s1.ok === true,                          JSON.stringify(s1));
  check('1b. Returns fieldId',             s1.fieldId === 'neighborhood_description');
  check('1c. Returns sectionStatus',       s1.sectionStatus === 'drafted');
  check('1d. Returns updatedAt',           !!s1.updatedAt);

  const s2 = await patch(`/api/cases/${caseId}/sections/market_conditions/status`, { status: 'reviewed', note: 'Looks good' });
  check('1e. reviewed + note → ok:true',   s2.ok === true,                          JSON.stringify(s2));

  const s3 = await patch(`/api/cases/${caseId}/sections/reconciliation/status`, { status: 'approved' });
  check('1f. approved → ok:true',          s3.ok === true,                          JSON.stringify(s3));

  const s4 = await patch(`/api/cases/${caseId}/sections/neighborhood_description/status`, { status: 'invalid_status' });
  check('1g. Invalid status → ok:false',   s4.ok === false,                         JSON.stringify(s4));
  check('1h. Invalid status → error msg',  typeof s4.error === 'string');

  const s5 = await patch('/api/cases/BADID/sections/neighborhood_description/status', { status: 'drafted' });
  check('1i. Bad caseId → ok:false',       s5.ok === false,                         JSON.stringify(s5));

  // All lifecycle values
  for (const status of ['not_started', 'drafted', 'reviewed', 'approved', 'inserted', 'verified', 'error']) {
    const r = await patch(`/api/cases/${caseId}/sections/sca_summary/status`, { status });
    check(`1j. lifecycle: ${status}`,      r.ok === true && r.sectionStatus === status, JSON.stringify(r));
  }

  // ── [2] GET sections/status ────────────────────────────────────────────────
  console.log('\n[2] GET /api/cases/:caseId/sections/status');

  const st1 = await get(`/api/cases/${caseId}/sections/status`);
  check('2a. ok:true',                     st1.ok === true,                         JSON.stringify(st1));
  check('2b. Returns caseId',              st1.caseId === caseId);
  check('2c. Returns sections object',     typeof st1.sections === 'object');
  check('2d. neighborhood_description → drafted',
    st1.sections?.neighborhood_description?.sectionStatus === 'drafted');
  check('2e. market_conditions → reviewed',
    st1.sections?.market_conditions?.sectionStatus === 'reviewed');
  check('2f. reconciliation → approved',
    st1.sections?.reconciliation?.sectionStatus === 'approved');
  check('2g. sca_summary → error (last lifecycle write)',
    st1.sections?.sca_summary?.sectionStatus === 'error');
  check('2h. Each section has title',
    Object.values(st1.sections || {}).every(s => typeof s.title === 'string'));
  check('2i. Each section has approved bool',
    Object.values(st1.sections || {}).every(s => typeof s.approved === 'boolean'));

  const st2 = await get('/api/cases/BADID/sections/status');
  check('2j. Bad caseId → ok:false',       st2.ok === false);

  // ── [3] generate-core: non-existent case ──────────────────────────────────
  console.log('\n[3] POST /api/cases/:caseId/generate-core — non-existent case');

  const gc0 = await post('/api/cases/FAKEID/generate-core', { twoPass: false });
  check('3a. Non-existent case → ok:false', gc0.ok === false,                       JSON.stringify(gc0));

  // ── [4] generate-core: deferred form blocked ───────────────────────────────
  console.log('\n[4] POST /api/cases/:caseId/generate-core — deferred scope enforcement');

  // Must use a valid 8-char hex caseId (CASE_ID_RE = /^[a-f0-9]{8}$/i)
  // 1025 is now active (not deferred) — use 1004c which is the actual deferred form
  const deferredId = 'de1004ca';
  const deferredDir = path.join(CASES_DIR, deferredId);
  fs.mkdirSync(deferredDir, { recursive: true });
  fs.writeFileSync(path.join(deferredDir, 'meta.json'),
    JSON.stringify({ formType: '1004c', address: 'Deferred Test', caseId: deferredId }));

  const gc1 = await post(`/api/cases/${deferredId}/generate-core`, { twoPass: false });
  check('4a. 1004c → ok:false',            gc1.ok === false,                        JSON.stringify(gc1));
  check('4b. scope=deferred',              gc1.scope === 'deferred',                JSON.stringify(gc1));
  check('4c. supported=false',             gc1.supported === false);
  check('4d. formType in response',        gc1.formType === '1004c');
  fs.rmSync(deferredDir, { recursive: true, force: true });

  // ── [5] generate-core: 1004 endpoint shape ────────────────────────────────
  console.log('\n[5] POST /api/cases/:caseId/generate-core — 1004 endpoint shape');
  console.log('    (AI generation — may take up to 120s)');

  const gc2 = await post(`/api/cases/${caseId}/generate-core`, { twoPass: false });
  check('5a. Endpoint reached (not 404)',  gc2.ok !== undefined,                    JSON.stringify(gc2).slice(0, 200));

  if (gc2.ok) {
    check('5b. coreSections is array',     Array.isArray(gc2.coreSections));
    check('5c. 5 core sections for 1004',  gc2.coreSections?.length === 5,          JSON.stringify(gc2.coreSections));
    check('5d. results is object',         typeof gc2.results === 'object');
    check('5e. generated is number',       typeof gc2.generated === 'number');
    check('5f. failed is number',          typeof gc2.failed === 'number');
    check('5g. formType=1004',             gc2.formType === '1004');
    check('5h. pipelineStage present',     typeof gc2.pipelineStage === 'string');
    const sids = Object.keys(gc2.results || {});
    check('5i. Results have sectionStatus', sids.every(id => typeof gc2.results[id].sectionStatus === 'string'));
    check('5j. Results have text',          sids.every(id => typeof gc2.results[id].text === 'string'));
    console.log('     coreSections:', gc2.coreSections);
    console.log('     generated:', gc2.generated, '/ failed:', gc2.failed);
  } else {
    // Endpoint reached but AI failed — still a valid test (scope not blocked)
    check('5b. Not scope-blocked (no scope field)', !gc2.scope,                     JSON.stringify(gc2).slice(0, 200));
    console.log('     AI error (non-fatal for endpoint test):', gc2.error?.slice(0, 120));
  }

  // ── [6] generate-core: commercial endpoint shape ──────────────────────────
  console.log('\n[6] POST /api/cases/:caseId/generate-core — commercial endpoint shape');

  const gc3 = await post(`/api/cases/${commId}/generate-core`, { twoPass: false });
  check('6a. Endpoint reached (not 404)',  gc3.ok !== undefined,                    JSON.stringify(gc3).slice(0, 200));
  if (gc3.ok) {
    check('6b. coreSections is array',     Array.isArray(gc3.coreSections));
    check('6c. 5 core sections for commercial', gc3.coreSections?.length === 5,     JSON.stringify(gc3.coreSections));
    check('6d. formType=commercial',       gc3.formType === 'commercial');
    console.log('     coreSections:', gc3.coreSections);
  } else {
    check('6b. Not scope-blocked',         !gc3.scope,                              JSON.stringify(gc3).slice(0, 200));
    console.log('     AI error (non-fatal):', gc3.error?.slice(0, 120));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await del(`/api/cases/${caseId}`);
  await del(`/api/cases/${commId}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════════════');
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
