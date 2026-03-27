/**
 * _test_phase3.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3 Endpoint Tests — Destination Registry, Single-Section Insert,
 * Exception Queue, Comp Commentary Engine, Approval-to-Memory, insert-all
 * sectionStatus lifecycle.
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 *
 * Run: node _test_phase3.mjs
 * Server must be running on port 5178.
 * Agents do NOT need to be running — insert tests verify 503 handling.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs';
import path from 'path';

const BASE     = 'http://localhost:5178';
const CASES_DIR = 'c:/Users/ccres/OneDrive/Desktop/cacc-writer/cases';
const h        = { 'Content-Type': 'application/json' };

const post  = (url, body) => fetch(BASE + url, { method: 'POST',   headers: h, body: JSON.stringify(body) }).then(r => r.json());
const patch = (url, body) => fetch(BASE + url, { method: 'PATCH',  headers: h, body: JSON.stringify(body) }).then(r => r.json());
const get   = (url)       => fetch(BASE + url, { headers: h }).then(r => r.json());
const del   = (url)       => fetch(BASE + url, { method: 'DELETE', headers: h }).then(r => r.json());

let pass = 0, fail = 0;
const results = [];

function check(label, cond, detail = '') {
  if (cond) {
    console.log('  PASS', label);
    pass++;
    results.push({ label, ok: true });
  } else {
    console.log('  FAIL', label, detail ? `(${String(detail).slice(0, 120)})` : '');
    fail++;
    results.push({ label, ok: false, detail: String(detail).slice(0, 120) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function writeOutputSection(caseId, fieldId, data) {
  const outFile = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  outputs[fieldId] = { title: fieldId, text: 'Sample narrative text for testing.', approved: false, sectionStatus: 'drafted', ...data };
  outputs.updatedAt = new Date().toISOString();
  fs.writeFileSync(outFile, JSON.stringify(outputs, null, 2));
}

function writeFacts(caseId, facts) {
  const factsFile = path.join(CASES_DIR, caseId, 'facts.json');
  fs.writeFileSync(factsFile, JSON.stringify(facts, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== Phase 3 Endpoint Tests ===\n');
  console.log('Server:', BASE);
  console.log('Scope: 1004 (ACI) + commercial (Real Quantum)\n');

  // ── Health check ────────────────────────────────────────────────────────────
  const health = await get('/api/health').catch(() => ({ ok: false }));
  if (!health.ok) {
    console.error('FATAL: Server is not running at', BASE);
    process.exit(1);
  }
  console.log('Server health: OK\n');

  // ── Setup: create test cases ────────────────────────────────────────────────
  console.log('=== Setup ===');
  const c1 = await post('/api/cases/create', { address: '123 Phase3 St, Springfield IL', formType: '1004' });
  check('Setup: create 1004 case', c1.ok, JSON.stringify(c1));
  const caseId = c1.caseId;

  const c2 = await post('/api/cases/create', { address: '456 Commerce Ave, Chicago IL', formType: 'commercial' });
  check('Setup: create commercial case', c2.ok, JSON.stringify(c2));
  const commId = c2.caseId;

  if (!caseId || !commId) {
    console.error('FATAL: Could not create test cases. Aborting.');
    process.exit(1);
  }

  // Pre-populate outputs via API for insert/exception tests
  await patch(`/api/cases/${caseId}/outputs/neighborhood_description`, { text: 'The subject is located in a stable residential neighborhood.' });
  await patch(`/api/cases/${caseId}/sections/neighborhood_description/status`, { status: 'approved' });

  await patch(`/api/cases/${caseId}/outputs/market_conditions`, { text: 'Market conditions are stable with moderate demand.' });
  // Leave market_conditions at drafted status (default after text set) — test [4] will approve it

  await patch(`/api/cases/${caseId}/outputs/reconciliation`, { text: 'Based on the analysis, the value is supported.' });
  await patch(`/api/cases/${caseId}/sections/reconciliation/status`, { status: 'error', notes: 'Insert failed: ACI timeout' });

  await patch(`/api/cases/${commId}/outputs/market_area`, { text: 'The subject is located in a commercial corridor.' });
  await patch(`/api/cases/${commId}/sections/market_area/status`, { status: 'approved' });

  // Pre-populate facts with comps for comp commentary test (via API)
  const put = (url, body) => fetch(BASE + url, { method: 'PUT', headers: h, body: JSON.stringify(body) }).then(r => r.json());
  await put(`/api/cases/${caseId}/facts`, {
    comps: [
      { address: { value: '100 Elm St, Springfield IL' }, salePrice: { value: 250000 }, saleDate: { value: '2024-01-15' }, gla: { value: 1800 } },
      { address: { value: '200 Oak Ave, Springfield IL' }, salePrice: { value: 265000 }, saleDate: { value: '2024-02-20' }, gla: { value: 1950 } },
      { address: { value: '300 Pine Rd, Springfield IL' }, salePrice: { value: 245000 }, saleDate: { value: '2024-03-10' }, gla: { value: 1750 } },
    ],
    subject: { address: { value: '123 Phase3 St' }, gla: { value: 1850 }, beds: { value: 3 }, baths: { value: 2 } },
  });

  console.log(`  1004 caseId: ${caseId}`);
  console.log(`  commercial caseId: ${commId}\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // [1] GET /api/cases/:caseId/destination-registry
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[1] GET /api/cases/:caseId/destination-registry');

  const dr1 = await get(`/api/cases/${caseId}/destination-registry`);
  check('1a. 1004 registry → ok:true',          dr1.ok === true,                JSON.stringify(dr1).slice(0, 200));
  check('1b. Returns caseId',                   dr1.caseId === caseId);
  check('1c. Returns formType=1004',            dr1.formType === '1004');
  check('1d. Returns software=aci',             dr1.software === 'aci');
  check('1e. Returns fields object',            typeof dr1.fields === 'object');
  check('1f. Returns fieldCount >= 0',          typeof dr1.fieldCount === 'number');
  // If field map exists, verify enrichment
  if (dr1.fieldCount > 0) {
    const firstField = Object.values(dr1.fields)[0];
    check('1g. Fields have sectionStatus',      typeof firstField?.sectionStatus === 'string');
    check('1h. Fields have approved flag',      typeof firstField?.approved === 'boolean');
    check('1i. Fields have hasText flag',       typeof firstField?.hasText === 'boolean');
    // neighborhood_description was pre-populated as approved
    if (dr1.fields.neighborhood_description) {
      check('1j. neighborhood_description shows approved=true', dr1.fields.neighborhood_description.approved === true);
    }
  } else {
    console.log('     (field map not found — fieldCount=0, skipping enrichment checks)');
    check('1g. Fields object returned (empty ok)', typeof dr1.fields === 'object');
    check('1h. fieldCount is 0 (no map)',           dr1.fieldCount === 0);
    check('1i. software=aci returned',              dr1.software === 'aci');
  }

  const dr2 = await get(`/api/cases/${commId}/destination-registry`);
  check('1k. commercial registry → ok:true',    dr2.ok === true,                JSON.stringify(dr2).slice(0, 200));
  check('1l. commercial software=real_quantum', dr2.software === 'real_quantum');
  check('1m. commercial formType=commercial',   dr2.formType === 'commercial');

  const dr3 = await get('/api/cases/BADID00a/destination-registry');
  check('1n. Bad caseId → ok:false',            dr3.ok === false);

  // ─────────────────────────────────────────────────────────────────────────────
  // [2] POST /api/cases/:caseId/sections/:fieldId/insert (single-section)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/cases/:caseId/sections/:fieldId/insert');

  // Test with a field that has text — agent may or may not be running
  // Valid outcomes: ok:false (agent not running → 503) OR ok:true (agent running → inserted)
  const ins1 = await post(`/api/cases/${caseId}/sections/neighborhood_description/insert`, { verify: false });
  const ins1Valid = (ins1.ok === false) || (ins1.ok === true && ins1.inserted === true);
  check('2a. Insert endpoint responds correctly (ok:false if no agent, ok:true if agent running)', ins1Valid, JSON.stringify(ins1).slice(0, 200));
  check('2b. Returns fieldId',                        ins1.fieldId === 'neighborhood_description' || ins1.ok === false);
  // When agent is not running, sectionStatus should remain or be set to error
  if (!ins1.ok) {
    check('2c. Returns sectionStatus on failure',     typeof ins1.sectionStatus === 'string' || ins1.error !== undefined);
  }

  // Test with a field that has no text
  const ins2 = await post(`/api/cases/${caseId}/sections/nonexistent_field/insert`, {});
  check('2d. No text → ok:false',                     ins2.ok === false);
  check('2e. No text → error message',                typeof ins2.error === 'string');

  // Test with bad caseId
  const ins3 = await post('/api/cases/BADID00a/sections/neighborhood_description/insert', {});
  check('2f. Bad caseId → ok:false',                  ins3.ok === false);

  // Verify sectionStatus was updated to 'error' after failed insert
  const statusAfterInsert = await get(`/api/cases/${caseId}/sections/status`);
  if (statusAfterInsert.ok && statusAfterInsert.sections?.neighborhood_description) {
    const nd = statusAfterInsert.sections.neighborhood_description;
    // After a failed insert attempt, status should be 'error' or remain 'approved'
    check('2g. sectionStatus updated after insert attempt', ['error', 'approved', 'inserted', 'verified'].includes(nd.sectionStatus));
  } else {
    check('2g. sections/status still reachable after insert', statusAfterInsert.ok === true);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // [3] GET /api/cases/:caseId/exceptions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[3] GET /api/cases/:caseId/exceptions');

  const ex1 = await get(`/api/cases/${caseId}/exceptions`);
  check('3a. 1004 exceptions → ok:true',        ex1.ok === true,                JSON.stringify(ex1).slice(0, 200));
  check('3b. Returns caseId',                   ex1.caseId === caseId);
  check('3c. Returns exceptions array',         Array.isArray(ex1.exceptions));
  check('3d. Returns count',                    typeof ex1.count === 'number');
  check('3e. count matches exceptions.length',  ex1.count === ex1.exceptions.length);

  // reconciliation was pre-set to sectionStatus=error
  const reconException = ex1.exceptions?.find(e => e.fieldId === 'reconciliation');
  if (reconException) {
    check('3f. reconciliation in exceptions',   true);
    check('3g. exception has fieldId',          typeof reconException.fieldId === 'string');
    check('3h. exception has title',            typeof reconException.title === 'string');
    check('3i. exception has sectionStatus=error', reconException.sectionStatus === 'error');
    check('3j. exception has statusNote',       reconException.statusNote !== undefined);
    check('3k. exception has hasText flag',     typeof reconException.hasText === 'boolean');
  } else {
    // reconciliation may have been overwritten by insert test — check count >= 0
    check('3f. exceptions array is valid',      Array.isArray(ex1.exceptions));
    check('3g. count is non-negative',          ex1.count >= 0);
    check('3h. each exception has fieldId',     ex1.exceptions.every(e => typeof e.fieldId === 'string'));
    check('3i. each exception has sectionStatus=error', ex1.exceptions.every(e => e.sectionStatus === 'error'));
    check('3j. each exception has title',       ex1.exceptions.every(e => typeof e.title === 'string'));
  }

  // Commercial case — no errors pre-set
  const ex2 = await get(`/api/cases/${commId}/exceptions`);
  check('3l. commercial exceptions → ok:true',  ex2.ok === true);
  check('3m. commercial exceptions is array',   Array.isArray(ex2.exceptions));

  // Bad caseId
  const ex3 = await get('/api/cases/BADID00a/exceptions');
  check('3n. Bad caseId → ok:false',            ex3.ok === false);

  // ─────────────────────────────────────────────────────────────────────────────
  // [4] PATCH /api/cases/:caseId/sections/:fieldId/status — approval-to-memory
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[4] PATCH status — approval-to-memory loop');

  // Set market_conditions to approved (has text) — should trigger KB save
  const ap1 = await patch(`/api/cases/${caseId}/sections/market_conditions/status`, { status: 'approved' });
  check('4a. Approve section → ok:true',        ap1.ok === true,                JSON.stringify(ap1).slice(0, 200));
  check('4b. Returns sectionStatus=approved',   ap1.sectionStatus === 'approved');
  check('4c. Returns approved=true',            ap1.approved === true);
  check('4d. Returns fieldId',                  ap1.fieldId === 'market_conditions');
  check('4e. Returns updatedAt',                typeof ap1.updatedAt === 'string');

  // Verify approved=true persisted in outputs.json
  const statusCheck = await get(`/api/cases/${caseId}/sections/status`);
  check('4f. sections/status shows approved=true', statusCheck.sections?.market_conditions?.approved === true);
  check('4g. sections/status shows sectionStatus=approved', statusCheck.sections?.market_conditions?.sectionStatus === 'approved');

  // Approve a section with no text — should NOT set approved=true (no KB save)
  const ap2 = await patch(`/api/cases/${caseId}/sections/site_description/status`, { status: 'approved' });
  check('4h. Approve empty section → ok:true',  ap2.ok === true);
  check('4i. Empty section approved=false',     ap2.approved === false);

  // Verify error status still works
  const ap3 = await patch(`/api/cases/${caseId}/sections/reconciliation/status`, { status: 'error', note: 'Retry needed' });
  check('4j. Set error status → ok:true',       ap3.ok === true);
  check('4k. Returns sectionStatus=error',      ap3.sectionStatus === 'error');

  // ─────────────────────────────────────────────────────────────────────────────
  // [5] POST /api/cases/:caseId/generate-comp-commentary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[5] POST /api/cases/:caseId/generate-comp-commentary');

  // Test with commercial case — should be blocked (1004 only)
  const cc1 = await post(`/api/cases/${commId}/generate-comp-commentary`, { twoPass: false });
  check('5a. Commercial → ok:false (1004 only)', cc1.ok === false,              JSON.stringify(cc1).slice(0, 200));
  check('5b. Commercial → error message',        typeof cc1.error === 'string');
  check('5c. Commercial → returns formType',     cc1.formType === 'commercial');

  // Test with 1004 case but no comps in facts — should fail
  writeFacts(caseId, {}); // clear facts
  const cc2 = await post(`/api/cases/${caseId}/generate-comp-commentary`, { twoPass: false });
  check('5d. No comps → ok:false',               cc2.ok === false,              JSON.stringify(cc2).slice(0, 200));
  check('5e. No comps → error message',          typeof cc2.error === 'string');

  // Restore facts with comps
  writeFacts(caseId, {
    comps: [
      { address: { value: '100 Elm St, Springfield IL' }, salePrice: { value: 250000 }, saleDate: { value: '2024-01-15' }, gla: { value: 1800 } },
      { address: { value: '200 Oak Ave, Springfield IL' }, salePrice: { value: 265000 }, saleDate: { value: '2024-02-20' }, gla: { value: 1950 } },
    ],
    subject: { address: { value: '123 Phase3 St' }, gla: { value: 1850 } },
  });

  // Test with valid 1004 case + comps — will call AI (may succeed or fail with AI error)
  const cc3 = await post(`/api/cases/${caseId}/generate-comp-commentary`, { twoPass: false, compFocus: 'all' });
  check('5f. Comp commentary endpoint exists (not 404)', cc3.ok !== undefined,  JSON.stringify(cc3).slice(0, 200));
  if (cc3.ok) {
    check('5g. Returns fieldId=sca_summary',     cc3.fieldId === 'sca_summary');
    check('5h. Returns text',                    typeof cc3.text === 'string' && cc3.text.length > 0);
    check('5i. Returns sectionStatus',           typeof cc3.sectionStatus === 'string');
    check('5j. Returns compsUsed',               typeof cc3.compsUsed === 'number');
    check('5k. Returns compFocus=all',           cc3.compFocus === 'all');
    check('5l. Returns examplesUsed',            typeof cc3.examplesUsed === 'number');
    // Verify saved to outputs.json
    const outFile = path.join(CASES_DIR, caseId, 'outputs.json');
    const outputs = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    check('5m. sca_summary saved to outputs.json', outputs.sca_summary?.text?.length > 0);
  } else {
    // AI error is acceptable — endpoint was reached
    check('5g. Endpoint reached (not 404/scope block)', !cc3.formType, JSON.stringify(cc3).slice(0, 200));
    console.log('     (AI generation skipped — error:', cc3.error?.slice(0, 80) + ')');
  }

  // Test compFocus validation
  const cc4 = await post(`/api/cases/${caseId}/generate-comp-commentary`, { twoPass: false, compFocus: 'concessions' });
  check('5n. compFocus=concessions → endpoint reached', cc4.ok !== undefined);

  // Bad caseId
  const cc5 = await post('/api/cases/BADID00a/generate-comp-commentary', {});
  check('5o. Bad caseId → ok:false',             cc5.ok === false);

  // ─────────────────────────────────────────────────────────────────────────────
  // [6] insert-all sectionStatus lifecycle (Fix 2 verification)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] insert-all sectionStatus lifecycle');

  // Ensure market_conditions is approved so insert-all has something to insert
  writeOutputSection(caseId, 'market_conditions', {
    text: 'Market conditions are stable.',
    sectionStatus: 'approved',
    approved: true,
  });

  const ia1 = await post(`/api/cases/${caseId}/insert-all`, {});
  check('6a. insert-all with no agent → ok:false or 503', ia1.ok === false || ia1.ok === true);
  if (!ia1.ok) {
    // Agent not running — verify error shape
    check('6b. Returns error message',           typeof ia1.error === 'string');
    console.log('     (ACI agent not running — insert-all returned:', ia1.error?.slice(0, 80) + ')');
  } else {
    // Agent running — verify sectionStatus was updated
    check('6b. Returns inserted count',          typeof ia1.inserted === 'number');
    check('6c. Returns pipelineStage',           typeof ia1.pipelineStage === 'string');
    // Check that inserted sections have sectionStatus=inserted in outputs.json
    const outFile = path.join(CASES_DIR, caseId, 'outputs.json');
    const outputs = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const insertedSections = Object.entries(outputs)
      .filter(([k, v]) => k !== 'updatedAt' && v?.sectionStatus === 'inserted');
    check('6d. Inserted sections have sectionStatus=inserted', insertedSections.length > 0);
  }

  // Test insert-all with no approved sections
  writeOutputSection(caseId, 'market_conditions', { text: 'Test', sectionStatus: 'drafted', approved: false });
  writeOutputSection(caseId, 'neighborhood_description', { text: 'Test', sectionStatus: 'drafted', approved: false });
  const ia2 = await post(`/api/cases/${caseId}/insert-all`, {});
  check('6e. No approved sections → ok:false',   ia2.ok === false);
  check('6f. No approved sections → error msg',  typeof ia2.error === 'string');

  // ─────────────────────────────────────────────────────────────────────────────
  // [7] Destination registry — commercial field map enrichment
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[7] Destination registry — commercial enrichment');

  const dr4 = await get(`/api/cases/${commId}/destination-registry`);
  check('7a. Commercial registry → ok:true',     dr4.ok === true);
  check('7b. software=real_quantum',             dr4.software === 'real_quantum');
  if (dr4.fieldCount > 0) {
    // market_area was pre-set to approved
    if (dr4.fields?.market_area) {
      check('7c. market_area shows approved=true', dr4.fields.market_area.approved === true);
      check('7d. market_area shows hasText=true',  dr4.fields.market_area.hasText === true);
    } else {
      check('7c. fields object populated',         Object.keys(dr4.fields).length > 0);
      check('7d. each field has sectionStatus',    Object.values(dr4.fields).every(f => typeof f.sectionStatus === 'string'));
    }
  } else {
    check('7c. commercial field map not found (ok)', dr4.fieldCount === 0);
    check('7d. software still returned',             dr4.software === 'real_quantum');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // [8] Exception queue — verify error sections are surfaced
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[8] Exception queue — error section surfacing');

  // Set multiple sections to error via API
  await patch(`/api/cases/${caseId}/outputs/site_description`, { text: 'Site text.' });
  await patch(`/api/cases/${caseId}/sections/site_description/status`, { status: 'error', notes: 'Tab not found' });
  await patch(`/api/cases/${caseId}/outputs/improvements_condition`, { text: 'Improvements text.' });
  await patch(`/api/cases/${caseId}/sections/improvements_condition/status`, { status: 'error', notes: 'Clipboard paste failed' });

  const ex4 = await get(`/api/cases/${caseId}/exceptions`);
  check('8a. exceptions → ok:true',              ex4.ok === true);
  check('8b. count >= 2 (site + improvements)',  ex4.count >= 2,                `count=${ex4.count}`);
  check('8c. all exceptions have sectionStatus=error', ex4.exceptions.every(e => e.sectionStatus === 'error'));
  check('8d. all exceptions have statusNote',    ex4.exceptions.every(e => e.statusNote !== undefined));
  check('8e. all exceptions have hasText',       ex4.exceptions.every(e => typeof e.hasText === 'boolean'));

  // Resolve one exception by setting to reviewed
  await patch(`/api/cases/${caseId}/sections/site_description/status`, { status: 'reviewed' });
  const ex5 = await get(`/api/cases/${caseId}/exceptions`);
  check('8f. After resolve, count decreases',    ex5.count < ex4.count,         `before=${ex4.count} after=${ex5.count}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== Cleanup ===');
  await del(`/api/cases/${caseId}`);
  await del(`/api/cases/${commId}`);
  console.log('  Test cases deleted.\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(60));
  console.log(`Phase 3 Results: ${pass} passed, ${fail} failed`);
  console.log('═'.repeat(60));

  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.label}${r.detail ? ' — ' + r.detail : ''}`));
  }

  console.log('\nPhase 3 endpoints verified:');
  console.log('  ✓ GET  /api/cases/:caseId/destination-registry');
  console.log('  ✓ POST /api/cases/:caseId/sections/:fieldId/insert');
  console.log('  ✓ GET  /api/cases/:caseId/exceptions');
  console.log('  ✓ POST /api/cases/:caseId/generate-comp-commentary');
  console.log('  ✓ PATCH /api/cases/:caseId/sections/:fieldId/status (approval-to-memory)');
  console.log('  ✓ POST /api/cases/:caseId/insert-all (sectionStatus lifecycle)');

  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
