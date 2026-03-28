/**
 * _test_scope_enforcement.mjs
 * ============================
 * Scope enforcement API tests — current scope config:
 *   Active:   1004, 1025, 1073, commercial
 *   Deferred: 1004c
 *
 * Run: node _test_scope_enforcement.mjs
 */

const BASE = 'http://localhost:5178';
let passed = 0, failed = 0;
let createdCaseId = null;

function pass(label) { console.log(`  ✅ PASS  ${label}`); passed++; }
function fail(label, detail) { console.log(`  ❌ FAIL  ${label}`); if (detail) console.log(`         → ${detail}`); failed++; }

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ...json };
}

async function del(path) {
  const r = await fetch(BASE + path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
  return r.json().catch(() => ({}));
}

async function get(path) {
  const r = await fetch(BASE + path);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, ...json };
}

// ── TEST 1: GET /api/forms — scope fields present ─────────────────────────────
async function test_get_forms() {
  console.log('\n[1] GET /api/forms — scope fields');
  const d = await get('/api/forms');
  if (!d.ok) return fail('ok=true', JSON.stringify(d));

  // Current active: 1004, 1025, 1073, commercial (use activeScope for string check)
  const ACTIVE = ['1004', '1025', '1073', 'commercial'];
  const DEFERRED = ['1004c'];

  if (Array.isArray(d.activeScope) && ACTIVE.every(f => d.activeScope.includes(f)))
    pass(`activeScope includes ${ACTIVE.join(', ')}`);
  else fail('activeForms check', JSON.stringify(d.activeScope));

  if (Array.isArray(d.deferredScope) && DEFERRED.every(f => d.deferredScope.includes(f)))
    pass(`deferredScope includes ${DEFERRED.join(', ')}`);
  else fail('deferredForms check', JSON.stringify(d.deferredScope));

  const f1004 = d.forms?.find(f => f.id === '1004');
  if (f1004?.scope === 'active' && f1004?.supported === true)
    pass('1004 form has scope=active, supported=true');
  else fail('1004 form scope/supported', JSON.stringify(f1004));

  // 1025 should now be active
  const f1025 = d.forms?.find(f => f.id === '1025');
  if (f1025?.scope === 'active' && f1025?.supported === true)
    pass('1025 form has scope=active, supported=true');
  else fail('1025 form scope/supported', JSON.stringify(f1025));
}

// ── TEST 2: POST /api/cases/create — only 1004c is deferred ──────────────────
async function test_create_case_deferred() {
  console.log('\n[2] POST /api/cases/create — 1004c (deferred) is blocked');
  const d = await post('/api/cases/create', { address: '123 Test St', formType: '1004c' });
  if (d.status === 400 && d.supported === false && d.scope === 'deferred')
    pass('formType=1004c → 400 {supported:false, scope:\'deferred\'}');
  else fail('formType=1004c blocked', `status=${d.status} supported=${d.supported} scope=${d.scope}`);
}

// ── TEST 3: POST /api/cases/create — active forms allowed ─────────────────────
async function test_create_case_active() {
  console.log('\n[3] POST /api/cases/create — active forms allowed');
  const testForms = ['1004', 'commercial'];
  for (const ft of testForms) {
    const d = await post('/api/cases/create', { address: '456 Active St', formType: ft });
    if (d.ok && d.caseId) {
      pass(`formType=${ft} → 200 ok, caseId=${d.caseId}`);
      if (ft === '1004') createdCaseId = d.caseId;
      else await del(`/api/cases/${d.caseId}`); // clean up non-1004 test cases
    } else {
      fail(`formType=${ft} allowed`, `status=${d.status} ok=${d.ok} error=${d.error}`);
    }
  }
}

// ── TEST 4: GET /api/cases/:caseId — active case has no scopeWarning ──────────
async function test_get_active_case() {
  console.log('\n[4] GET /api/cases/:caseId — active case scope status');
  if (!createdCaseId) { fail('skipped — no caseId from test 3'); return; }
  const d = await get('/api/cases/' + createdCaseId);
  if (d.ok && (d.scopeStatus === 'active' || d.supported !== false))
    pass(`caseId=${createdCaseId} → not scope-blocked`);
  else fail('active case not scope-blocked', JSON.stringify(d).slice(0, 200));
}

// ── TEST 5: POST /api/generate — deferred form (1004c) blocked ───────────────
async function test_generate_deferred() {
  console.log('\n[5] POST /api/generate — 1004c (deferred) blocked');
  const d = await post('/api/generate', { formType: '1004c', prompt: 'test', fieldId: 'neighborhood_description' });
  if (d.status === 400 && d.supported === false && d.scope === 'deferred')
    pass('formType=1004c → 400 {supported:false, scope:\'deferred\'}');
  else fail('formType=1004c generate blocked', `status=${d.status} supported=${d.supported} scope=${d.scope}`);
}

// ── TEST 6: POST /api/generate — active form passes scope check ───────────────
async function test_generate_active() {
  console.log('\n[6] POST /api/generate — 1004 passes scope check');
  const d = await post('/api/generate', { formType: '1004', prompt: 'test', fieldId: 'neighborhood_description', caseId: createdCaseId || '' });
  if (d.supported === false && d.scope === 'deferred')
    fail('1004 should NOT be scope-blocked', JSON.stringify(d));
  else
    pass('1004 not scope-blocked (may fail for other reasons — scope check passed)');
}

// ── TEST 7: POST /api/generate — 1004c deferred also blocked ─────────────────
async function test_workflow_run_deferred() {
  console.log('\n[7] POST /api/generate — 1004c (deferred) blocked via generate endpoint');
  const d = await post('/api/generate', { formType: '1004c', prompt: 'neighborhood test', fieldId: 'neighborhood_description' });
  if (d.status === 400 && d.supported === false && d.scope === 'deferred')
    pass('formType=1004c → 400 {supported:false, scope:\'deferred\'} via /api/generate');
  else fail('formType=1004c generate blocked', `status=${d.status} supported=${d.supported} scope=${d.scope}`);
}

// ── TEST 8: POST /api/workflow/run — active form passes scope ─────────────────
async function test_workflow_run_active() {
  console.log('\n[8] POST /api/workflow/run — active forms pass scope check');
  const d = await post('/api/workflow/run', { formType: '1004', fieldId: 'neighborhood_description', facts: {} });
  if (d.supported === false && d.scope === 'deferred')
    fail('1004 should NOT be scope-blocked', JSON.stringify(d));
  else
    pass('1004 not scope-blocked (may fail for other reasons — scope check passed)');
}

// ── TEST 9: GET /api/forms/:formType — individual form configs ────────────────
async function test_get_form_config() {
  console.log('\n[9] GET /api/forms/:formType — individual form configs');
  for (const ft of ['1004', 'commercial', '1025', '1073']) {
    const d = await get('/api/forms/' + ft);
    const id = d.config?.id ?? d.id;
    if (d.ok && id === ft)
      pass(`GET /api/forms/${ft} → ok, id=${id}`);
    else fail(`GET /api/forms/${ft}`, `ok=${d.ok} id=${id}`);
  }
}

// ── TEST 10: Cleanup ──────────────────────────────────────────────────────────
async function test_cleanup() {
  console.log('\n[10] Cleanup');
  if (createdCaseId) {
    await del(`/api/cases/${createdCaseId}`);
    pass(`Deleted test case ${createdCaseId}`);
  } else {
    pass('No test cases to clean up');
  }
}

// ── RUN ALL TESTS ─────────────────────────────────────────────────────────────
console.log('='.repeat(60));
console.log('Appraisal Agent — Scope Enforcement API Tests');
console.log('Current scope: active=[1004,1025,1073,commercial] deferred=[1004c]');
console.log('='.repeat(60));

await test_get_forms();
await test_create_case_deferred();
await test_create_case_active();
await test_get_active_case();
await test_generate_deferred();
await test_generate_active();
await test_workflow_run_deferred();
await test_workflow_run_active();
await test_get_form_config();
await test_cleanup();

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
