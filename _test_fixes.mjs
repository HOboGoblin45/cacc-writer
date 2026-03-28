/**
 * _test_fixes.mjs
 * Quick verification of the two previously failing tests:
 *   1. POST /api/workflow/run  (draftAgent dynamic import fix)
 *   2. POST /api/kb/ingest-to-pinecone  (pinecone env var + ensureIndex fix)
 */
const BASE = 'http://localhost:5178';

async function run() {
  let passed = 0, failed = 0;

  // ── Test 1: workflow/run ──────────────────────────────────────────────────
  console.log('\n[1] POST /api/workflow/run (neighborhood_description)...');
  try {
    const r = await fetch(BASE + '/api/workflow/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId:   'fix-verify-001',
        formType: '1004',
        fieldId:  'neighborhood_description',
        facts: {
          subject: {
            city:   { value: 'Houston', confidence: 'high' },
            county: { value: 'Harris',  confidence: 'high' },
          }
        }
      })
    });
    const d = await r.json();
    const hasText = !!(d.draftText || d.finalText || d.reviewedText);
    const text    = (d.draftText || d.finalText || d.reviewedText || '').slice(0, 120);
    console.log('   HTTP:', r.status, '| stage:', d.currentStage, '| hasText:', hasText);
    if (text)    console.log('   text:', text + '...');
    if (d.error) console.log('   error:', d.error);
    if (r.ok && hasText) { console.log('   ✓ PASS'); passed++; }
    else                 { console.log('   ✗ FAIL'); failed++; }
  } catch (e) {
    console.log('   ✗ FAIL (exception):', e.message); failed++;
  }

  // ── Test 2: ingest-to-pinecone ────────────────────────────────────────────
  console.log('\n[2] POST /api/kb/ingest-to-pinecone...');
  try {
    const r = await fetch(BASE + '/api/kb/ingest-to-pinecone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const d = await r.json();
    console.log('   HTTP:', r.status, '| ok:', d.ok, '| ingested:', d.ingested, '| errors:', d.errors, '| total:', d.total);
    if (r.ok && d.errors === 0) { console.log('   ✓ PASS'); passed++; }
    else                        { console.log('   ✗ FAIL'); failed++; }
  } catch (e) {
    console.log('   ✗ FAIL (exception):', e.message); failed++;
  }

  console.log('\n══════════════════════════════════');
  console.log('  Fix verification:', passed + '/2 passed');
  console.log('══════════════════════════════════\n');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
