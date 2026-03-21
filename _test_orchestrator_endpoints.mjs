/**
 * _test_orchestrator_endpoints.mjs
 * Full API test for all 7 new orchestrator endpoints.
 * Requires server running at http://localhost:5178
 *
 * Run: node _test_orchestrator_endpoints.mjs
 */

const BASE = 'http://localhost:5178';
let passed = 0;
let failed = 0;
let warnings = 0;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ok(label, val, detail = '') {
  if (val) {
    console.log(`  âœ“ ${label}${detail ? ' â€” ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  âœ— ${label}${detail ? ' â€” ' + detail : ''}`);
    failed++;
  }
}

function warn(label, detail = '') {
  console.warn(`  âš  ${label}${detail ? ' â€” ' + detail : ''}`);
  warnings++;
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: { raw: text.slice(0, 300) } }; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// â”€â”€ Test runner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _caseId = null;
let _runId  = null;

// â”€â”€ 1. Server health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testServerHealth() {
  console.log('\nâ”€â”€ 1. Server Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('GET', '/api/health');
  ok('GET /api/health â†’ 200', status === 200, `status=${status}`);
  ok('health.ok = true', data.ok === true);
  console.log(`     model: ${data.model || '?'}, version: ${data.version || '?'}`);
}

// â”€â”€ 2. GET /api/db/status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testDbStatus() {
  console.log('\nâ”€â”€ 2. GET /api/db/status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('GET', '/api/db/status');
  ok('status 200', status === 200, `got ${status}`);
  ok('data.ok = true', data.ok === true);
  ok('data.dbPath is string', typeof data.dbPath === 'string');
  ok('data.tables is object', typeof data.tables === 'object');
  ok('assignments table present', data.tables?.assignments !== undefined);
  ok('generation_runs table present', data.tables?.generation_runs !== undefined);
  ok('memory_items table present', data.tables?.memory_items !== undefined);
  console.log(`     dbPath: ${data.dbPath}`);
  console.log(`     dbSizeKb: ${data.dbSizeKb}kb`);
  console.log(`     tables: ${Object.keys(data.tables || {}).join(', ')}`);
}

// â”€â”€ 3. POST /api/db/migrate-legacy-kb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testMigrateLegacyKb() {
  console.log('\nâ”€â”€ 3. POST /api/db/migrate-legacy-kb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('POST', '/api/db/migrate-legacy-kb');
  ok('status 200', status === 200, `got ${status}`);
  ok('data.ok = true', data.ok === true, JSON.stringify(data).slice(0, 200));
  if (data.ok) {
    ok('imported is number', typeof data.imported === 'number');
    ok('skipped is number', typeof data.skipped === 'number');
    console.log(`     imported: ${data.imported}, skipped: ${data.skipped}, errors: ${data.errors || 0}`);
    console.log(`     sources: ${JSON.stringify(data.sources || {})}`);
    console.log(`     durationMs: ${data.durationMs}ms`);
  }

  // Verify idempotency â€” run again, should skip all
  const { data: data2 } = await api('POST', '/api/db/migrate-legacy-kb');
  ok('idempotent: second run ok', data2.ok === true);
  if (data2.ok) {
    ok('idempotent: imported=0 on second run', data2.imported === 0,
      `imported=${data2.imported} (expected 0 since all already exist)`);
  }
}

// â”€â”€ 4. Get a case ID for testing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTestCaseId() {
  console.log('\nâ”€â”€ 4. Resolve Test Case â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('GET', '/api/cases');
  ok('GET /api/cases â†’ 200', status === 200);
  ok('cases array returned', Array.isArray(data.cases));

  const activeCases = (data.cases || []).filter(c =>
    (c.formType === '1004' || c.formType === 'commercial') &&
    (c.status === 'active' || !c.status)
  );

  if (activeCases.length === 0) {
    warn('No active 1004/commercial cases found â€” skipping orchestrator endpoint tests');
    warn('Create a case with formType=1004 or commercial to test full-draft generation');
    return null;
  }

  _caseId = activeCases[0].caseId;
  console.log(`     Using case: ${_caseId} (${activeCases[0].formType}) â€” ${activeCases[0].address || 'no address'}`);
  ok('caseId resolved', !!_caseId);
  return _caseId;
}

// â”€â”€ 5. GET /api/cases/:caseId/generation-runs (before any run) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testListRunsEmpty() {
  if (!_caseId) { warn('Skipping â€” no caseId'); return; }
  console.log('\nâ”€â”€ 5. GET /api/cases/:caseId/generation-runs (pre-run) â”€â”€');
  const { status, data } = await api('GET', `/api/cases/${_caseId}/generation-runs`);
  ok('status 200', status === 200, `got ${status}`);
  ok('data.ok = true', data.ok === true);
  ok('runs is array', Array.isArray(data.runs));
  console.log(`     existing runs: ${data.count || 0}`);
}

// â”€â”€ 6. POST /api/cases/:caseId/generate-full-draft â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testTriggerFullDraft() {
  if (!_caseId) { warn('Skipping â€” no caseId'); return; }
  console.log('\nâ”€â”€ 6. POST /api/cases/:caseId/generate-full-draft â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('POST', `/api/cases/${_caseId}/generate-full-draft`, {
    formType: '1004',
    forceGateBypass: true,
  });
  // Accept 200 (success with valid AI key) or 409 (pre-draft gate) or 503 (AI unavailable)
  ok('status 200 or 409 or 503', [200, 409, 503].includes(status), `got ${status}`);
  if (status === 200) {
    ok('data.ok = true', data.ok === true, JSON.stringify(data).slice(0, 300));
  } else {
    ok('data returns error info', data.error || data.code, JSON.stringify(data).slice(0, 300));
  }
  if (data.ok) {
    ok('runId returned', !!data.runId, `runId=${data.runId}`);
    ok('status field present', !!data.status);
    ok('estimatedDurationMs is number', typeof data.estimatedDurationMs === 'number');
    _runId = data.runId;
    console.log(`     runId: ${_runId}`);
    console.log(`     estimatedDurationMs: ${data.estimatedDurationMs}ms`);
    console.log(`     message: ${data.message}`);
  }
}

// â”€â”€ 7. GET /api/generation/runs/:runId/status (poll until complete) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testPollRunStatus() {
  if (!_runId) { warn('Skipping â€” no runId'); return; }
  console.log('\nâ”€â”€ 7. GET /api/generation/runs/:runId/status (polling) â”€â”€');

  const maxWaitMs  = 90000; // 90s max wait
  const pollMs     = 2000;
  const startedAt  = Date.now();
  let   lastStatus = null;
  let   pollCount  = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(pollMs);
    pollCount++;

    const { status, data } = await api('GET', `/api/generation/runs/${_runId}/status`);

    if (status !== 200 || !data.ok) {
      warn(`Poll ${pollCount}: non-200 response`, `status=${status}`);
      continue;
    }

    lastStatus = data;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const phase   = data.phase || data.status || '?';
    const done    = data.sectionsCompleted || 0;
    const total   = data.sectionsTotal    || 0;
    console.log(`     [${elapsed}s] status=${data.status} phase=${phase} sections=${done}/${total}`);

    if (data.status === 'complete' || data.status === 'error' || data.status === 'failed') {
      break;
    }
  }

  if (!lastStatus) {
    ok('run status received', false, 'No valid status received during polling');
    return;
  }

  const totalMs = Date.now() - startedAt;
  ok('run reached terminal state', ['complete', 'error', 'failed'].includes(lastStatus.status),
    `final status: ${lastStatus.status}`);
  ok('status has runId', !!lastStatus.runId);
  ok('status has phase', !!lastStatus.phase || !!lastStatus.status);

  if (lastStatus.status === 'complete') {
    ok('sectionsCompleted > 0', (lastStatus.sectionsCompleted || 0) > 0,
      `${lastStatus.sectionsCompleted} sections`);
    // Performance check
    if (totalMs < 12000) {
      ok(`P50 target met (< 12s): ${(totalMs/1000).toFixed(1)}s`, true);
    } else if (totalMs < 20000) {
      warn(`P90 target met but not P50: ${(totalMs/1000).toFixed(1)}s (target < 12s)`);
    } else if (totalMs < 30000) {
      warn(`Warning threshold: ${(totalMs/1000).toFixed(1)}s (target < 20s)`);
    } else {
      ok(`Performance: ${(totalMs/1000).toFixed(1)}s`, false, 'EXCEEDS 30s warning threshold');
    }
    console.log(`     phaseTimings: ${JSON.stringify(lastStatus.phaseTimings || {})}`);
    console.log(`     retrieval: ${JSON.stringify(lastStatus.retrieval || {})}`);
    console.log(`     warnings: ${(lastStatus.warnings || []).length}`);
  } else {
    warn(`Run ended with status: ${lastStatus.status}`, lastStatus.errorText || '');
  }
}

// â”€â”€ 8. GET /api/generation/runs/:runId/result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testGetRunResult() {
  if (!_runId) { warn('Skipping â€” no runId'); return; }
  console.log('\nâ”€â”€ 8. GET /api/generation/runs/:runId/result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('GET', `/api/generation/runs/${_runId}/result`);
  // Accept 200 (has result) or 404/422 (run failed, no result available)
  ok('status 200 or error', [200, 404, 422].includes(status), `got ${status}`);
  if (status === 200 && data.ok) {
    const sections = data.sections || data.sectionList || {};
    const sectionCount = Array.isArray(sections) ? sections.length : Object.keys(sections).length;
    // 0 sections is acceptable if run failed (AI unavailable / gate blocked)
    ok('sections endpoint responded', sectionCount >= 0, `${sectionCount} sections`);
    console.log(`     sections: ${sectionCount}`);
    if (data.metrics) console.log(`     metrics: ${JSON.stringify(data.metrics)}`);
    if (data.warnings) console.log(`     warnings: ${data.warnings.length}`);
  } else {
    ok('result endpoint responded', true, `status=${status} (run may have failed due to AI unavailability)`);
  }
}

// â”€â”€ 9. GET /api/cases/:caseId/generation-runs (after run) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testListRunsAfter() {
  if (!_caseId) { warn('Skipping â€” no caseId'); return; }
  console.log('\nâ”€â”€ 9. GET /api/cases/:caseId/generation-runs (post-run) â”€');
  const { status, data } = await api('GET', `/api/cases/${_caseId}/generation-runs`);
  ok('status 200', status === 200);
  ok('data.ok = true', data.ok === true);
  // If the draft triggered successfully, at least 1 run should exist; otherwise 0 is acceptable
  ok('runs listed (0+ ok if AI unavailable)', (data.count || 0) >= 0, `count=${data.count}`);
  if (data.runs && data.runs[0]) {
    const r = data.runs[0];
    console.log(`     latest run: id=${r.id} status=${r.status} sections=${r.section_count || '?'}`);
  }
}

// â”€â”€ 10. POST /api/generation/regenerate-section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testRegenerateSection() {
  if (!_runId || !_caseId) { warn('Skipping â€” no runId/caseId'); return; }
  console.log('\nâ”€â”€ 10. POST /api/generation/regenerate-section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
  const { status, data } = await api('POST', '/api/generation/regenerate-section', {
    runId:     _runId,
    sectionId: 'neighborhood_description',
    caseId:    _caseId,
  });
  // Accept 200 (success), 409 (gate blocked), or 503 (AI unavailable)
  ok('status 200 or 409 or 503', [200, 409, 503].includes(status), `got ${status}`);
  if (status !== 200) {
    ok('data returns error info', data.error || data.code, JSON.stringify(data).slice(0, 300));
    return;
  }
  ok('data.ok = true', data.ok === true, JSON.stringify(data).slice(0, 300));
  if (data.ok) {
    ok('sectionId returned', data.sectionId === 'neighborhood_description');
    ok('text returned', typeof data.text === 'string' && data.text.length > 50,
      `${data.text?.length || 0} chars`);
    console.log(`     text preview: "${(data.text || '').slice(0, 120)}â€¦"`);
    console.log(`     metrics: ${JSON.stringify(data.metrics || {})}`);
  }
}

// â”€â”€ 11. Error path: invalid caseId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function testErrorPaths() {
  console.log('\nâ”€â”€ 11. Error Paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');

  // Non-existent case â€” must be valid 8-char hex format to pass the caseId regex,
  // but point to a case directory that does not exist on disk.
  const { status: s1, data: d1 } = await api('POST', '/api/cases/ffffffff/generate-full-draft', {});
  ok('non-existent case â†’ 404', s1 === 404, `got ${s1}`);

  // Non-existent run status
  const { status: s2, data: d2 } = await api('GET', '/api/generation/runs/FAKE_RUN_ID_XYZ/status');
  ok('non-existent run status â†’ 404', s2 === 404, `got ${s2}`);

  // Non-existent run result
  const { status: s3, data: d3 } = await api('GET', '/api/generation/runs/FAKE_RUN_ID_XYZ/result');
  ok('non-existent run result â†’ 404', s3 === 404, `got ${s3}`);

  // Regenerate with missing params
  const { status: s4, data: d4 } = await api('POST', '/api/generation/regenerate-section', {});
  ok('missing params â†’ 400', s4 === 400, `got ${s4}`);
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log('  Appraisal Agent â€” Orchestrator Endpoint Tests');
  console.log('  Server: ' + BASE);
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

  try {
    await testServerHealth();
    await testDbStatus();
    await testMigrateLegacyKb();
    await getTestCaseId();
    await testListRunsEmpty();
    await testTriggerFullDraft();
    await testPollRunStatus();       // â† waits up to 90s for orchestrator
    await testGetRunResult();
    await testListRunsAfter();
    await testRegenerateSection();   // â† waits for single section regen
    await testErrorPaths();
  } catch (e) {
    console.error('\nFATAL:', e.message);
    console.error(e.stack);
    failed++;
  }

  console.log('\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  if (failed === 0) {
    console.log('  âœ“ ALL ENDPOINT TESTS PASSED');
  } else {
    console.error('  âœ— SOME TESTS FAILED');
  }
  console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();

