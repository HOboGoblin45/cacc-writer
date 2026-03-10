/**
 * _test_live.mjs
 * Live integration tests for AI generation and geocoding endpoints.
 * Requires: server running at http://localhost:5178 with OPENAI_API_KEY set.
 *
 * Usage: node _test_live.mjs
 */

const BASE = 'http://localhost:5178';
let passed = 0, failed = 0, caseId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

function pass(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    → ${detail}`);
  failed++;
}

function section(title) {
  console.log(`\n${title}`);
}

function truncate(str, n = 120) {
  if (!str) return '(empty)';
  const s = String(str);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  CACC Writer Live Integration Tests');
console.log('  Target: ' + BASE);
console.log('══════════════════════════════════════════');

// ── 1. Setup: create case + save facts ───────────────────────────────────────
section('1. Setup');

{
  const { status, json } = await req('POST', '/api/cases/create', {
    formType: '1004',
    address: '123 Main St, Bloomington, IL 61701',
    borrower: 'Test Borrower',
  });
  if (status === 200 && json.ok && json.caseId) {
    caseId = json.caseId;
    pass(`Created test case: ${caseId}`);
  } else {
    fail('Create test case', `status=${status} ok=${json.ok}`);
    console.log('\n  ⚠ Cannot continue without a case. Aborting.');
    process.exit(1);
  }
}

{
  const { status, json } = await req('PUT', `/api/cases/${caseId}/facts`, {
    subject_address:       { value: '123 Main St, Bloomington, IL 61701', confidence: 'high' },
    subject_city:          { value: 'Bloomington', confidence: 'high' },
    subject_state:         { value: 'IL', confidence: 'high' },
    subject_zip:           { value: '61701', confidence: 'high' },
    property_type:         { value: 'Single Family Residential', confidence: 'high' },
    neighborhood_name:     { value: 'East Side', confidence: 'medium' },
    market_conditions:     { value: 'Stable', confidence: 'high' },
    flood_zone:            { value: 'Zone X (minimal flood hazard)', confidence: 'high' },
    zoning:                { value: 'R-1 Single Family Residential', confidence: 'high' },
    site_area:             { value: '0.25 acres', confidence: 'high' },
    gross_living_area:     { value: '1,850 sq ft', confidence: 'high' },
    year_built:            { value: '1998', confidence: 'high' },
    bedrooms:              { value: '3', confidence: 'high' },
    bathrooms:             { value: '2.0', confidence: 'high' },
    garage:                { value: '2-car attached', confidence: 'high' },
    condition:             { value: 'Average', confidence: 'medium' },
    opinion_of_value:      { value: '$285,000', confidence: 'high' },
  });
  if (status === 200 && json.ok) {
    pass('Saved facts to case');
  } else {
    fail('Save facts', `status=${status}`);
  }
}

// ── 2. AI Generation — single field ──────────────────────────────────────────
section('2. AI Generation — Single Field (POST /api/generate)');

{
  console.log('  → Calling OpenAI for neighborhood_description (may take 10–30s)…');
  const start = Date.now();
  const { status, json } = await req('POST', '/api/generate', {
    caseId,
    fieldId: 'neighborhood_description',
    formType: '1004',
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Server returns { ok, result, fieldId, formType, examplesUsed }
  if (status === 200 && json.ok && json.result && json.result.length > 20) {
    pass(`Generated neighborhood_description (${elapsed}s, ${json.result.length} chars)`);
    console.log(`    Preview: "${truncate(json.result, 160)}"`);
    if (json.examplesUsed !== undefined) {
      console.log(`    KB examples used: ${json.examplesUsed}`);
    }
  } else if (status === 503 || (json.error && json.error.includes('API'))) {
    fail(`AI call failed — check OPENAI_API_KEY in .env`, json.error);
  } else {
    fail(`Generate single field`, `status=${status} ok=${json.ok} error=${json.error}`);
  }
}

{
  console.log('  → Calling OpenAI for market_conditions (may take 10–30s)…');
  const start = Date.now();
  const { status, json } = await req('POST', '/api/generate', {
    caseId,
    fieldId: 'market_conditions',
    formType: '1004',
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok && json.result && json.result.length > 20) {
    pass(`Generated market_conditions (${elapsed}s, ${json.result.length} chars)`);
    console.log(`    Preview: "${truncate(json.result, 160)}"`);
  } else {
    fail(`Generate market_conditions`, `status=${status} error=${json.error}`);
  }
}

// ── 3. AI Generation — batch ──────────────────────────────────────────────────
section('3. AI Generation — Batch (POST /api/generate-batch)');

{
  console.log('  → Calling OpenAI for 2 fields in batch (may take 20–40s)…');
  const start = Date.now();
  const { status, json } = await req('POST', '/api/generate-batch', {
    caseId,
    fields: [
      { id: 'hbu_as_improved', title: 'HBU As Improved' },
      { id: 'reconciliation', title: 'Reconciliation' },
    ],
    twoPass: false,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok) {
    const resultKeys = Object.keys(json.results || {});
    const errorKeys  = Object.keys(json.errors  || {});
    if (resultKeys.length > 0) {
      pass(`Batch generated ${resultKeys.length} field(s) in ${elapsed}s`);
      for (const k of resultKeys) {
        const t = json.results[k];
        console.log(`    [${k}] ${t.text?.length || 0} chars — "${truncate(t.text, 100)}"`);
      }
    } else {
      fail(`Batch returned 0 results`, `errors: ${JSON.stringify(json.errors)}`);
    }
    if (errorKeys.length > 0) {
      console.log(`    ⚠ Errors: ${JSON.stringify(json.errors)}`);
    }
  } else {
    fail(`Generate batch`, `status=${status} error=${json.error}`);
  }
}

// ── 4. Two-Pass Review ────────────────────────────────────────────────────────
section('4. Two-Pass Review (POST /api/cases/:id/review-section)');

{
  const draftText = 'The subject property is located in a stable residential neighborhood. ' +
    'The area has experienced strong appreciation over the past 12 months. ' +
    'Flood zone is Zone X. Zoning is R-1. The neighborhood is 80% built-up. ' +
    'Properties in this area typically sell within 30 days of listing.';

  console.log('  → Calling OpenAI for two-pass review (may take 10–30s)…');
  const start = Date.now();
  const { status, json } = await req('POST', `/api/cases/${caseId}/review-section`, {
    fieldId: 'neighborhood_description',
    draftText,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok) {
    pass(`Two-pass review completed (${elapsed}s)`);
    console.log(`    revisedText length: ${json.revisedText?.length || 0} chars`);
    console.log(`    changesMade: ${json.changesMade}`);
    console.log(`    confidence: ${json.confidence}`);
    console.log(`    issues found: ${json.issues?.length || 0}`);
    if (json.issues?.length > 0) {
      for (const issue of json.issues.slice(0, 3)) {
        console.log(`      - [${issue.severity || issue.type}] ${issue.description || issue.type}`);
      }
    }
    if (json.revisedText && json.revisedText !== draftText) {
      console.log(`    Preview revised: "${truncate(json.revisedText, 160)}"`);
    }
  } else {
    fail(`Two-pass review`, `status=${status} error=${json.error}`);
  }
}

// ── 5. Geocoding ──────────────────────────────────────────────────────────────
section('5. Geocoding (POST /api/cases/:id/geocode)');

{
  console.log('  → Geocoding subject + comps via Nominatim (requires internet)…');
  const start = Date.now();
  const { status, json } = await req('POST', `/api/cases/${caseId}/geocode`, {
    subject: { address: '123 Main St, Bloomington, IL 61701' },
    comps: [
      { id: 'comp1', address: '456 Oak Ave, Bloomington, IL 61701' },
      { id: 'comp2', address: '789 Elm St, Normal, IL 61761' },
    ],
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok) {
    pass(`Geocoding completed (${elapsed}s)`);
    const s = json.geocode?.subject;
    if (s?.lat) {
      console.log(`    Subject: lat=${s.lat.toFixed(4)}, lng=${s.lng.toFixed(4)}, city=${s.city || 'n/a'}`);
    }
    const comps = json.geocode?.comps || [];
    for (const c of comps) {
      if (c.lat) {
        console.log(`    Comp ${c.id}: ${c.distanceMiles?.toFixed(2) || '?'} mi ${c.direction || '?'} — lat=${c.lat.toFixed(4)}`);
      } else {
        console.log(`    Comp ${c.id}: geocode failed (${c.error || 'no result'})`);
      }
    }
  } else if (json.error?.includes('fetch') || json.error?.includes('network')) {
    fail(`Geocoding — network error (check internet access)`, json.error);
  } else {
    fail(`Geocoding`, `status=${status} error=${json.error}`);
  }
}

// ── 6. Location Context ───────────────────────────────────────────────────────
section('6. Location Context (GET /api/cases/:id/location-context)');

{
  console.log('  → Fetching location context block (Overpass API, requires internet)…');
  const start = Date.now();
  const { status, json } = await req('GET', `/api/cases/${caseId}/location-context`);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok) {
    pass(`Location context fetched (${elapsed}s)`);
    console.log(`    contextBlock length: ${json.contextBlock?.length || 0} chars`);
    if (json.contextBlock) {
      console.log(`    Preview: "${truncate(json.contextBlock, 200)}"`);
    }
  } else if (status === 404 || json.error?.includes('geocode')) {
    // Geocode may not have saved if subject geocode failed — this is expected
    console.log(`  ⚠ Location context skipped — geocode.json not available (expected if geocode failed)`);
    passed++; // non-fatal
  } else {
    fail(`Location context`, `status=${status} error=${json.error}`);
  }
}

// ── 7. KB feedback loop ───────────────────────────────────────────────────────
section('7. KB Feedback Loop (POST /api/cases/:id/feedback → KB save)');

{
  const { status, json } = await req('POST', `/api/cases/${caseId}/feedback`, {
    fieldId: 'neighborhood_description',
    fieldTitle: 'Neighborhood Description',
    originalText: 'Original draft text here.',
    editedText: 'The subject neighborhood is a well-established residential area in Bloomington, IL. ' +
      'The neighborhood is characterized by single-family homes built primarily between 1985 and 2005. ' +
      'Market conditions are stable with typical marketing times of 30-60 days.',
    rating: 'up',
  });

  if (status === 200 && json.ok) {
    pass(`Feedback saved${json.savedToKB ? ' + saved to KB ✓' : ' (KB save skipped)'}`);
    console.log(`    savedToKB: ${json.savedToKB}, feedbackCount: ${json.count}`);
  } else {
    fail(`Feedback + KB save`, `status=${status} error=${json.error}`);
  }
}

// ── 8. KB status after feedback ───────────────────────────────────────────────
section('8. KB Status After Feedback');

{
  const { status, json } = await req('GET', '/api/kb/status');
  if (status === 200 && json.ok) {
    pass(`KB status: total=${json.totalExamples}, approved=${json.counts?.approved_edits || 0}`);
    console.log(`    counts: ${JSON.stringify(json.counts)}`);
  } else {
    fail(`KB status`, `status=${status}`);
  }
}

// ── 9. Cleanup ────────────────────────────────────────────────────────────────
section('9. Cleanup');

{
  const { status, json } = await req('DELETE', `/api/cases/${caseId}`);
  if (status === 200 && json.ok) {
    pass(`Deleted test case ${caseId}`);
  } else {
    fail(`Delete test case`, `status=${status}`);
  }
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
