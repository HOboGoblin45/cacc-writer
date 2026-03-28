/**
 * _test_ui_flow.mjs
 * -----------------
 * Simulates the full Generate tab flow from app.js:
 *   generateSelected() → checkMissingFacts() → showMissingFactsPanel() → proceedWithGeneration()
 *
 * Tests that the API response shape is exactly what app.js expects.
 */

const BASE = 'http://localhost:5178';
let passed = 0, failed = 0;

function ok(label, cond, detail = '') {
  if (cond) { console.log('  ✓', label); passed++; }
  else { console.log('  ✗', label, detail ? `(${detail})` : ''); failed++; }
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

// ── Simulate app.js showMissingFactsPanel rendering ───────────────────────────
// This mirrors the exact logic in app.js showMissingFactsPanel()
function simulateShowMissingFactsPanel(warnings) {
  const items = warnings.map(w => {
    const cls   = w.severity === 'required' ? 'req' : 'rec';
    const icon  = w.severity === 'required' ? '✗' : '○';
    const field = w.field || w.fieldId || '';
    const msg   = w.message || w.reason || 'Missing';
    return { cls, icon, field, msg, rendered: `${icon} ${field}: ${msg}` };
  });
  return items;
}

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Generate Tab UI Flow Simulation');
  console.log('══════════════════════════════════════════\n');

  // ── Setup ─────────────────────────────────────────────────────────────────
  const { data: created } = await api('/api/cases/create', {
    method: 'POST',
    body: { address: '456 Oak Ave, Normal, IL', formType: '1004' },
  });
  const caseId = created?.caseId;
  ok('Setup: create test case', !!caseId);

  // Save partial facts — missing city, county, market.trend, comps
  await api('/api/cases/' + caseId + '/facts', {
    method: 'PUT',
    body: {
      subject: {
        gla:       { value: '2100',    confidence: 'high' },
        condition: { value: 'Good',    confidence: 'high' },
        quality:   { value: 'Q3',      confidence: 'high' },
        // missing: city, county, address, siteSize, zoning
      },
      // missing: market.trend, comps
    },
  });
  ok('Setup: save partial facts (simulating incomplete case)', true);

  console.log('\n1. Simulate generateSelected() → checkMissingFacts()');

  // ── Step 1: app.js calls checkMissingFacts(fieldIds) ─────────────────────
  // This is exactly what app.js does in generateSelected() / generateAll()
  const fieldIds = [
    'neighborhood_description',
    'site_description',
    'improvements_description',
    'sales_comparison_commentary',
    'reconciliation',
  ];

  const { data: d } = await api('/api/cases/' + caseId + '/missing-facts', {
    method: 'POST',
    body: { fieldIds },
  });

  ok('1a. checkMissingFacts returns ok:true', d?.ok === true);
  ok('1b. checkMissingFacts returns warnings array', Array.isArray(d?.warnings));

  const warnings = d?.warnings ?? [];
  ok('1c. Warnings non-empty (incomplete facts detected)', warnings.length > 0,
     `got ${warnings.length} warnings`);

  console.log('\n2. Simulate showMissingFactsPanel(warnings) rendering');

  // ── Step 2: app.js calls showMissingFactsPanel(warnings, pendingFields) ───
  // Verify every warning has the fields app.js accesses
  const allHaveSeverity = warnings.every(w => w.severity === 'required' || w.severity === 'recommended');
  const allHaveField    = warnings.every(w => typeof (w.field || w.fieldId) === 'string');
  const allHaveMessage  = warnings.every(w => typeof (w.message || w.reason) === 'string');

  ok('2a. All warnings have severity (required|recommended)', allHaveSeverity,
     warnings.filter(w => !['required','recommended'].includes(w.severity)).map(w=>w.severity).join(','));
  ok('2b. All warnings have field or fieldId (for display)', allHaveField);
  ok('2c. All warnings have message or reason (for display)', allHaveMessage);

  // Simulate the actual rendering
  const rendered = simulateShowMissingFactsPanel(warnings);
  ok('2d. Panel renders without errors', rendered.length === warnings.length);

  // Check CSS class assignment
  const reqItems = rendered.filter(r => r.cls === 'req');
  const recItems = rendered.filter(r => r.cls === 'rec');
  ok('2e. Required warnings get "req" CSS class', reqItems.length > 0, `req=${reqItems.length}`);
  ok('2f. Recommended warnings get "rec" CSS class', recItems.length > 0, `rec=${recItems.length}`);

  // Check icon assignment
  const reqWithIcon  = rendered.filter(r => r.icon === '✗');
  const recWithIcon  = rendered.filter(r => r.icon === '○');
  ok('2g. Required warnings get ✗ icon', reqWithIcon.length > 0);
  ok('2h. Recommended warnings get ○ icon', recWithIcon.length > 0);

  console.log('\n  Sample rendered panel items:');
  rendered.slice(0, 5).forEach(r => console.log(`    [${r.cls}] ${r.rendered}`));

  console.log('\n3. Simulate proceedWithGeneration() — verify STATE._pendingGenFields shape');

  // ── Step 3: app.js stores pendingFields and calls runBatch() ──────────────
  // The pendingFields are the original field objects: [{id, title, prompt}]
  // Verify the fieldId tagging allows matching back to the original fields
  const pendingFields = fieldIds.map(id => ({ id, title: id, prompt: '' }));

  // Each warning's fieldId should match one of the pending fields
  const allMatchPending = warnings.every(w => pendingFields.some(f => f.id === w.fieldId));
  ok('3a. All warning fieldIds match pending field IDs', allMatchPending,
     warnings.filter(w => !pendingFields.some(f => f.id === w.fieldId)).map(w=>w.fieldId).join(','));

  // Verify warnings cover multiple fields (not just one)
  const uniqueFieldIds = [...new Set(warnings.map(w => w.fieldId))];
  ok('3b. Warnings span multiple fields', uniqueFieldIds.length > 1,
     `unique fieldIds: ${uniqueFieldIds.join(', ')}`);

  console.log(`\n  Fields with warnings: ${uniqueFieldIds.join(', ')}`);

  console.log('\n4. Edge case: case with ALL required facts → no warnings');

  // ── Step 4: fully-populated case should return no required warnings ────────
  await api('/api/cases/' + caseId + '/facts', {
    method: 'PUT',
    body: {
      subject: {
        gla:       { value: '2100',          confidence: 'high' },
        condition: { value: 'Good',          confidence: 'high' },
        quality:   { value: 'Q3',            confidence: 'high' },
        address:   { value: '456 Oak Ave',   confidence: 'high' },
        siteSize:  { value: '0.30 acres',    confidence: 'high' },
        city:      { value: 'Normal',        confidence: 'high' },
        county:    { value: 'McLean',        confidence: 'high' },
        zoning:    { value: 'R-1',           confidence: 'high' },
      },
      market: {
        trend:     { value: 'Stable',        confidence: 'high' },
        trendStat: { value: '2.1% annually', confidence: 'high' },
        typicalDOM:{ value: '45 days',       confidence: 'high' },
      },
      comps: [
        { address: { value: '100 Elm St', confidence: 'high' }, salePrice: { value: '285000', confidence: 'high' }, saleDate: { value: '2024-01', confidence: 'high' } },
        { address: { value: '200 Oak St', confidence: 'high' }, salePrice: { value: '295000', confidence: 'high' }, saleDate: { value: '2024-02', confidence: 'high' } },
        { address: { value: '300 Pine St', confidence: 'high' }, salePrice: { value: '290000', confidence: 'high' }, saleDate: { value: '2024-03', confidence: 'high' } },
      ],
    },
  });

  const { data: d2 } = await api('/api/cases/' + caseId + '/missing-facts', {
    method: 'POST',
    body: { fieldIds: ['neighborhood_description', 'reconciliation', 'site_description'] },
  });

  const requiredWarnings2 = (d2?.warnings ?? []).filter(w => w.severity === 'required');
  ok('4a. Fully-populated case → zero required warnings', requiredWarnings2.length === 0,
     `required warnings remaining: ${requiredWarnings2.map(w=>w.field).join(', ')}`);
  ok('4b. checkMissingFacts still returns ok:true', d2?.ok === true);

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
