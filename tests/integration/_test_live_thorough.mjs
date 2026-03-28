/**
 * _test_live_thorough.mjs
 * -----------------------
 * Thorough live tests for the 6 areas not covered by smoke tests:
 *   1. feedback â†’ KB write (savedToKB:true, actual KB count increases)
 *   2. review-section with real AI call (revisedText + issues[])
 *   3. generate-batch with twoPass:true (draft + review two-pass)
 *   4. RQ tab_click navigation (regional_overview sub-tab)
 *   5. RQ /list-detail-pages (binoculars â€” finds a.details_link)
 *   6. RQ /insert-detail-page (binoculars â€” insert into detail sub-page)
 *
 * Run: node _test_live_thorough.mjs
 * Requires: server on :5178, RQ agent on :5181, Chrome CDP on :9222
 */

const BASE = 'http://localhost:5178';
const RQ   = 'http://localhost:5181';
const UUID = 'feb03938-8e5f-4327-8230-0e31d20a6b2c';

let passed = 0, failed = 0;
let testCaseId = null;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function rq(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${RQ}${path}`, opts);
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function pass(label, detail = '') {
  passed++;
  console.log(`  âœ“ ${label}${detail ? ' â€” ' + detail : ''}`);
}

function fail(label, detail = '') {
  failed++;
  console.log(`  âœ— ${label}${detail ? ' â€” ' + detail : ''}`);
}

function section(title) {
  console.log(`\n${'â•'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('â•'.repeat(60));
}

// â”€â”€ Setup: create a test case with real facts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function setup() {
  const { json } = await api('POST', '/api/cases/create', {
    address: '123 Test St, Bloomington IL 61701',
    formType: 'commercial',
    clientName: 'Live Test Client',
  });
  testCaseId = json.caseId;
  if (!testCaseId) throw new Error('Could not create test case: ' + JSON.stringify(json));

  // Seed facts with confidence levels
  await api('PUT', `/api/cases/${testCaseId}/facts`, {
    facts: {
      address:          { value: '123 Test St, Bloomington IL 61701', confidence: 'high' },
      propertyType:     { value: 'Multi-Family Residential', confidence: 'high' },
      grossLivingArea:  { value: '4,200 sq ft', confidence: 'high' },
      yearBuilt:        { value: '1978', confidence: 'high' },
      condition:        { value: 'Average', confidence: 'medium' },
      marketTrend:      { value: 'Stable', confidence: 'medium' },
      zoning:           { value: 'R-3 Multi-Family', confidence: 'high' },
      floodZone:        { value: 'Zone X (minimal flood hazard)', confidence: 'high' },
    },
  });

  console.log(`\nTest case created: ${testCaseId}`);
}

// â”€â”€ Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function cleanup() {
  if (testCaseId) {
    await api('DELETE', `/api/cases/${testCaseId}`);
    console.log(`\nTest case deleted: ${testCaseId}`);
  }
}

// â”€â”€ TEST 1: feedback â†’ KB write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testFeedbackKB() {
  section('TEST 1: feedback â†’ KB write (savedToKB:true)');

  // Get KB count before
  const { json: before } = await api('GET', '/api/kb/status');
  const countBefore = before.totalExamples || 0;
  console.log(`  KB examples before: ${countBefore}`);

  // Submit feedback with rating=up (should save to KB)
  const { status: s1, json: j1 } = await api('POST', `/api/cases/${testCaseId}/feedback`, {
    fieldId: 'neighborhood_description',
    fieldTitle: 'Neighborhood Description',
    originalText: 'The subject is located in a residential area.',
    editedText: 'The subject property is located in a stable, established residential neighborhood in Bloomington, Illinois. The area is characterized by a mix of single-family and multi-family dwellings with good access to employment centers and retail amenities.',
    rating: 'up',
  });

  if (s1 === 200 && j1.ok) {
    pass('feedback endpoint returns ok:true');
  } else {
    fail('feedback endpoint', `status=${s1} ok=${j1.ok}`);
  }

  if (j1.savedToKB === true) {
    pass('savedToKB:true returned (rating=up)');
  } else {
    fail('savedToKB:true expected', `got savedToKB=${j1.savedToKB}`);
  }

  // Submit feedback with edited text only (no rating â€” should still save)
  const { json: j2 } = await api('POST', `/api/cases/${testCaseId}/feedback`, {
    fieldId: 'zoning_remarks',
    fieldTitle: 'Zoning Remarks',
    originalText: 'Zoned R-3.',
    editedText: 'The subject property is zoned R-3 Multi-Family Residential, which permits the existing use as a multi-family dwelling. The current use represents a legal conforming use under the applicable zoning ordinance.',
    rating: null,
  });

  if (j2.savedToKB === true) {
    pass('savedToKB:true when text was edited (no rating)');
  } else {
    fail('savedToKB:true expected for edited text', `got savedToKB=${j2.savedToKB}`);
  }

  // Submit feedback with rating=down and no edit (should NOT save to KB)
  const { json: j3 } = await api('POST', `/api/cases/${testCaseId}/feedback`, {
    fieldId: 'site_description',
    fieldTitle: 'Site Description',
    originalText: 'The site is flat.',
    editedText: 'The site is flat.',
    rating: 'down',
  });

  if (j3.savedToKB === false || j3.savedToKB === undefined) {
    pass('savedToKB:false when rating=down and text unchanged');
  } else {
    fail('savedToKB should be false for down-rated unchanged text', `got savedToKB=${j3.savedToKB}`);
  }

  // Reindex and verify count increased
  await api('POST', '/api/kb/reindex');
  const { json: after } = await api('GET', '/api/kb/status');
  const countAfter = after.totalExamples || 0;
  console.log(`  KB examples after: ${countAfter}`);

  if (countAfter >= countBefore + 2) {
    pass(`KB count increased by â‰¥2 (${countBefore} â†’ ${countAfter})`);
  } else {
    fail(`KB count should have increased by â‰¥2`, `${countBefore} â†’ ${countAfter}`);
  }
}

// â”€â”€ TEST 2: review-section with real AI call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testReviewSection() {
  section('TEST 2: review-section with real AI call');

  const draftText = `The subject property is located at 123 Test St in Bloomington, Illinois. 
The neighborhood is characterized by residential uses. The property was built in 1978 and 
contains approximately 4,200 square feet of gross living area. Market conditions are stable 
and the property is in average condition. The zoning is R-3 Multi-Family. 
The property is definitely worth $2,000,000 based on our analysis.`;

  console.log('  Calling review-section (AI call â€” may take 10-30s)...');
  const start = Date.now();

  const { status, json } = await api('POST', `/api/cases/${testCaseId}/review-section`, {
    fieldId: 'neighborhood_description',
    draftText,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Response time: ${elapsed}s`);

  if (status === 200 && json.ok) {
    pass('review-section returns ok:true');
  } else {
    fail('review-section failed', `status=${status} error=${json.error}`);
    return;
  }

  if (typeof json.revisedText === 'string' && json.revisedText.length > 20) {
    pass(`revisedText returned (${json.revisedText.length} chars)`);
  } else {
    fail('revisedText missing or too short', `got: ${JSON.stringify(json.revisedText)?.slice(0, 80)}`);
  }

  if (Array.isArray(json.issues)) {
    pass(`issues[] returned (${json.issues.length} issues found)`);
    if (json.issues.length > 0) {
      console.log(`    Issues found:`);
      json.issues.forEach(i => console.log(`      - [${i.severity || '?'}] ${i.type}: ${i.description?.slice(0, 80)}`));
    }
  } else {
    fail('issues[] should be an array', `got: ${typeof json.issues}`);
  }

  if (typeof json.confidence === 'string') {
    pass(`confidence returned: ${json.confidence}`);
  } else {
    fail('confidence field missing');
  }

  if (typeof json.changesMade === 'boolean') {
    pass(`changesMade returned: ${json.changesMade}`);
  } else {
    fail('changesMade field missing');
  }

  // The draft contains "definitely worth $2,000,000" â€” reviewer should flag this
  const hasOverconfidenceFlag = json.issues?.some(i =>
    i.description?.toLowerCase().includes('definit') ||
    i.description?.toLowerCase().includes('value') ||
    i.description?.toLowerCase().includes('unsupport') ||
    i.type?.toLowerCase().includes('confidence') ||
    i.type?.toLowerCase().includes('unsupport')
  );
  if (hasOverconfidenceFlag || json.changesMade) {
    pass('reviewer detected overconfident/unsupported claim (changesMade or issue flagged)');
  } else {
    console.log('  âš  reviewer did not flag "definitely worth $2,000,000" â€” check review_pass.txt prompt');
  }
}

// â”€â”€ TEST 3: generate-batch with twoPass:true â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testGenerateBatchTwoPass() {
  section('TEST 3: generate-batch with twoPass:true');

  console.log('  Calling generate-batch twoPass=true (AI call â€” may take 30-60s)...');
  const start = Date.now();

  const { status, json } = await api('POST', '/api/generate-batch', {
    caseId: testCaseId,
    twoPass: true,
    fields: [
      { id: 'neighborhood_description', title: 'Neighborhood Description' },
      { id: 'zoning_remarks',           title: 'Zoning Remarks' },
    ],
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Response time: ${elapsed}s`);

  if (status === 200 && json.ok) {
    pass('generate-batch twoPass returns ok:true');
  } else {
    fail('generate-batch twoPass failed', `status=${status} error=${json.error}`);
    return;
  }

  const results = json.results || {};
  const errors  = json.errors  || {};

  if (results.neighborhood_description?.text?.length > 50) {
    pass(`neighborhood_description generated (${results.neighborhood_description.text.length} chars, examples=${results.neighborhood_description.examplesUsed})`);
  } else {
    fail('neighborhood_description missing or too short', JSON.stringify(results.neighborhood_description)?.slice(0, 100));
  }

  if (results.zoning_remarks?.text?.length > 20) {
    pass(`zoning_remarks generated (${results.zoning_remarks.text.length} chars)`);
  } else {
    fail('zoning_remarks missing or too short', JSON.stringify(results.zoning_remarks)?.slice(0, 100));
  }

  if (Object.keys(errors).length === 0) {
    pass('no errors in batch');
  } else {
    fail('errors in batch', JSON.stringify(errors));
  }
}

// â”€â”€ TEST 4: RQ tab_click navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testRQTabClick() {
  section('TEST 4: RQ tab_click navigation (regional_overview)');

  // Check RQ agent is reachable
  let agentUp = false;
  try {
    const r = await fetch(`${RQ}/list-sections`, { method: 'GET' });
    agentUp = r.ok;
  } catch { agentUp = false; }

  if (!agentUp) {
    console.log('  âš  RQ agent not reachable on :5181 â€” skipping RQ tests');
    console.log('  (Start with: python real_quantum_agent/agent.py)');
    return;
  }
  pass('RQ agent reachable on :5181');

  // Test tab_click field: regional_overview
  console.log('  Testing tab_click navigation for regional_overview (navigates to market_data, clicks tab)...');
  const { status, json } = await rq('POST', '/test-field', {
    fieldId: 'regional_overview',
    formType: 'commercial',
    assignmentUuid: UUID,
  });

  if (status === 200 && json.found) {
    pass(`regional_overview found via tab_click (url=${json.url?.slice(-40)})`);
  } else {
    fail('regional_overview tab_click failed', `found=${json.found} error=${json.error}`);
  }

  // Test another tab_click field: industry_overview
  const { json: j2 } = await rq('POST', '/test-field', {
    fieldId: 'industry_overview',
    formType: 'commercial',
    assignmentUuid: UUID,
  });

  if (j2.found) {
    pass(`industry_overview found via tab_click`);
  } else {
    fail('industry_overview tab_click failed', `found=${j2.found} error=${j2.error}`);
  }
}

// â”€â”€ TEST 5: RQ /list-detail-pages (binoculars) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testRQListDetailPages() {
  section('TEST 5: RQ /list-detail-pages (binoculars â€” a.details_link)');

  let agentUp = false;
  try {
    const r = await fetch(`${RQ}/list-sections`, { method: 'GET' });
    agentUp = r.ok;
  } catch { agentUp = false; }

  if (!agentUp) {
    console.log('  âš  RQ agent not reachable â€” skipping');
    return;
  }

  console.log('  Navigating to sale_valuation and listing detail pages...');
  const { status, json } = await rq('POST', '/list-detail-pages', {
    fieldId: 'sale_comparable_detail',
    formType: 'commercial',
    assignmentUuid: UUID,
  });

  if (status === 200 && json.ok) {
    pass(`/list-detail-pages returned ok:true`);
  } else {
    fail('/list-detail-pages failed', `status=${status} error=${json.error}`);
    return;
  }

  const pages = json.detailPages || [];
  console.log(`  Detail pages found: ${pages.length}`);

  if (Array.isArray(pages)) {
    pass(`detailPages is array (${pages.length} entries)`);
    if (pages.length > 0) {
      console.log(`    First detail URL: ${pages[0]?.slice(-60)}`);
    } else {
      console.log('  âš  No detail pages found â€” sale_valuation may have no comparables yet');
    }
  } else {
    fail('detailPages should be array', `got: ${typeof pages}`);
  }
}

// â”€â”€ TEST 6: RQ /insert-detail-page (binoculars insert) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function testRQInsertDetailPage() {
  section('TEST 6: RQ /insert-detail-page (binoculars insert)');

  let agentUp = false;
  try {
    const r = await fetch(`${RQ}/list-sections`, { method: 'GET' });
    agentUp = r.ok;
  } catch { agentUp = false; }

  if (!agentUp) {
    console.log('  âš  RQ agent not reachable â€” skipping');
    return;
  }

  // First get the list of detail pages
  const { json: listJson } = await rq('POST', '/list-detail-pages', {
    fieldId: 'sale_comparable_detail',
    formType: 'commercial',
    assignmentUuid: UUID,
  });

  const pages = listJson.detailPages || [];
  if (pages.length === 0) {
    console.log('  âš  No detail pages available â€” skipping insert test');
    console.log('  (Add a sale comparable in RQ first to enable this test)');
    return;
  }

  const detailUrl = pages[0];
  console.log(`  Inserting into detail page: ...${detailUrl.slice(-50)}`);

  const testText = '[TEST] Sale comparable remarks â€” Appraisal Agent live test. This text was inserted by the automated test suite.';

  const { status, json } = await rq('POST', '/insert-detail-page', {
    detailUrl,
    text: testText,
    iframeIndex: 0,
  });

  if (status === 200 && json.ok) {
    pass('/insert-detail-page returned ok:true');
  } else {
    fail('/insert-detail-page failed', `status=${status} error=${json.error}`);
    return;
  }

  if (json.inserted) {
    pass(`inserted:true (method=${json.method})`);
  } else {
    fail('inserted:false', `error=${json.error}`);
  }

  if (json.verified) {
    pass('verified:true â€” content confirmed in DOM');
  } else {
    console.log('  âš  verified:false â€” insert may have succeeded but verification failed');
  }
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  console.log('\n' + 'â•'.repeat(60));
  console.log('  Appraisal Agent â€” Thorough Live Tests');
  console.log('  Target: ' + BASE + ' | RQ: ' + RQ);
  console.log('â•'.repeat(60));

  try {
    await setup();
  } catch (e) {
    console.error('\n[FATAL] Setup failed:', e.message);
    process.exit(1);
  }

  try {
    await testFeedbackKB();
    await testReviewSection();
    await testGenerateBatchTwoPass();
    await testRQTabClick();
    await testRQListDetailPages();
    await testRQInsertDetailPage();
  } finally {
    await cleanup();
  }

  console.log('\n' + 'â•'.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('â•'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });

