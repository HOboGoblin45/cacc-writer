/**
 * _test_thorough.mjs
 * Thorough integration tests covering PDF upload, extract-facts, questionnaire,
 * grade, generate-all, pipeline management, section approval, KB management,
 * and health endpoints.
 *
 * Requires: server running at http://localhost:5178 with OPENAI_API_KEY set.
 * Usage: node _test_thorough.mjs
 */

const BASE = 'http://localhost:5178';
let passed = 0, failed = 0, warned = 0, caseId = null;

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

async function upload(path, fieldName, filename, buffer, mimeType, extraFields = {}) {
  const form = new FormData();
  form.append(fieldName, new Blob([buffer], { type: mimeType }), filename);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  const res = await fetch(BASE + path, { method: 'POST', body: form });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

function pass(label, detail) {
  console.log(`  ✓ ${label}`);
  if (detail) console.log(`    ${detail}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    → ${detail}`);
  failed++;
}

function warn(label, detail) {
  console.log(`  ⚠ ${label}`);
  if (detail) console.log(`    → ${detail}`);
  warned++;
}

function section(title) {
  console.log(`\n${title}`);
}

function truncate(str, n = 120) {
  if (!str) return '(empty)';
  const s = String(str);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Minimal PDF builder ───────────────────────────────────────────────────────
// Creates a valid PDF with enough text for pdf-parse to extract (>= 200 chars).
function buildMinimalPDF(textContent) {
  const streamContent = `BT\n/F1 10 Tf\n50 750 Td\n${
    textContent.split('\n').map((line, i) =>
      (i === 0 ? `(${line}) Tj` : `0 -14 Td\n(${line}) Tj`)
    ).join('\n')
  }\nET`;

  const streamLen = Buffer.byteLength(streamContent, 'utf8');

  const obj1 = `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`;
  const obj2 = `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`;
  const obj3 = `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n`;
  const obj4 = `4 0 obj<</Length ${streamLen}>>\nstream\n${streamContent}\nendstream\nendobj\n`;
  const obj5 = `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`;

  const header = `%PDF-1.4\n`;
  let offset = Buffer.byteLength(header, 'utf8');

  const off1 = offset; offset += Buffer.byteLength(obj1, 'utf8');
  const off2 = offset; offset += Buffer.byteLength(obj2, 'utf8');
  const off3 = offset; offset += Buffer.byteLength(obj3, 'utf8');
  const off4 = offset; offset += Buffer.byteLength(obj4, 'utf8');
  const off5 = offset; offset += Buffer.byteLength(obj5, 'utf8');

  const xrefOffset = offset;
  const pad = (n) => String(n).padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(off1)} 00000 n \n${pad(off2)} 00000 n \n${pad(off3)} 00000 n \n${pad(off4)} 00000 n \n${pad(off5)} 00000 n \n`;
  const trailer = `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer, 'utf8');
}

// ── Test Suite ────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  CACC Writer Thorough Integration Tests');
console.log('  Target: ' + BASE);
console.log('══════════════════════════════════════════════════════');

// ── 1. Setup ──────────────────────────────────────────────────────────────────
section('1. Setup — Create case');

{
  const { status, json } = await req('POST', '/api/cases/create', {
    formType: '1004',
    address: '456 Oak Ave, Bloomington, IL 61701',
    borrower: 'Thorough Test Borrower',
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

// ── 2. Health Detailed ────────────────────────────────────────────────────────
section('2. GET /api/health/detailed');

{
  const { status, json } = await req('GET', '/api/health/detailed');
  if (status === 200 && json.ok) {
    pass('Health detailed', `version=${json.version} model=${json.model} uptime=${json.uptimeS}s aiKeySet=${json.aiKeySet} kb.total=${json.kb?.totalExamples} cases=${json.cases?.total}`);
    if (!json.aiKeySet) warn('aiKeySet is false — AI endpoints will fail');
    if (!json.kb?.totalExamples) warn('KB has 0 examples — generation will have no style examples');
  } else {
    fail('Health detailed', `status=${status} error=${json.error}`);
  }
}

// ── 3. PDF Upload ─────────────────────────────────────────────────────────────
section('3. POST /api/cases/:id/upload — PDF upload');

let docTextInjected = false;
{
  const pdfText = [
    'UNIFORM RESIDENTIAL APPRAISAL REPORT',
    'Subject Property: 456 Oak Avenue Bloomington Illinois 61701',
    'Property Type: Single Family Residential',
    'Gross Living Area: 2100 square feet',
    'Year Built: 2001 Bedrooms: 4 Bathrooms: 2.5',
    'Garage: 2-car attached Basement: Full unfinished',
    'Condition: Good Quality: Q3 Site Area: 0.30 acres',
    'Zoning: R-1 Single Family Residential',
    'Flood Zone: Zone X minimal flood hazard',
    'Neighborhood: West Side Bloomington',
    'Market Conditions: Stable with moderate appreciation',
    'Opinion of Value: 310000 Effective Date: 2024-03-01',
    'Intended Use: Mortgage financing Intended User: First National Bank',
    'Comparable Sale 1: 450 Maple St sold for 305000 on 2024-01-10',
    'Comparable Sale 2: 789 Pine Ave sold for 315000 on 2024-02-05',
    'Comparable Sale 3: 321 Elm St sold for 298000 on 2023-12-15',
  ].join('\n');

  const pdfBuffer = buildMinimalPDF(pdfText);
  console.log(`  → Uploading synthetic PDF (${pdfBuffer.length} bytes)…`);

  const { status, json } = await upload(
    `/api/cases/${caseId}/upload`,
    'file', 'test_appraisal.pdf', pdfBuffer, 'application/pdf',
    { docType: 'appraisal_report' }
  );

  if (status === 200 && json.ok) {
    pass(`PDF uploaded`, `docType=${json.docType} wordCount=${json.wordCount} pages=${json.pages}`);
    docTextInjected = true;
  } else {
    fail('PDF upload', `status=${status} error=${json.error || json._raw?.slice(0, 200)}`);
    // Fallback: inject doc_text via facts so extract-facts can still run
    console.log('  → Falling back: injecting doc_text via direct facts for extract-facts test');
  }
}

// ── 4. Extract Facts ──────────────────────────────────────────────────────────
section('4. POST /api/cases/:id/extract-facts — AI fact extraction from document');

{
  // If PDF upload failed, provide answers directly so extract-facts still runs
  const answers = docTextInjected ? {} : {
    'Subject address': '456 Oak Ave, Bloomington, IL 61701',
    'GLA': '2100 sq ft',
    'Year built': '2001',
    'Bedrooms': '4',
    'Bathrooms': '2.5',
    'Opinion of value': '$310,000',
  };

  console.log(`  → Calling AI to extract facts from ${docTextInjected ? 'uploaded PDF' : 'provided answers'} (may take 15–30s)…`);
  const start = Date.now();
  const { status, json } = await req('POST', `/api/cases/${caseId}/extract-facts`, { answers });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok && json.facts) {
    const factCount = Object.keys(json.facts).filter(k => k !== 'extractedAt').length;
    pass(`Extract-facts completed (${elapsed}s)`, `${factCount} fact keys extracted`);
    // Show a few extracted facts
    const sample = Object.entries(json.facts)
      .filter(([k]) => k !== 'extractedAt' && k !== 'updatedAt')
      .slice(0, 4);
    for (const [k, v] of sample) {
      const val = v?.value ?? v;
      if (val) console.log(`    ${k}: ${String(val).slice(0, 60)}`);
    }
  } else if (status === 400 && json.error?.includes('No documents')) {
    warn('Extract-facts skipped — no doc_text and no answers provided', json.error);
  } else {
    fail('Extract-facts', `status=${status} error=${json.error}`);
  }
}

// ── 5. Save facts for downstream tests ───────────────────────────────────────
section('5. PUT /api/cases/:id/facts — Save structured facts');

{
  const { status, json } = await req('PUT', `/api/cases/${caseId}/facts`, {
    subject_address:   { value: '456 Oak Ave, Bloomington, IL 61701', confidence: 'high' },
    subject_city:      { value: 'Bloomington', confidence: 'high' },
    subject_state:     { value: 'IL', confidence: 'high' },
    subject_zip:       { value: '61701', confidence: 'high' },
    property_type:     { value: 'Single Family Residential', confidence: 'high' },
    gross_living_area: { value: '2,100 sq ft', confidence: 'high' },
    year_built:        { value: '2001', confidence: 'high' },
    bedrooms:          { value: '4', confidence: 'high' },
    bathrooms:         { value: '2.5', confidence: 'high' },
    condition:         { value: 'Good', confidence: 'high' },
    opinion_of_value:  { value: '$310,000', confidence: 'high' },
    market_conditions: { value: 'Stable', confidence: 'high' },
    flood_zone:        { value: 'Zone X', confidence: 'high' },
    zoning:            { value: 'R-1', confidence: 'high' },
  });
  if (status === 200 && json.ok) {
    pass('Facts saved', `${Object.keys(json.facts).length} keys`);
  } else {
    fail('Save facts', `status=${status}`);
  }
}

// ── 6. Questionnaire ──────────────────────────────────────────────────────────
section('6. POST /api/cases/:id/questionnaire — AI-generated intake questions');

{
  console.log('  → Calling AI to generate questionnaire (may take 10–20s)…');
  const start = Date.now();
  const { status, json } = await req('POST', `/api/cases/${caseId}/questionnaire`, {});
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok && Array.isArray(json.questions)) {
    pass(`Questionnaire generated (${elapsed}s)`, `${json.questions.length} questions`);
    for (const q of json.questions.slice(0, 3)) {
      console.log(`    [${q.required ? 'required' : 'optional'}] ${truncate(q.question, 100)}`);
    }
  } else {
    fail('Questionnaire', `status=${status} error=${json.error}`);
  }
}

// ── 7. Generate-All ───────────────────────────────────────────────────────────
section('7. POST /api/cases/:id/generate-all — Generate all form fields');

let generatedFields = [];
{
  console.log('  → Generating all 1004 fields (may take 30–90s)…');
  const start = Date.now();
  const { status, json } = await req('POST', `/api/cases/${caseId}/generate-all`, {
    twoPass: false,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (status === 200 && json.ok) {
    generatedFields = Object.keys(json.results || {});
    const errorCount = Object.keys(json.errors || {}).length;
    if (generatedFields.length > 0) {
      pass(`Generate-all completed (${elapsed}s)`, `${generatedFields.length} generated, ${errorCount} errors, stage=${json.pipelineStage}`);
      for (const k of generatedFields.slice(0, 3)) {
        const t = json.results[k];
        console.log(`    [${k}] ${t.text?.length || 0} chars — "${truncate(t.text, 80)}"`);
      }
      if (errorCount > 0) {
        console.log(`    ⚠ Errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
      }
    } else {
      fail('Generate-all returned 0 results', `errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }
  } else {
    fail('Generate-all', `status=${status} error=${json.error}`);
  }
}

// ── 8. Grade ──────────────────────────────────────────────────────────────────
section('8. POST /api/cases/:id/grade — AI narrative grading');

{
  if (generatedFields.length === 0) {
    warn('Grade skipped — no generated outputs available');
  } else {
    console.log('  → Calling AI to grade generated narratives (may take 15–30s)…');
    const start = Date.now();
    const { status, json } = await req('POST', `/api/cases/${caseId}/grade`, {});
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (status === 200 && json.ok && json.grade) {
      const g = json.grade;
      pass(`Grade completed (${elapsed}s)`, `score=${g.score}/100 missing=${g.missing?.length || 0} issues=${g.inconsistencies?.length || 0} strengths=${g.strengths?.length || 0}`);
      if (g.summary) console.log(`    Summary: "${truncate(g.summary, 160)}"`);
      if (g.missing?.length > 0) {
        console.log(`    Missing fields (first 2):`);
        for (const m of g.missing.slice(0, 2)) {
          console.log(`      [${m.severity}] ${m.field}: ${truncate(m.issue, 80)}`);
        }
      }
    } else {
      fail('Grade', `status=${status} error=${json.error}`);
    }
  }
}

// ── 9. Section Approval ───────────────────────────────────────────────────────
section('9. PATCH /api/cases/:id/outputs/:fieldId — Section approval + KB save');

{
  const fieldToApprove = generatedFields[0];
  if (!fieldToApprove) {
    warn('Section approval skipped — no generated fields available');
  } else {
    const { status, json } = await req('PATCH', `/api/cases/${caseId}/outputs/${fieldToApprove}`, {
      approved: true,
    });
    if (status === 200 && json.ok) {
      pass(`Section approved: ${fieldToApprove}`, `approved=${json.approved} updatedAt=${json.updatedAt}`);
    } else {
      fail('Section approval', `status=${status} error=${json.error}`);
    }
  }
}

// ── 10. Pipeline Stage Management ─────────────────────────────────────────────
section('10. PATCH /api/cases/:id/pipeline — Pipeline stage management');

{
  for (const stage of ['review', 'approved', 'inserting', 'complete']) {
    const { status, json } = await req('PATCH', `/api/cases/${caseId}/pipeline`, { stage });
    if (status === 200 && json.ok && json.pipelineStage === stage) {
      pass(`Pipeline → ${stage}`);
    } else {
      fail(`Pipeline → ${stage}`, `status=${status} error=${json.error}`);
    }
  }

  // Test invalid stage
  const { status: badStatus, json: badJson } = await req('PATCH', `/api/cases/${caseId}/pipeline`, { stage: 'invalid_stage' });
  if (badStatus === 400) {
    pass('Pipeline rejects invalid stage (400)');
  } else {
    fail('Pipeline invalid stage validation', `expected 400 got ${badStatus}`);
  }
}

// ── 11. Case History ──────────────────────────────────────────────────────────
section('11. GET /api/cases/:id/history — Output history');

{
  const { status, json } = await req('GET', `/api/cases/${caseId}/history`);
  if (status === 200 && json.ok) {
    const histKeys = Object.keys(json.history || {});
    pass('Case history', `${histKeys.length} fields with history`);
  } else {
    fail('Case history', `status=${status} error=${json.error}`);
  }
}

// ── 12. KB Management ─────────────────────────────────────────────────────────
section('12. KB Management — status, reindex, migrate-voice');

{
  // GET /api/kb/status
  const { status: s1, json: j1 } = await req('GET', '/api/kb/status');
  if (s1 === 200 && j1.ok) {
    pass('KB status', `total=${j1.totalExamples} approved=${j1.counts?.approved_edits} imported=${j1.counts?.imported_examples} phrases=${j1.counts?.phrases}`);
  } else {
    fail('KB status', `status=${s1} error=${j1.error}`);
  }

  // POST /api/kb/reindex
  const { status: s2, json: j2 } = await req('POST', '/api/kb/reindex');
  if (s2 === 200 && j2.ok) {
    pass('KB reindex', `total=${j2.total} counts=${JSON.stringify(j2.counts)}`);
  } else {
    fail('KB reindex', `status=${s2} error=${j2.error}`);
  }

  // POST /api/kb/migrate-voice (idempotent — already migrated is fine)
  const { status: s3, json: j3 } = await req('POST', '/api/kb/migrate-voice');
  if (s3 === 200 && j3.ok) {
    pass('KB migrate-voice', `migrated=${j3.migrated} skipped=${j3.skipped} total=${j3.total}`);
  } else {
    fail('KB migrate-voice', `status=${s3} error=${j3.error}`);
  }
}

// ── 13. Case List and Detail ──────────────────────────────────────────────────
section('13. GET /api/cases + GET /api/cases/:id — Case list and detail');

{
  const { status: s1, json: j1 } = await req('GET', '/api/cases');
  if (s1 === 200 && j1.ok && Array.isArray(j1.cases)) {
    const found = j1.cases.find(c => c.caseId === caseId);
    pass('Case list', `${j1.cases.length} cases, test case found=${Boolean(found)}, stage=${found?.pipelineStage}`);
  } else {
    fail('Case list', `status=${s1} error=${j1.error}`);
  }

  const { status: s2, json: j2 } = await req('GET', `/api/cases/${caseId}`);
  if (s2 === 200 && j2.ok) {
    const outputCount = Object.keys(j2.outputs || {}).filter(k => k !== 'updatedAt').length;
    pass('Case detail', `formType=${j2.meta?.formType} stage=${j2.meta?.pipelineStage} outputs=${outputCount} docSummary=${Object.keys(j2.docSummary || {}).length} docs`);
  } else {
    fail('Case detail', `status=${s2} error=${j2.error}`);
  }
}

// ── 14. Case Status Update ────────────────────────────────────────────────────
section('14. PATCH /api/cases/:id/status — Case status management');

{
  for (const status of ['submitted', 'archived', 'active']) {
    const { status: s, json: j } = await req('PATCH', `/api/cases/${caseId}/status`, { status });
    if (s === 200 && j.ok && j.meta?.status === status) {
      pass(`Status → ${status}`);
    } else {
      fail(`Status → ${status}`, `status=${s} error=${j.error}`);
    }
  }

  // Invalid status
  const { status: badS, json: badJ } = await req('PATCH', `/api/cases/${caseId}/status`, { status: 'invalid' });
  if (badS === 400) {
    pass('Status rejects invalid value (400)');
  } else {
    fail('Status invalid validation', `expected 400 got ${badS}`);
  }
}

// ── 15. Neighborhood Templates ────────────────────────────────────────────────
section('15. Neighborhood Templates — CRUD');

let templateId = null;
{
  // Create
  const { status: s1, json: j1 } = await req('POST', '/api/templates/neighborhood', {
    name: 'Test Template — East Side',
    boundaries: 'North: Veterans Pkwy, South: Empire St, East: Towanda Ave, West: Main St',
    description: 'Established residential neighborhood with mix of 1970s–2000s construction.',
  });
  if (s1 === 200 && j1.ok) {
    templateId = j1.templates?.find(t => t.name === 'Test Template — East Side')?.id;
    pass('Template created', `id=${templateId}`);
  } else {
    fail('Template create', `status=${s1} error=${j1.error}`);
  }

  // List
  const { status: s2, json: j2 } = await req('GET', '/api/templates/neighborhood');
  if (s2 === 200 && j2.ok && Array.isArray(j2.templates)) {
    pass('Template list', `${j2.templates.length} templates`);
  } else {
    fail('Template list', `status=${s2}`);
  }

  // Delete
  if (templateId) {
    const { status: s3, json: j3 } = await req('DELETE', `/api/templates/neighborhood/${templateId}`);
    if (s3 === 200 && j3.ok) {
      pass('Template deleted');
    } else {
      fail('Template delete', `status=${s3} error=${j3.error}`);
    }
  }
}

// ── 16. Voice Examples API ────────────────────────────────────────────────────
section('16. GET /api/voice/examples + folder-status');

{
  const { status: s1, json: j1 } = await req('GET', '/api/voice/examples');
  if (s1 === 200 && j1.ok) {
    pass('Voice examples list', `total=${j1.total} imports=${Object.keys(j1.imports || {}).length}`);
  } else {
    fail('Voice examples list', `status=${s1}`);
  }

  const { status: s2, json: j2 } = await req('GET', '/api/voice/folder-status?formType=1004');
  if (s2 === 200 && j2.ok) {
    pass('Voice folder status', `formType=${j2.formType} folderExists=${j2.folderExists} files=${j2.total || 0}`);
  } else {
    fail('Voice folder status', `status=${s2}`);
  }
}

// ── 17. Forms API ─────────────────────────────────────────────────────────────
section('17. GET /api/forms — Form configuration');

{
  const { status: s1, json: j1 } = await req('GET', '/api/forms');
  if (s1 === 200 && j1.ok && Array.isArray(j1.forms)) {
    pass('Forms list', `${j1.forms.length} forms: ${j1.forms.map(f => f.id).join(', ')}`);
  } else {
    fail('Forms list', `status=${s1}`);
  }

  for (const ft of ['1004', '1025', '1073', 'commercial']) {
    const { status, json } = await req('GET', `/api/forms/${ft}`);
    if (status === 200 && json.ok && json.config?.fields?.length > 0) {
      pass(`Form config: ${ft}`, `${json.config.fields.length} fields, ${json.config.voiceFields?.length || 0} voice fields`);
    } else {
      fail(`Form config: ${ft}`, `status=${status} error=${json.error}`);
    }
  }
}

// ── 18. Agent Status ──────────────────────────────────────────────────────────
section('18. GET /api/agents/status — Agent reachability');

{
  const { status, json } = await req('GET', '/api/agents/status');
  if (status === 200 && json.ok) {
    pass('Agent status', `aci=${json.aci} rq=${json.rq}`);
    if (!json.aci) console.log('    ℹ ACI agent not running (expected if not started)');
    if (!json.rq)  console.log('    ℹ RQ agent not running (expected if not started)');
  } else {
    fail('Agent status', `status=${status}`);
  }
}

// ── 19. Error Handling ────────────────────────────────────────────────────────
section('19. Error handling — Invalid inputs and edge cases');

{
  // Invalid caseId format
  const { status: s1 } = await req('GET', '/api/cases/not-valid-id');
  if (s1 === 400) {
    pass('Invalid caseId → 400');
  } else {
    fail('Invalid caseId validation', `expected 400 got ${s1}`);
  }

  // Non-existent case
  const { status: s2 } = await req('GET', '/api/cases/00000000');
  if (s2 === 404) {
    pass('Non-existent case → 404');
  } else {
    fail('Non-existent case', `expected 404 got ${s2}`);
  }

  // Generate without fieldId or prompt
  const { status: s3, json: j3 } = await req('POST', '/api/generate', {});
  if (s3 === 400) {
    pass('Generate without fieldId/prompt → 400');
  } else {
    fail('Generate missing params', `expected 400 got ${s3} error=${j3.error}`);
  }

  // Feedback without fieldId
  const { status: s4 } = await req('POST', `/api/cases/${caseId}/feedback`, { editedText: 'test' });
  if (s4 === 400) {
    pass('Feedback without fieldId → 400');
  } else {
    fail('Feedback missing fieldId', `expected 400 got ${s4}`);
  }

  // Unknown form type
  const { status: s5 } = await req('GET', '/api/forms/unknown_form_type');
  if (s5 === 404) {
    pass('Unknown form type → 404');
  } else {
    fail('Unknown form type', `expected 404 got ${s5}`);
  }
}

// ── 20. Cleanup ───────────────────────────────────────────────────────────────
section('20. Cleanup');

{
  const { status, json } = await req('DELETE', `/api/cases/${caseId}`);
  if (status === 200 && json.ok) {
    pass(`Deleted test case ${caseId}`);
  } else {
    fail('Delete test case', `status=${status}`);
  }
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${warned} warnings`);
console.log('══════════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
