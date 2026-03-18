/**
 * scripts/duplicateTest.mjs
 * --------------------------
 * Golden-path duplication test: Can cacc-writer reproduce the report
 * Charles already wrote for a given job folder?
 *
 * Workflow:
 *  1. Locate the job folder (default: 48759 - 14 Maple Pl Normal)
 *  2. Find the assignment sheet PDF + completed appraisal PDF
 *  3. Extract facts from the assignment sheet via POST /api/intake/order
 *  4. Geocode the subject address (POST /api/cases/:id/geocode) to derive
 *     neighborhood context (boundary roads, location side, amenity proximity)
 *  5. Seed minimal inspection facts that can't be derived from geocoding
 *     (condition_rating, kitchen/bath updates, marketing_time_days)
 *  6. Extract narratives Charles wrote from the completed PDF via Python
 *  7. Generate narratives via POST /api/cases/:id/generate-all
 *  8. Compare generated vs actual (word overlap similarity)
 *  9. Print a grading table
 *
 * Usage:
 *   node scripts/duplicateTest.mjs [job_folder_path]
 *
 * Default job folder:
 *   C:\Users\ccres\OneDrive\Desktop\CACC Appraisals\2026 Appraisals\January\2026-01-12 - 48759 - 14 Maple Pl Normal
 *
 * Prerequisites:
 *   - cacc-writer server running on port 5178 (or set SERVER_BASE env var)
 *   - Python with pdfplumber installed
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_JOB_FOLDER =
  'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals\\2026 Appraisals\\January\\2026-01-12 - 48759 - 14 Maple Pl Normal';

const JOB_FOLDER = process.argv[2] || DEFAULT_JOB_FOLDER;
const SERVER_BASE = process.env.SERVER_BASE || 'http://127.0.0.1:5178';
const TIMEOUT_MS = 60_000;     // 60s for generation
const GEOCODE_TIMEOUT_MS = 30_000;

const NARRATIVE_FIELDS = [
  'neighborhood_description',
  'market_conditions',
  'improvements_condition',
  'adverse_conditions',
  'functional_utility',
  'sales_comparison_commentary',
  'reconciliation',
];

// Minimal inspection facts that can't be derived from geocoding or the order sheet.
// Used to unblock the pre-draft gate for testing purposes.
// These are realistic placeholder values for a 4BR/2.5BA two-story house.
// NOTE: confidence='high' so formatFactsBlock includes values in the prompt
// instead of replacing them with [INSERT]. This is intentional for test seeding —
// these values are "known" for the purposes of the duplicate test.
const MINIMAL_INSPECTION_FACTS = {
  improvements: {
    condition_rating:      { value: 'C3', confidence: 'high' },
    kitchen_update:        { value: 'updated-one to five years ago', confidence: 'high' },
    bathroom_update:       { value: 'updated-one to five years ago', confidence: 'high' },
  },
  subject: {
    bedrooms_above_grade:  { value: '4', confidence: 'high' },
    bathrooms_above_grade: { value: '2.5', confidence: 'high' },
    basement:              { value: 'partial unfinished', confidence: 'high' },
    garage:                { value: 'attached two-car', confidence: 'high' },
    style:                 { value: 'two-story', confidence: 'high' },
    year_built:            { value: '1995', confidence: 'high' },
    gla:                   { value: '2100', confidence: 'high' },
    condition:             { value: 'C3', confidence: 'high' },
  },
  site: {
    flood_zone:            { value: 'X', confidence: 'high' },
    adverse_conditions:    { value: 'none', confidence: 'high' },
  },
  market: {
    marketing_time_days:   { value: '30', confidence: 'high' },
    rate_trend:            { value: 'decreased', confidence: 'high' },
    market_appeal:         { value: 'good', confidence: 'high' },
    concessions_typical:   { value: 'true', confidence: 'high' },
    supply_demand:         { value: 'in balance', confidence: 'high' },
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

function logSection(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function apiFetch(urlPath, { method = 'GET', body = null, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const opts = {
      method,
      signal: ctrl.signal,
    };
    if (body !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${SERVER_BASE}${urlPath}`, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 0, body: null, error: `Request timed out after ${timeoutMs}ms` };
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
      method: 'POST',
      body: formData,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a Python script and return its stdout as parsed JSON.
 */
function runPython(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Python script failed (code ${code}): ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Compute word-overlap similarity between two text strings.
 * Returns 0-100%.
 */
function wordOverlapSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  const words1 = new Set(
    text1.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3),
  );
  const words2 = new Set(
    text2.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3),
  );

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }

  // Jaccard similarity
  const union = new Set([...words1, ...words2]).size;
  return Math.round((overlap / union) * 100);
}

/**
 * Find assignment sheet and completed report in a job folder.
 */
function findJobFiles(folderPath) {
  if (!fs.existsSync(folderPath)) {
    return { error: `Folder not found: ${folderPath}` };
  }

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const pdfFiles = entries
    .filter(e => e.isFile() && /\.pdf$/i.test(e.name))
    .map(e => path.join(folderPath, e.name));

  const ASSIGNMENT_PATTERNS = [
    /assignment[_\s-]*sheet/i,
    /order[_\s-]*sheet/i,
    /request[_\s-]*form/i,
    /appraisal[_\s-]*(?:assignment|order|request)/i,
    /order\s*form/i,
    /gmail/i,   // email-style request PDFs
  ];
  const REPORT_PATTERNS = [/^\d{4,6}\.pdf$/i, /final[_\s-]*report/i, /completed/i];

  let assignmentSheet = null;
  let completedReport = null;

  for (const f of pdfFiles) {
    const name = path.basename(f);
    const isAssignment = ASSIGNMENT_PATTERNS.some(p => p.test(name));
    const isReport = REPORT_PATTERNS.some(p => p.test(name));

    if (isAssignment && !assignmentSheet) assignmentSheet = f;
    else if (isReport && !completedReport) completedReport = f;
  }

  // Fallback: if 2 PDFs and one is assignment, other is report
  if (!completedReport && pdfFiles.length === 2 && assignmentSheet) {
    completedReport = pdfFiles.find(f => f !== assignmentSheet) || null;
  }

  return { assignmentSheet, completedReport, allPdfs: pdfFiles };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logSection('🧪 CACC-Writer Golden-Path Duplication Test');
  log(`  Job folder: ${JOB_FOLDER}`);
  log(`  Server: ${SERVER_BASE}`);

  // ── Step 1: Find job files ────────────────────────────────────────────────
  logSection('Step 1: Locating job files');

  const { assignmentSheet, completedReport, allPdfs, error: findError } = findJobFiles(JOB_FOLDER);

  if (findError) {
    log(`  ❌ ERROR: ${findError}`);
    process.exit(1);
  }

  log(`  Found ${allPdfs.length} PDF(s) in folder:`);
  for (const f of allPdfs) log(`    - ${path.basename(f)}`);

  if (!assignmentSheet) {
    log('  ⚠  No assignment sheet found. Using first PDF as assignment sheet.');
    if (allPdfs.length === 0) {
      log('  ❌ No PDFs found in job folder. Exiting.');
      process.exit(1);
    }
  }

  if (!completedReport) {
    log('  ⚠  No completed appraisal report found. Similarity comparison will be skipped.');
  }

  const assignmentPath = assignmentSheet || allPdfs[0];
  log(`\n  Assignment sheet: ${path.basename(assignmentPath)}`);
  if (completedReport) log(`  Completed report: ${path.basename(completedReport)}`);

  // ── Step 2: Check server health ───────────────────────────────────────────
  logSection('Step 2: Server health check');

  const { status: healthStatus, body: healthBody } = await apiFetch('/api/health');

  if (healthStatus !== 200) {
    log(`  ❌ Server not responding (${healthStatus}). Is it running at ${SERVER_BASE}?`);
    log('     Start it with: node cacc-writer-server.js');
    process.exit(1);
  }
  log(`  ✓ Server healthy (model: ${healthBody?.model || 'unknown'})`);

  // ── Step 3: Extract facts from assignment sheet ───────────────────────────
  logSection('Step 3: Parsing assignment sheet');

  const pdfBuffer = fs.readFileSync(assignmentPath);
  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), path.basename(assignmentPath));

  const { status: intakeStatus, body: intakeBody } = await apiPostForm('/api/intake/order', form);

  if (intakeStatus !== 200 || !intakeBody?.ok) {
    log(`  ❌ Order intake failed (${intakeStatus}): ${JSON.stringify(intakeBody)?.slice(0, 200)}`);
    process.exit(1);
  }

  const { caseId, extracted, missingFields } = intakeBody;
  log(`  ✓ Case created: ${caseId}`);
  log(`  Extracted fields:`);
  for (const [k, v] of Object.entries(extracted || {})) {
    log(`    ${k}: ${String(v).slice(0, 60)}`);
  }
  if (missingFields?.length > 0) {
    log(`  ⚠  Missing required fields: ${missingFields.join(', ')}`);
  }

  // ── Step 4: Geocode the subject address ───────────────────────────────────
  logSection('Step 4: Geocoding subject address');

  let geocodeOk = false;
  let locationContextOk = false;

  const { status: geoStatus, body: geoBody, error: geoErr } = await apiFetch(
    `/api/cases/${caseId}/geocode`,
    { method: 'POST', body: {}, timeoutMs: GEOCODE_TIMEOUT_MS }
  );

  if (geoStatus === 200 && geoBody?.ok) {
    geocodeOk = true;
    const sub = geoBody.subject;
    log(`  ✓ Geocoded: ${sub?.display_name || sub?.lat + ',' + sub?.lng || 'OK'}`);
    if (geoBody.subject?.lat) {
      log(`    lat/lng: ${geoBody.subject.lat}, ${geoBody.subject.lng}`);
    }
    // Check location context
    const { status: lcStatus, body: lcBody } = await apiFetch(
      `/api/cases/${caseId}/location-context`,
      { timeoutMs: 10_000 }
    );
    if (lcStatus === 200 && lcBody?.ok) {
      locationContextOk = true;
      log(`  ✓ Location context available`);
      if (lcBody.boundaryFeatures?.length > 0) {
        log(`    Boundary features: ${lcBody.boundaryFeatures.length}`);
      }
    } else {
      log(`  ⚠  Location context unavailable (${lcStatus}): ${lcBody?.error || 'no detail'}`);
    }
  } else {
    log(`  ⚠  Geocoding failed (${geoStatus}): ${geoErr || geoBody?.error || JSON.stringify(geoBody)?.slice(0, 100)}`);
    log('     Generation will proceed without location context.');
  }

  // ── Step 5: Seed minimal inspection facts ─────────────────────────────────
  logSection('Step 5: Seeding minimal inspection facts');

  // Merge current facts with minimal inspection defaults (don't overwrite order-sheet data)
  const { body: caseBodyBefore } = await apiFetch(`/api/cases/${caseId}`);
  const existingFacts = caseBodyBefore?.facts || {};

  const seedFacts = {};
  for (const [section, fields] of Object.entries(MINIMAL_INSPECTION_FACTS)) {
    if (!existingFacts[section]) {
      seedFacts[section] = fields;
    } else {
      // Only seed fields that don't exist yet
      const sectionSeeds = {};
      for (const [k, v] of Object.entries(fields)) {
        if (!existingFacts[section][k]) sectionSeeds[k] = v;
      }
      if (Object.keys(sectionSeeds).length > 0) seedFacts[section] = sectionSeeds;
    }
  }

  if (Object.keys(seedFacts).length > 0) {
    const { status: seedStatus, body: seedBody } = await apiFetch(
      `/api/cases/${caseId}/facts`,
      { method: 'PUT', body: seedFacts }
    );
    if (seedStatus === 200 && seedBody?.ok) {
      log(`  ✓ Seeded inspection defaults: ${Object.keys(seedFacts).join(', ')}`);
    } else {
      log(`  ⚠  Fact seeding failed (${seedStatus}): ${seedBody?.error || 'unknown'}`);
    }
  } else {
    log(`  ✓ No seeding needed — facts already present`);
  }

  // ── Step 6: Extract Charles's actual narratives ───────────────────────────
  let actualNarratives = {};

  if (completedReport) {
    logSection('Step 6: Extracting actual narratives from completed report');

    const extractScript = path.join(PROJECT_ROOT, 'scripts', 'extract_urar_narratives.py');
    try {
      const result = await runPython(extractScript, [completedReport]);
      actualNarratives = result.fields || {};
      log(`  ✓ Extracted ${Object.keys(actualNarratives).length} narrative fields from ${result.pages_extracted} pages`);
      for (const [k, v] of Object.entries(actualNarratives)) {
        log(`    ${k}: "${String(v).slice(0, 80)}..."`);
      }
    } catch (err) {
      log(`  ⚠  Narrative extraction failed: ${err.message}`);
      log('     Will still generate and compare what we can.');
    }
  } else {
    logSection('Step 6: Skipping narrative extraction (no completed report found)');
  }

  // ── Step 7: Generate narratives via cacc-writer ───────────────────────────
  logSection('Step 7: Generating narratives with cacc-writer');

  log('  Triggering generate-all (forceGateBypass=true)...');
  const { status: genStatus, body: genBody, error: genErr } = await apiFetch(
    `/api/cases/${caseId}/generate-all`,
    { method: 'POST', body: { forceGateBypass: true }, timeoutMs: TIMEOUT_MS }
  );

  let generatedNarratives = {};
  let generateOk = false;

  if (genStatus === 503) {
    log('  ⚠  OpenAI API key not configured — generation skipped.');
    log('     Set OPENAI_API_KEY in .env to enable generation comparison.');
  } else if (genStatus === 200 && genBody?.ok) {
    generateOk = true;
    const nGenerated = Object.keys(genBody.results || {}).length;
    const nErrors    = Object.keys(genBody.errors || {}).length;
    log(`  ✓ Generated ${nGenerated} sections (${nErrors} errors)`);
    if (nErrors > 0) {
      log(`  Errors: ${JSON.stringify(genBody.errors).slice(0, 200)}`);
    }
    generatedNarratives = genBody.results || {};
    // Also pull outputs from case record
    const { body: caseBodyAfter } = await apiFetch(`/api/cases/${caseId}`);
    const outputs = caseBodyAfter?.outputs || {};
    for (const [k, v] of Object.entries(outputs)) {
      if (v?.text && !generatedNarratives[k]) {
        generatedNarratives[k] = { text: v.text };
      }
    }
  } else if (genStatus === 409) {
    log(`  ⚠  Generation blocked by pre-draft gate: ${genBody?.error || ''}`);
    log(`     Gate details: ${JSON.stringify(genBody?.gate || {}).slice(0, 200)}`);
  } else {
    log(`  ⚠  Generation returned status ${genStatus}: ${genErr || JSON.stringify(genBody)?.slice(0, 150)}`);
  }

  // ── Step 8: Compare and grade ─────────────────────────────────────────────
  logSection('Step 8: Comparison Report');

  if (Object.keys(actualNarratives).length === 0 && Object.keys(generatedNarratives).length === 0) {
    log('  ⚠  No narratives available for comparison.');
    log('     Either the completed report could not be found/parsed, or generation was not run.');
  } else {
    const fields = [
      ...new Set([...Object.keys(actualNarratives), ...Object.keys(generatedNarratives)]),
    ].filter(f => NARRATIVE_FIELDS.includes(f) || actualNarratives[f] || generatedNarratives[f]);

    log('');
    log('  SIMILARITY SCORES (word overlap):');
    log('  ' + '─'.repeat(100));
    log(`  ${'Field'.padEnd(30)} ${'Sim %'.padEnd(12)} ${'Generated (first 60 chars)'.padEnd(50)}`);
    log('  ' + '─'.repeat(100));

    const scores = [];
    for (const field of fields) {
      const generated = generatedNarratives[field]?.text || generatedNarratives[field] || '';
      const actual = actualNarratives[field] || '';
      const similarity = wordOverlapSimilarity(generated, actual);
      scores.push({ field, similarity, generated, actual });

      const genPreview = String(generated).replace(/\n/g, ' ').slice(0, 60) || '(not generated)';
      const marker = similarity >= 40 ? '✓' : similarity >= 20 ? '~' : actual ? '✗' : '-';
      log(`  ${field.padEnd(30)} [${String(similarity).padStart(3)}%] ${marker}  ${genPreview}`);
    }

    log('  ' + '─'.repeat(100));

    const scoredFields = scores.filter(s => s.actual && s.generated);
    if (scoredFields.length > 0) {
      const avgSim = Math.round(scoredFields.reduce((a, s) => a + s.similarity, 0) / scoredFields.length);
      const highSim = scores.filter(s => s.similarity >= 40).length;
      log('');
      log(`  Fields compared: ${scoredFields.length} of ${scores.length}`);
      log(`  Average similarity: ${avgSim}%`);
      log(`  High similarity (≥40%): ${highSim} fields`);
      log('');
      log('  Interpretation:');
      log('  0-10%  = Very different (expected for first run with no training data)');
      log('  10-30% = Some overlap (facts present, style diverges)');
      log('  30-50% = Good overlap (similar structure and content)');
      log('  50%+   = Strong match (similar to how Charles writes it)');
    } else if (scores.length > 0 && !completedReport) {
      log('');
      log('  (No completed report available for comparison — generation-only mode)');
      log(`  Generated ${scores.filter(s => s.generated).length} section(s) successfully.`);
    }

    // Detailed comparison
    if (scores.some(s => s.actual && s.generated)) {
      log('');
      log('\n  DETAILED COMPARISON:');
      for (const { field, similarity, generated, actual } of scores) {
        if (!actual && !generated) continue;
        log(`\n  ┌─ ${field} (${similarity}% similarity) ${'─'.repeat(Math.max(0, 55 - field.length))}`);
        if (actual) {
          log(`  │ ACTUAL:    "${actual.replace(/\n/g, ' ').slice(0, 120)}"`);
        }
        if (generated) {
          log(`  │ GENERATED: "${String(generated).replace(/\n/g, ' ').slice(0, 120)}"`);
        }
        if (!actual) log('  │ ⚠  No actual text available for comparison');
        if (!generated) log('  │ ⚠  Not generated (API key or gate issue)');
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  logSection('Cleanup');

  const { status: delStatus } = await fetch(`${SERVER_BASE}/api/cases/${caseId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  }).then(r => ({ status: r.status })).catch(() => ({ status: 0 }));

  if (delStatus === 200) {
    log(`  ✓ Test case ${caseId} deleted`);
  } else {
    log(`  ⚠  Could not delete test case ${caseId} (status: ${delStatus})`);
  }

  logSection('Test Complete');
  log('');
  log('  This test measures whether cacc-writer can reproduce Charles\'s writing.');
  log('  Run it periodically as you add voice examples and training data.');
  log('  Goal: push average similarity above 40% for the key narrative fields.');
  log('');
}

main().catch(err => {
  console.error('\n  FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
