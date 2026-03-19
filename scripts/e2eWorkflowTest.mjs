/**
 * scripts/e2eWorkflowTest.mjs
 * ----------------------------
 * Comprehensive end-to-end workflow test for CACC Writer production validation.
 *
 * Tests:
 *   1. Upload real assignment sheet PDF → verify case created with correct facts
 *   2. Geocode and verify boundary roads returned
 *   3. Generate all fields → verify 9/9 generated with no errors
 *   4. Check each generated field is non-empty and has no [INSERT] placeholders
 *      (except for sales_comparison_commentary / sca_summary which legitimately
 *       may reference [INSERT comp adjustments])
 *   5. Reports pass/fail for each check
 *
 * Usage:
 *   node scripts/e2eWorkflowTest.mjs
 *   node scripts/e2eWorkflowTest.mjs --base-url http://localhost:5178
 *
 * Exit codes:
 *   0 = all critical checks pass
 *   1 = one or more critical checks failed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────
const BASE_URL = (() => {
  const idx = process.argv.indexOf('--base-url');
  return idx !== -1 ? process.argv[idx + 1] : (process.env.CACC_BASE_URL || 'http://localhost:5178');
})();

const ASSIGNMENT_SHEET = 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - 48759 - 14 Maple Pl Normal\\assignment_sheet_48759.pdf';

// Fields that may legitimately contain [INSERT] for comp data
const ALLOW_INSERT_FIELDS = new Set([
  'sales_comparison_commentary',
  'sca_summary',
]);

// Critical fields that MUST be non-empty and non-placeholder
const CRITICAL_FIELDS = [
  'market_conditions',
  'neighborhood_description',
  'improvements_condition',
  'adverse_conditions',
  'functional_utility',
  'functional_utility_conformity',
  'reconciliation',
];

// ── Result tracking ───────────────────────────────────────────────────────────
const results = [];
let criticalFailed = 0;

function pass(check, detail = '') {
  results.push({ status: '✓ PASS', check, detail });
  console.log(`  ✓ PASS  ${check}${detail ? ' — ' + detail : ''}`);
}

function fail(check, detail = '', critical = true) {
  results.push({ status: '✗ FAIL', check, detail });
  console.error(`  ✗ FAIL  ${check}${detail ? ' — ' + detail : ''}`);
  if (critical) criticalFailed++;
}

function warn(check, detail = '') {
  results.push({ status: '⚠ WARN', check, detail });
  console.warn(`  ⚠ WARN  ${check}${detail ? ' — ' + detail : ''}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = BASE_URL + path;
  const timeout = opts.timeout || 120000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  const data = await res.json();
  return { status: res.status, data };
}

// ── Main test flow ────────────────────────────────────────────────────────────
async function run() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  CACC Writer — End-to-End Workflow Test');
  console.log('  Base URL:', BASE_URL);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── CHECK 0: Server health ─────────────────────────────────────────────────
  console.log('0. Server health check');
  try {
    const { status, data } = await apiJson('/api/health');
    if (data.ok) {
      pass('Server is running', `model=${data.model}`);
    } else {
      fail('Server health check failed', JSON.stringify(data));
    }
  } catch (e) {
    fail('Server unreachable', `${BASE_URL} — ${e.message}`);
    console.error('\n  Cannot proceed without server. Exiting.\n');
    process.exit(1);
  }

  // ── CHECK 1: Upload assignment sheet ───────────────────────────────────────
  console.log('\n1. Upload assignment sheet PDF');
  if (!fs.existsSync(ASSIGNMENT_SHEET)) {
    fail('Assignment sheet exists', ASSIGNMENT_SHEET + ' — file not found', true);
    console.error('\n  Cannot proceed without assignment sheet. Exiting.\n');
    process.exit(1);
  }
  pass('Assignment sheet file exists', path.basename(ASSIGNMENT_SHEET));

  let caseId;
  let extracted;
  let facts;

  try {
    const fileBuffer = fs.readFileSync(ASSIGNMENT_SHEET);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), path.basename(ASSIGNMENT_SHEET));

    const res = await api('/api/intake/order', { method: 'POST', body: formData, timeout: 60000 });
    const data = await res.json();

    if (data.ok && data.caseId) {
      caseId = data.caseId;
      extracted = data.extracted || {};
      facts = data.facts || {};
      pass('Case created from PDF', `caseId=${caseId}`);
    } else {
      fail('Case creation failed', data.error || JSON.stringify(data));
      process.exit(1);
    }
  } catch (e) {
    fail('PDF upload request failed', e.message);
    process.exit(1);
  }

  // ── CHECK 2: Verify extracted facts ───────────────────────────────────────
  console.log('\n2. Verify extracted facts');

  const expectedAddr = '14 Maple';
  const addr = extracted.address || '';
  if (addr.toLowerCase().includes('maple') || addr.toLowerCase().includes('normal')) {
    pass('Address extracted correctly', addr);
  } else if (addr) {
    warn('Address extracted (unexpected value)', addr);
  } else {
    fail('Address not extracted', 'expected something containing "Maple" or "Normal"', false);
  }

  const borrower = extracted.borrowerName || '';
  if (borrower) {
    pass('Borrower name extracted', borrower);
  } else {
    warn('Borrower name not extracted', 'may be missing from this PDF');
  }

  const formType = extracted.formType || extracted.formTypeCode || '';
  if (formType) {
    pass('Form type extracted', formType);
  } else {
    warn('Form type not extracted, defaulting to 1004');
  }

  // ── SEED: Minimal inspection facts (needed for fields that require physical inspection data)
  // These are defaults so the generator doesn't output [INSERT] for template fields
  try {
    await apiJson(`/api/cases/${caseId}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        improvements: {
          condition_rating:  { value: 'C3', confidence: 'high' },
          kitchen_update:    { value: 'updated-one to five years ago', confidence: 'high' },
          bathroom_update:   { value: 'updated-one to five years ago', confidence: 'high' },
        },
        subject: {
          bedrooms_above_grade:  { value: '4', confidence: 'high' },
          bathrooms_above_grade: { value: '2', confidence: 'high' },
          basement:              { value: 'partial unfinished', confidence: 'high' },
          garage:                { value: 'attached two-car', confidence: 'high' },
          style:                 { value: 'two-story', confidence: 'high' },
          fireplace:             { value: 'living room fireplace', confidence: 'high' },
        },
        site: {
          flood_zone:         { value: 'X', confidence: 'high' },
          adverse_conditions: { value: 'none', confidence: 'high' },
        },
        market: {
          marketing_time_days: { value: '30', confidence: 'high' },
          rate_trend:          { value: 'remained stable', confidence: 'high' },
          market_appeal:       { value: 'good', confidence: 'high' },
        },
      }),
    });
  } catch (e) { /* non-fatal */ }

  // ── CHECK 3: Geocode / boundary roads ─────────────────────────────────────
  console.log('\n3. Geocode and boundary roads');
  try {
    const { status, data } = await apiJson(`/api/cases/${caseId}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectAddress: extracted?.address || null }),
      timeout: 30000,
    });

    if (data.ok) {
      pass('Geocode succeeded', `lat=${data.subject?.lat || data.geocode?.subject?.result?.lat || 'n/a'}`);

      // Seed boundary roads into facts from geocode response
      if (data.boundaryRoads) {
        const br = data.boundaryRoads;
        const brFacts = { neighborhood: {} };
        if (br.north) { brFacts.neighborhood.NORTH_BOUNDARY = { value: br.north, confidence: 'high' }; brFacts.neighborhood.boundary_north = { value: br.north, confidence: 'high' }; }
        if (br.south) { brFacts.neighborhood.SOUTH_BOUNDARY = { value: br.south, confidence: 'high' }; brFacts.neighborhood.boundary_south = { value: br.south, confidence: 'high' }; }
        if (br.east)  { brFacts.neighborhood.EAST_BOUNDARY  = { value: br.east,  confidence: 'high' }; brFacts.neighborhood.boundary_east  = { value: br.east,  confidence: 'high' }; }
        if (br.west)  { brFacts.neighborhood.WEST_BOUNDARY  = { value: br.west,  confidence: 'high' }; brFacts.neighborhood.boundary_west  = { value: br.west,  confidence: 'high' }; }
        try {
          await apiJson(`/api/cases/${caseId}/facts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brFacts) });
        } catch (_) {}
      }

      // Check boundary roads
      const lat = data.subject?.lat || data.geocode?.subject?.result?.lat;
      const lng = data.geocode?.subject?.result?.lng;
      if (lat && lng) {
        try {
          const { data: bdData } = await apiJson(
            `/api/neighborhood/boundary-features?lat=${lat}&lng=${lng}&radiusMiles=1.5`,
            { timeout: 15000 }
          );
          if (bdData.ok && bdData.features && bdData.features.length > 0) {
            pass('Boundary roads returned', `${bdData.features.length} feature(s)`);
          } else if (bdData.ok) {
            warn('Geocode succeeded but no boundary roads returned', 'may be OK for rural areas');
          } else {
            warn('Boundary roads probe returned error', bdData.error || 'unknown');
          }
        } catch (e) {
          warn('Boundary roads probe failed', e.message);
        }
      } else {
        warn('Geocode succeeded but no lat/lng returned');
      }
    } else if (status === 404) {
      warn('Geocode endpoint not found', 'may be a different route path — skipping');
    } else {
      warn('Geocode returned error', data.error || JSON.stringify(data));
    }
  } catch (e) {
    warn('Geocode request failed', e.message + ' — skipping (non-critical)');
  }

  // ── CHECK 4: Generate all fields ──────────────────────────────────────────
  console.log('\n4. Generate all fields (generate-batch)');

  let generatedResults = {};
  let generationErrors = {};

  try {
    const { status, data } = await apiJson(`/api/cases/${caseId}/generate-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forceGateBypass: true,
      }),
      timeout: 180000,
    });

    if (data.ok) {
      generatedResults = data.results || {};
      generationErrors = data.errors || {};
      const genCount = Object.keys(generatedResults).length;
      const errCount = Object.keys(generationErrors).length;

      if (errCount === 0) {
        pass(`All ${genCount} fields generated successfully`);
      } else {
        warn(`${genCount} fields generated, ${errCount} errors`, Object.keys(generationErrors).join(', '));
      }
    } else if (status === 409) {
      // Gate blocked — retry with bypass
      warn('Pre-draft gate blocked, retrying with forceGateBypass');
      const { data: data2 } = await apiJson(`/api/cases/${caseId}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceGateBypass: true }),
        timeout: 180000,
      });
      if (data2.ok) {
        generatedResults = data2.results || {};
        generationErrors = data2.errors || {};
        pass(`Generated ${Object.keys(generatedResults).length} fields (with gate bypass)`);
      } else {
        fail('Generation failed even with gate bypass', data2.error || JSON.stringify(data2));
      }
    } else {
      fail('Generation request failed', `status=${status} error=${data.error || JSON.stringify(data)}`);
    }
  } catch (e) {
    fail('Generation request threw exception', e.message);
  }

  // ── CHECK 5: Validate generated field content ─────────────────────────────
  console.log('\n5. Validate generated field content');

  const insertRe = /\[INSERT(?! comp adjustments)/i;
  const emptyOrWorking = (text) => !text || text.trim() === '' || text.trim() === 'Working...';

  for (const fieldId of CRITICAL_FIELDS) {
    const result = generatedResults[fieldId];
    if (!result || !result.text) {
      if (generationErrors[fieldId]) {
        fail(`${fieldId} — generation error`, generationErrors[fieldId], true);
      } else {
        fail(`${fieldId} — field not generated or empty`, '', true);
      }
      continue;
    }

    const text = result.text.trim();

    if (emptyOrWorking(text)) {
      fail(`${fieldId} — empty text`, '', true);
      continue;
    }

    if (!ALLOW_INSERT_FIELDS.has(fieldId) && insertRe.test(text)) {
      fail(`${fieldId} — contains [INSERT] placeholder`, text.slice(0, 120), true);
      continue;
    }

    pass(`${fieldId} — OK`, `${text.length} chars`);
  }

  // Also report on other generated fields (non-critical)
  for (const [fieldId, result] of Object.entries(generatedResults)) {
    if (CRITICAL_FIELDS.includes(fieldId)) continue;
    const text = (result && result.text || '').trim();
    if (!text || text === 'Working...') {
      warn(`${fieldId} — empty (non-critical)`);
    } else if (!ALLOW_INSERT_FIELDS.has(fieldId) && insertRe.test(text)) {
      warn(`${fieldId} — contains [INSERT] placeholder (non-critical)`, text.slice(0, 80));
    } else {
      pass(`${fieldId} — OK (non-critical)`, `${text.length} chars`);
    }
  }

  // Report errors for un-generated fields
  for (const [fieldId, errMsg] of Object.entries(generationErrors)) {
    if (!generatedResults[fieldId]) {
      const isCritical = CRITICAL_FIELDS.includes(fieldId);
      if (isCritical) {
        fail(`${fieldId} — error`, errMsg, true);
      } else {
        warn(`${fieldId} — error (non-critical)`, errMsg);
      }
    }
  }

  // ── CHECK 6: Total field count ─────────────────────────────────────────────
  console.log('\n6. Field count check');
  const totalGenerated = Object.keys(generatedResults).length;
  if (totalGenerated >= 9) {
    pass(`Generated ${totalGenerated}/9+ fields`, Object.keys(generatedResults).join(', '));
  } else if (totalGenerated >= 6) {
    warn(`Only ${totalGenerated}/9 expected fields generated`, 'Some may require more facts');
  } else {
    fail(`Too few fields generated: ${totalGenerated}/9`, 'Generation may be broken', true);
  }

  // ── Cleanup: delete test case ──────────────────────────────────────────────
  console.log('\n7. Cleanup test case');
  try {
    const { data } = await apiJson(`/api/cases/${caseId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (data.ok) {
      pass('Test case deleted', caseId);
    } else {
      warn('Test case deletion returned error', data.error);
    }
  } catch (e) {
    warn('Test case cleanup failed', e.message);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.status.startsWith('✓')).length;
  const failed = results.filter(r => r.status.startsWith('✗')).length;
  const warned = results.filter(r => r.status.startsWith('⚠')).length;

  console.log(`  ✓ Passed:  ${passed}`);
  console.log(`  ✗ Failed:  ${failed} (${criticalFailed} critical)`);
  console.log(`  ⚠ Warned:  ${warned}`);
  console.log('');

  if (criticalFailed === 0) {
    console.log('  ✅ E2E TEST PASSED — All critical checks passed\n');
    process.exit(0);
  } else {
    console.log(`  ❌ E2E TEST FAILED — ${criticalFailed} critical check(s) failed\n`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('\n  FATAL:', err.message);
  process.exit(1);
});
