/**
 * _test_voice_write.mjs
 * Targeted test: approval → approvedNarratives disk write
 * Runs after server restart to confirm addApprovedNarrative is live.
 */
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:5178';
const log = (label, ok, detail) => console.log((ok ? '  PASS' : '  FAIL') + ' ' + label + (detail ? ' — ' + detail : ''));

async function run() {
  console.log('\n=== Voice Engine Disk Write Validation ===\n');

  // 1. Create case with full metadata
  let r = await fetch(BASE + '/api/cases/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formType: '1004', address: '789 Voice Test Ln',
      assignmentPurpose: 'purchase', loanProgram: 'conventional',
      propertyType: 'single_family', subjectCondition: 'C3',
      state: 'IL', county: 'McLean', city: 'Bloomington',
      marketArea: 'Central Illinois', neighborhood: 'Eastside',
    }),
  });
  let d = await r.json();
  const cid = d.caseId;
  log('[1] Create case', d.ok, 'caseId=' + cid);

  // 2. Write a section output directly (simulates generate-core result)
  const outFile = path.join(process.cwd(), 'cases', cid, 'outputs.json');
  const outputs = {
    neighborhood_description: {
      text: 'The subject neighborhood is a well-established suburban area in Bloomington, McLean County, Illinois, characterized by stable market conditions and consistent demand for single-family residential properties. The area exhibits balanced supply and demand with typical marketing times of 30 to 60 days.',
      sectionStatus: 'drafted',
      approved: false,
      updatedAt: new Date().toISOString(),
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(outputs, null, 2));
  log('[2] Wrote outputs.json with section text', true);

  // 3. Approve the section via API
  r = await fetch(BASE + '/api/cases/' + cid + '/sections/neighborhood_description/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  });
  d = await r.json();
  log('[3a] Approve section → ok', d.ok);
  log('[3b] sectionStatus=approved', d.sectionStatus === 'approved');
  log('[3c] approved=true', d.approved === true);

  // 4. Check approvedNarratives disk write
  const narDir = path.join(process.cwd(), 'knowledge_base', 'approvedNarratives');
  const indexPath = path.join(narDir, 'index.json');
  const indexExists = fs.existsSync(indexPath);
  log('[4a] approvedNarratives/index.json exists', indexExists);

  if (indexExists) {
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const entries = Array.isArray(idx.entries) ? idx.entries : [];
    log('[4b] index has entries', entries.length > 0, 'count=' + entries.length);

    // Find the entry for this case
    const match = entries.find(e => e.sourceReportId === cid || e.sectionType === 'neighborhood_description');
    log('[4c] entry found for this approval', Boolean(match));

    if (match) {
      log('[4d] entry.sectionType correct', match.sectionType === 'neighborhood_description');
      log('[4e] entry.formType correct', match.formType === '1004');
      log('[4f] entry.approvalTimestamp present', Boolean(match.approvalTimestamp));
      log('[4g] entry.subjectCondition=C3', match.subjectCondition === 'C3');
      log('[4h] entry.state=IL', match.state === 'IL');
      log('[4i] entry.county=McLean', match.county === 'McLean');
      log('[4j] entry.sourceType=approvedNarrative', match.sourceType === 'approvedNarrative');

      // Check individual entry file has text
      const entryFile = path.join(narDir, match.id + '.json');
      const fileExists = fs.existsSync(entryFile);
      log('[4k] individual entry file exists', fileExists);
      if (fileExists) {
        const entry = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
        log('[4l] entry file has text', Boolean(entry.text && entry.text.length > 50));
        log('[4m] entry text matches approved text', entry.text === outputs.neighborhood_description.text);
      }
    }
  }

  // 5. Test feedback approval path (edited text)
  r = await fetch(BASE + '/api/cases/' + cid + '/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fieldId: 'market_conditions',
      originalText: 'Original draft.',
      editedText: 'The subject market demonstrates stable absorption rates with balanced supply and demand conditions as of the effective date of appraisal.',
      rating: 'up',
    }),
  });
  d = await r.json();
  log('[5a] Feedback approval → ok', d.ok);
  log('[5b] savedToKB=true', d.savedToKB === true);

  // 6. Repeated approval — no corruption
  r = await fetch(BASE + '/api/cases/' + cid + '/sections/neighborhood_description/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' }),
  });
  d = await r.json();
  log('[6] Repeated approval → still ok', d.ok);

  // 7. Verify index count increased (not duplicated)
  const idx2 = JSON.parse(fs.readFileSync(path.join(narDir, 'index.json'), 'utf8'));
  const entries2 = Array.isArray(idx2.entries) ? idx2.entries : [];
  const thisCase = entries2.filter(e => e.sourceReportId === cid);
  log('[7] No duplicate spam (≤2 entries for this case)', thisCase.length <= 2, 'count=' + thisCase.length);

  // Cleanup
  await fetch(BASE + '/api/cases/' + cid, { method: 'DELETE' });

  console.log('\n=== Voice write validation complete ===\n');
}

run().catch(e => console.error('FATAL:', e.message));
