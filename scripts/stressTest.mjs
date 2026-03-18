/**
 * scripts/stressTest.mjs
 * -----------------------
 * Comprehensive stress test battery for cacc-writer.
 *
 * Tests:
 *   1. Multiple job folders — parse → geocode → generate → compare
 *   2. Parser robustness — both order form types, field-by-field verification
 *   3. Geocoding reliability — lat/lng, boundary roads, location context, timeout grace
 *   4. Generation stability — two runs, template field determinism (>80% overlap)
 *   5. Smoke tests — _test_smoke.mjs must still pass
 *
 * Usage:
 *   node scripts/stressTest.mjs
 *
 * Prerequisites:
 *   - cacc-writer server running on port 5178
 *   - Python with pdfplumber installed
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SERVER_BASE = process.env.SERVER_BASE || 'http://127.0.0.1:5178';
const TIMEOUT_MS = 60_000;
const GEOCODE_TIMEOUT_MS = 30_000;

// ── Job folders ───────────────────────────────────────────────────────────────

const JOB_FOLDERS = [
  {
    label: '48759 - 14 Maple Pl',
    path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - 48759 - 14 Maple Pl Normal',
    expectedFields: {
      state: 'IL',
      city: 'Normal',
      formTypeCode: '1004',
      lenderName: 'First State Mortgage',
      borrower1: 'Conner Cox',
    },
  },
  {
    label: 'Park - 1021 N Oak',
    path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - Park - 1021 N Oak St Normal',
    expectedFields: {
      city: 'Normal',
      state: 'IL',
      lenderName: null,   // Request form doesn't use "Organization" in every version
      borrower1: 'Ashley Park',
    },
  },
  {
    label: 'Soddy - 403 Delmar Ln',
    path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\February\\2026-02-09 - Soddy - 403 Delmar Ln Bloomington',
    expectedFields: {
      city: 'Bloomington',
      state: 'IL',
    },
  },
  {
    label: 'Hundman - 8 Lake Pointe Ct',
    path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\March\\2026-03-02 - Hundman - 8 Lake Pointe Ct Bloomington',
    expectedFields: {
      city: 'Bloomington',
      state: 'IL',
      borrower1: 'Patricia Hundman',
      lenderName: 'First State Bank',
    },
  },
];

// Minimal inspection facts to unblock pre-draft gate
const MINIMAL_INSPECTION_FACTS = {
  improvements: {
    condition_rating:   { value: 'C3', confidence: 'low' },
    kitchen_update:     { value: 'updated-one to five years ago', confidence: 'low' },
    bathroom_update:    { value: 'updated-one to five years ago', confidence: 'low' },
  },
  market: {
    marketing_time_days: { value: '30', confidence: 'low' },
    rate_trend:          { value: 'decreased', confidence: 'low' },
  },
};

// ── Utility functions ─────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(title) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}
function logSub(title) {
  console.log(`\n  ${'─'.repeat(60)}`);
  console.log(`  ▶ ${title}`);
}

async function apiFetch(urlPath, { method = 'GET', body = null, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts = { method, signal: ctrl.signal };
    if (body !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${SERVER_BASE}${urlPath}`, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 0, body: null, error: `timed out after ${timeoutMs}ms` };
    }
    return { status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function apiPostForm(urlPath, formData) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVER_BASE}${urlPath}`, {
      method: 'POST', body: formData, signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function deleteCase(caseId) {
  await fetch(`${SERVER_BASE}/api/cases/${caseId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});
}

function wordOverlapSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const words1 = new Set(text1.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) { if (words2.has(w)) overlap++; }
  return Math.round((overlap / new Set([...words1, ...words2]).size) * 100);
}

function findJobFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return { error: `Folder not found: ${folderPath}` };
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const pdfFiles = entries.filter(e => e.isFile() && /\.pdf$/i.test(e.name)).map(e => path.join(folderPath, e.name));

  const ASSIGNMENT_PATTERNS = [
    /assignment[_\s-]*sheet/i, /order[_\s-]*sheet/i, /request[_\s-]*form/i,
    /appraisal[_\s-]*(?:assignment|order|request)/i, /order\s*form/i, /gmail/i,
  ];
  const REPORT_PATTERNS = [/^\d{4,6}\.pdf$/i, /final[_\s-]*report/i, /completed/i];

  let assignmentSheet = null;
  let completedReport = null;
  for (const f of pdfFiles) {
    const name = path.basename(f);
    if (ASSIGNMENT_PATTERNS.some(p => p.test(name)) && !assignmentSheet) assignmentSheet = f;
    else if (REPORT_PATTERNS.some(p => p.test(name)) && !completedReport) completedReport = f;
  }
  if (!completedReport && pdfFiles.length === 2 && assignmentSheet) {
    completedReport = pdfFiles.find(f => f !== assignmentSheet) || null;
  }
  return { assignmentSheet, completedReport, allPdfs: pdfFiles };
}

function runPython(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [scriptPath, ...args], { cwd: PROJECT_ROOT, timeout: 30000 });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) { reject(new Error(`Python failed (${code}): ${stderr.slice(0, 200)}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`Bad Python output: ${stdout.slice(0, 200)}`)); }
    });
    proc.on('error', reject);
  });
}

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: PROJECT_ROOT, ...opts, stdio: 'pipe' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

// ── Test results tracker ──────────────────────────────────────────────────────

const results = [];

function recordResult(label, parseOk, geocodeOk, generateOk, avgSim, details = '') {
  results.push({ label, parseOk, geocodeOk, generateOk, avgSim, details });
}

// ── Stress Test 1: Multiple job folders ──────────────────────────────────────

async function runStressTest1() {
  logSection('STRESS TEST 1: Multiple Job Folders');

  for (const job of JOB_FOLDERS) {
    logSub(`Job: ${job.label}`);
    log(`    Path: ${job.path}`);

    const { assignmentSheet, allPdfs, error: findErr } = findJobFiles(job.path);

    if (findErr) {
      log(`    ❌ ${findErr}`);
      recordResult(job.label, false, false, false, null, findErr);
      continue;
    }

    const assignmentPath = assignmentSheet || allPdfs[0];
    if (!assignmentPath) {
      log(`    ❌ No PDFs found`);
      recordResult(job.label, false, false, false, null, 'No PDFs found');
      continue;
    }
    log(`    Assignment: ${path.basename(assignmentPath)}`);

    // Parse
    const pdfBuffer = fs.readFileSync(assignmentPath);
    const form = new FormData();
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), path.basename(assignmentPath));

    const { status: intakeStatus, body: intakeBody } = await apiPostForm('/api/intake/order', form);

    if (intakeStatus !== 200 || !intakeBody?.ok) {
      log(`    ❌ Parse failed (${intakeStatus}): ${JSON.stringify(intakeBody)?.slice(0, 100)}`);
      recordResult(job.label, false, false, false, null, `Parse HTTP ${intakeStatus}`);
      continue;
    }

    const { caseId, extracted } = intakeBody;
    let parseOk = true;

    // Validate expected fields
    if (job.expectedFields) {
      for (const [field, expected] of Object.entries(job.expectedFields)) {
        if (expected === null) continue; // skip null expectations
        const actual = extracted[field];
        if (!actual) {
          log(`    ⚠  Missing ${field} (expected: ${expected})`);
          parseOk = false;
        } else if (!String(actual).toLowerCase().includes(String(expected).toLowerCase())) {
          log(`    ⚠  ${field}: expected "${expected}", got "${actual}"`);
          parseOk = false;
        } else {
          log(`    ✓ ${field}: "${actual}"`);
        }
      }
    }

    log(`    Case created: ${caseId}`);

    // Geocode
    let geocodeOk = false;
    const { status: geoStatus, body: geoBody, error: geoErr } = await apiFetch(
      `/api/cases/${caseId}/geocode`,
      { method: 'POST', body: {}, timeoutMs: GEOCODE_TIMEOUT_MS }
    );

    if (geoStatus === 200 && geoBody?.ok) {
      geocodeOk = true;
      log(`    ✓ Geocoded: lat=${geoBody.subject?.lat}, lng=${geoBody.subject?.lng}`);
    } else {
      log(`    ⚠  Geocode failed (${geoStatus}): ${geoErr || geoBody?.error || 'unknown'}`);
    }

    // Seed minimal facts
    await apiFetch(`/api/cases/${caseId}/facts`, {
      method: 'PUT', body: MINIMAL_INSPECTION_FACTS,
    });

    // Generate
    let generateOk = false;
    let avgSim = null;

    const { status: genStatus, body: genBody, error: genErr } = await apiFetch(
      `/api/cases/${caseId}/generate-all`,
      { method: 'POST', body: { forceGateBypass: true }, timeoutMs: TIMEOUT_MS }
    );

    if (genStatus === 200 && genBody?.ok) {
      const nGen = Object.keys(genBody.results || {}).length;
      generateOk = nGen > 0;
      log(`    ✓ Generated: ${nGen} sections, ${Object.keys(genBody.errors || {}).length} errors`);
      if (genBody.errors && Object.keys(genBody.errors).length > 0) {
        log(`      Errors: ${JSON.stringify(genBody.errors).slice(0, 150)}`);
      }
    } else if (genStatus === 503) {
      log(`    ⚠  No OpenAI key — generation skipped`);
    } else {
      log(`    ❌ Generation failed (${genStatus}): ${genErr || JSON.stringify(genBody)?.slice(0, 100)}`);
    }

    // Extract actual narratives for similarity (if completed report exists)
    const { completedReport } = findJobFiles(job.path);
    if (completedReport && generateOk) {
      const extractScript = path.join(PROJECT_ROOT, 'scripts', 'extract_urar_narratives.py');
      try {
        const narrativeResult = await runPython(extractScript, [completedReport]);
        const actual = narrativeResult.fields || {};
        const generated = genBody?.results || {};
        const sharedFields = Object.keys(actual).filter(k => generated[k]);
        if (sharedFields.length > 0) {
          const sims = sharedFields.map(k => wordOverlapSimilarity(generated[k]?.text || '', actual[k]));
          avgSim = Math.round(sims.reduce((a, b) => a + b, 0) / sims.length);
          log(`    Avg similarity: ${avgSim}% (${sharedFields.length} fields)`);
        }
      } catch (e) {
        log(`    ⚠  Narrative extraction failed: ${e.message}`);
      }
    }

    await deleteCase(caseId);
    log(`    Case ${caseId} cleaned up`);

    recordResult(job.label, parseOk, geocodeOk, generateOk, avgSim);
  }
}

// ── Stress Test 2: Parser robustness ─────────────────────────────────────────

async function runStressTest2() {
  logSection('STRESS TEST 2: Parser Robustness');

  const testPdfs = [
    {
      label: 'Assignment Sheet (48759)',
      path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - 48759 - 14 Maple Pl Normal\\assignment_sheet_48759.pdf',
      expected: {
        state: 'IL',
        city: 'Normal',
        zip: '61761',
        streetNumber: '14',
        streetName: 'Maple Pl',
        borrower1: 'Conner Cox',
        borrower2: 'Jenna Cox',
        lenderName: 'First State Mortgage',
        lenderAddress: /502 N Hershey Rd/i,
        formTypeCode: '1004',
        formType: /1004.*Uniform/i,
        orderID: '48759',
        unit: null,  // must be null/empty
      },
    },
    {
      label: 'Request Form (Park)',
      path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - Park - 1021 N Oak St Normal\\Appraisal Request Form (2).pdf',
      expected: {
        state: 'IL',
        city: 'Normal',
        zip: '61761',
        streetNumber: '1021',
        borrower1: 'Ashley Park',
        lenderName: /First State Bank/i,
      },
    },
    {
      label: 'Email Request (Soddy)',
      path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\February\\2026-02-09 - Soddy - 403 Delmar Ln Bloomington\\Gmail - Appraisal Request.pdf',
      expected: {
        city: 'Bloomington',
        state: 'IL',
        zip: '61701',
        lenderName: /First Security Bank/i,
      },
    },
    {
      label: 'Order Form (Hundman)',
      path: 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\March\\2026-03-02 - Hundman - 8 Lake Pointe Ct Bloomington\\Appraisal Order Form (Commercial) (2).pdf',
      expected: {
        city: 'Bloomington',
        state: 'IL',
        zip: '61704',
        streetNumber: '8',
        borrower1: 'Patricia Hundman',
        lenderName: /First State Bank/i,
      },
    },
  ];

  const COL = { label: 28, field: 22, expected: 28, actual: 30, pass: 6 };
  log('');
  log(`  ${'PDF'.padEnd(COL.label)} ${'Field'.padEnd(COL.field)} ${'Expected'.padEnd(COL.expected)} ${'Actual'.padEnd(COL.actual)} OK?`);
  log('  ' + '─'.repeat(118));

  let totalChecks = 0;
  let passedChecks = 0;

  for (const test of testPdfs) {
    if (!fs.existsSync(test.path)) {
      log(`  ${'[FILE NOT FOUND]'.padEnd(COL.label)} ${test.path}`);
      continue;
    }

    const pdfBuffer = fs.readFileSync(test.path);
    const form = new FormData();
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), path.basename(test.path));

    const { status, body } = await apiPostForm('/api/intake/order', form);

    if (status !== 200 || !body?.ok) {
      log(`  ${test.label.padEnd(COL.label)} [INTAKE FAILED: ${status}]`);
      // Cleanup if a case was created
      if (body?.caseId) await deleteCase(body.caseId);
      continue;
    }

    const { extracted, caseId } = body;

    for (const [field, expected] of Object.entries(test.expected)) {
      totalChecks++;
      const actual = extracted[field];

      let pass = false;
      let expectedStr = '';
      let actualStr = String(actual ?? '(null)').slice(0, 28);

      if (expected === null) {
        // Must be null/empty/undefined
        pass = !actual || actual === '' || actual === 'City:';
        expectedStr = '(empty/null)';
        pass = !actual || String(actual).trim() === '';
      } else if (expected instanceof RegExp) {
        pass = expected.test(String(actual || ''));
        expectedStr = expected.toString().slice(0, 26);
      } else {
        pass = String(actual || '').toLowerCase().includes(String(expected).toLowerCase());
        expectedStr = String(expected).slice(0, 26);
      }

      if (pass) passedChecks++;
      const icon = pass ? '✓' : '✗';

      log(`  ${test.label.padEnd(COL.label)} ${field.padEnd(COL.field)} ${expectedStr.padEnd(COL.expected)} ${actualStr.padEnd(COL.actual)} ${icon}`);
    }

    await deleteCase(caseId);
  }

  log('  ' + '─'.repeat(118));
  log(`\n  Parser checks: ${passedChecks}/${totalChecks} passed`);

  return { passedChecks, totalChecks };
}

// ── Stress Test 3: Geocoding reliability ─────────────────────────────────────

async function runStressTest3() {
  logSection('STRESS TEST 3: Geocoding Reliability');

  const addressTests = [
    { label: '14 Maple Pl Normal IL',       address: '14 Maple Pl, Normal, IL 61761',       expectLat: 40.49, expectLng: -88.98 },
    { label: '1021 N Oak St Normal IL',     address: '1021 N Oak St, Normal, IL 61761',      expectLat: 40.51, expectLng: -88.99 },
    { label: '403 Delmar Ln Bloomington',   address: '403 Delmar Ln, Bloomington, IL 61701', expectLat: 40.47, expectLng: -89.00 },
    { label: '8 Lake Pointe Ct Bloomington',address: '8 Lake Pointe Ct, Bloomington, IL 61704', expectLat: 40.47, expectLng: -89.00 },
  ];

  log('');
  log(`  ${'Address'.padEnd(38)} ${'Lat/Lng OK'.padEnd(14)} ${'Boundaries'.padEnd(14)} ${'Context'.padEnd(12)} ${'Notes'}`);
  log('  ' + '─'.repeat(100));

  for (const test of addressTests) {
    // Create a minimal case with just address facts
    const { status: createStatus, body: createBody } = await apiFetch('/api/cases', {
      method: 'POST',
      body: {
        address: test.address,
        borrower: 'Test Borrower',
        formType: '1004',
      },
    });

    if (createStatus !== 200 || !createBody?.caseId) {
      log(`  ${test.label.padEnd(38)} [CASE CREATE FAILED: ${createStatus}]`);
      continue;
    }

    const caseId = createBody.caseId || createBody.case?.caseId;
    if (!caseId) {
      log(`  ${test.label.padEnd(38)} [No caseId in response]`);
      continue;
    }

    // Save address facts
    await apiFetch(`/api/cases/${caseId}/facts`, {
      method: 'PUT',
      body: {
        subject: { address: { value: test.address, confidence: 'high' } },
      },
    });

    // Geocode
    const tGeo = Date.now();
    const { status: geoStatus, body: geoBody, error: geoErr } = await apiFetch(
      `/api/cases/${caseId}/geocode`,
      { method: 'POST', body: {}, timeoutMs: GEOCODE_TIMEOUT_MS }
    );
    const geoMs = Date.now() - tGeo;

    const lat = geoBody?.subject?.lat;
    const lng = geoBody?.subject?.lng;

    const latOk = lat && Math.abs(lat - test.expectLat) < 0.5;
    const lngOk = lng && Math.abs(lng - test.expectLng) < 0.5;
    const latLngOk = latOk && lngOk;

    // Check location context
    let boundaryOk = false;
    let contextOk = false;

    if (geoStatus === 200 && geoBody?.ok) {
      const { status: lcStatus, body: lcBody } = await apiFetch(
        `/api/cases/${caseId}/location-context`,
        { timeoutMs: 10_000 }
      );
      if (lcStatus === 200 && lcBody?.ok) {
        contextOk = true;
        boundaryOk = (lcBody.boundaryFeatures?.length > 0) || (lcBody.context?.includes('road') ?? false);
      }
    }

    const latLngStr = latLngOk ? `✓ ${lat?.toFixed(4)},${lng?.toFixed(4)}` : `✗ ${lat || 'null'},${lng || 'null'}`;
    const notes = geoErr ? geoErr.slice(0, 25) : `${geoMs}ms`;

    log(`  ${test.label.padEnd(38)} ${latLngStr.padEnd(24)} ${(boundaryOk ? '✓' : '~').padEnd(14)} ${(contextOk ? '✓' : '~').padEnd(12)} ${notes}`);

    await deleteCase(caseId);
  }

  log('');
  log('  Note: ~ = geocoding succeeded but boundary/context data may vary by address.');
}

// ── Stress Test 4: Generation stability ──────────────────────────────────────

async function runStressTest4() {
  logSection('STRESS TEST 4: Generation Stability (template fields)');

  // Template fields should be near-deterministic (>80% overlap between two runs)
  const TEMPLATE_FIELDS = ['adverse_conditions', 'functional_utility'];

  const { assignmentSheet } = findJobFiles(
    'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - 48759 - 14 Maple Pl Normal'
  );

  if (!assignmentSheet) {
    log('  ⚠  48759 folder not found — skipping stability test');
    return;
  }

  const results48759 = [];

  for (let run = 1; run <= 2; run++) {
    log(`\n  Run ${run}/2...`);

    const pdfBuffer = fs.readFileSync(assignmentSheet);
    const form = new FormData();
    form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), path.basename(assignmentSheet));

    const { status: intakeStatus, body: intakeBody } = await apiPostForm('/api/intake/order', form);
    if (intakeStatus !== 200 || !intakeBody?.ok) {
      log(`    ❌ Intake failed on run ${run}`);
      results48759.push({});
      continue;
    }

    const { caseId } = intakeBody;

    // Geocode
    await apiFetch(`/api/cases/${caseId}/geocode`, {
      method: 'POST', body: {}, timeoutMs: GEOCODE_TIMEOUT_MS,
    });

    // Seed facts
    await apiFetch(`/api/cases/${caseId}/facts`, {
      method: 'PUT', body: MINIMAL_INSPECTION_FACTS,
    });

    // Generate
    const { status: genStatus, body: genBody } = await apiFetch(
      `/api/cases/${caseId}/generate-all`,
      { method: 'POST', body: { forceGateBypass: true }, timeoutMs: TIMEOUT_MS }
    );

    if (genStatus === 200 && genBody?.ok) {
      const runOutputs = {};
      for (const field of TEMPLATE_FIELDS) {
        const text = genBody.results?.[field]?.text;
        if (text) {
          runOutputs[field] = text;
          log(`    ${field}: ${String(text).slice(0, 60)}...`);
        } else {
          log(`    ${field}: (not generated)`);
        }
      }
      results48759.push(runOutputs);
    } else if (genStatus === 503) {
      log(`    ⚠  No OpenAI key`);
      results48759.push({});
    } else {
      log(`    ❌ Generation failed: ${genStatus}`);
      results48759.push({});
    }

    await deleteCase(caseId);
  }

  // Compare the two runs
  if (results48759.length === 2) {
    log('\n  Stability comparison (Run 1 vs Run 2):');
    log(`  ${'Field'.padEnd(28)} ${'Overlap %'.padEnd(12)} Status`);
    log('  ' + '─'.repeat(60));

    for (const field of TEMPLATE_FIELDS) {
      const t1 = results48759[0][field];
      const t2 = results48759[1][field];
      if (!t1 && !t2) {
        log(`  ${field.padEnd(28)} ${'N/A'.padEnd(12)} (not generated in either run)`);
        continue;
      }
      if (!t1 || !t2) {
        log(`  ${field.padEnd(28)} ${'N/A'.padEnd(12)} (only generated in one run)`);
        continue;
      }
      const overlap = wordOverlapSimilarity(t1, t2);
      const status = overlap >= 80 ? '✓ STABLE' : overlap >= 50 ? '~ MOSTLY STABLE' : '✗ UNSTABLE';
      log(`  ${field.padEnd(28)} ${String(overlap + '%').padEnd(12)} ${status}`);
    }
  }

  // Also check non-empty for all expected fields in one run (if we have API key)
  if (results48759[0] && Object.keys(results48759[0]).length > 0) {
    log('\n  Non-empty outputs in run 1:');
    for (const [f, t] of Object.entries(results48759[0])) {
      log(`    ${f}: ${String(t).length} chars — ${String(t).slice(0, 50)}...`);
    }
  }
}

// ── Stress Test 5: Smoke tests ────────────────────────────────────────────────

async function runStressTest5() {
  logSection('STRESS TEST 5: Smoke Tests');

  log('  Running node _test_smoke.mjs...');
  const { code, stdout, stderr } = await runProcess(
    'node', ['_test_smoke.mjs'],
    { env: { ...process.env, SERVER_BASE }, timeout: 120000 }
  );

  // Print last 40 lines of output
  const outLines = (stdout + stderr).split('\n');
  const tail = outLines.slice(-40).join('\n');
  log(tail);

  if (code === 0) {
    log('\n  ✓ Smoke tests PASSED');
  } else {
    log(`\n  ❌ Smoke tests FAILED (exit code ${code})`);
  }

  return code === 0;
}

// ── Summary Table ─────────────────────────────────────────────────────────────

function printSummaryTable() {
  logSection('STRESS TEST RESULTS SUMMARY');

  const COL = { label: 26, parse: 10, geocode: 12, generate: 13, sim: 16 };

  log('');
  log(`  ${'Job'.padEnd(COL.label)} | ${'Parse OK'.padEnd(COL.parse)} | ${'Geocode OK'.padEnd(COL.geocode)} | ${'Generate OK'.padEnd(COL.generate)} | ${'Avg Similarity'}`);
  log(`  ${'-'.repeat(COL.label)}-+-${'-'.repeat(COL.parse)}-+-${'-'.repeat(COL.geocode)}-+-${'-'.repeat(COL.generate)}-+-${'-'.repeat(COL.sim)}`);

  for (const r of results) {
    const parseStr   = r.parseOk   ? '    ✓     ' : '    ✗     ';
    const geocodeStr = r.geocodeOk ? '     ✓      ' : '     ✗      ';
    const genStr     = r.generateOk ? '      ✓       ' : (r.generateOk === false ? '      ✗       ' : '      -       ');
    const simStr     = r.avgSim !== null && r.avgSim !== undefined ? `     ${r.avgSim}%` : '      N/A';

    log(`  ${r.label.padEnd(COL.label)} | ${parseStr} | ${geocodeStr} | ${genStr} | ${simStr}`);
    if (r.details) log(`    ↳ ${r.details}`);
  }

  log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logSection('🔥 CACC-Writer Full Stress Test Battery');
  log(`  Server: ${SERVER_BASE}`);
  log(`  Started: ${new Date().toISOString()}`);

  // Health check
  const { status: healthStatus, body: healthBody } = await apiFetch('/api/health');
  if (healthStatus !== 200) {
    log(`\n  ❌ Server not responding at ${SERVER_BASE}`);
    log('     Start it with: node cacc-writer-server.js');
    process.exit(1);
  }
  log(`\n  ✓ Server healthy (model: ${healthBody?.model || 'unknown'})`);

  // Run all tests
  await runStressTest1();
  const parserResult = await runStressTest2();
  await runStressTest3();
  await runStressTest4();
  const smokePass = await runStressTest5();

  // Print summary
  printSummaryTable();

  logSection('Final Verdict');
  log(`  Parser checks:  ${parserResult.passedChecks}/${parserResult.totalChecks} passed`);
  log(`  Smoke tests:    ${smokePass ? '✓ PASSED' : '❌ FAILED'}`);
  log(`  Job folders:    ${results.filter(r => r.parseOk).length}/${results.length} parsed cleanly`);
  log(`  Geocoding:      ${results.filter(r => r.geocodeOk).length}/${results.length} succeeded`);
  log(`  Generation:     ${results.filter(r => r.generateOk).length}/${results.length} produced output`);
  log('');
  log(`  Completed: ${new Date().toISOString()}`);
  log('');

  const allOk = smokePass && parserResult.passedChecks === parserResult.totalChecks;
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('\n  FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
