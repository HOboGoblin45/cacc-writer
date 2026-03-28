/**
 * _debug_insert_all.mjs
 * Quick debug script to reproduce the insert-all 6e/6f test failure.
 */
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const BASE       = 'http://localhost:5178';
const CASES_DIR  = path.join(__dirname, 'cases');

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
      },
    };
    const r = http.request(url, opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ _raw: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const post = (path, body) => req('POST', BASE + path, body);

function writeOutputSection(caseId, fieldId, data) {
  const outFile = path.join(CASES_DIR, caseId, 'outputs.json');
  const outputs = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  outputs[fieldId] = { title: fieldId, text: 'Sample narrative text for testing.', approved: false, sectionStatus: 'drafted', ...data };
  outputs.updatedAt = new Date().toISOString();
  fs.writeFileSync(outFile, JSON.stringify(outputs, null, 2));
}

(async () => {
  // Create test case
  const c = await post('/api/cases', { formType: '1004' });
  const caseId = c.caseId;
  console.log('caseId:', caseId);

  // Write approved section (same as test 6 setup)
  writeOutputSection(caseId, 'market_conditions', {
    text:          'Market conditions are stable.',
    sectionStatus: 'approved',
    approved:      true,
  });

  // Read outputs.json before ia1
  const before1 = JSON.parse(fs.readFileSync(path.join(CASES_DIR, caseId, 'outputs.json'), 'utf8'));
  console.log('\nOutputs BEFORE ia1:');
  for (const [k, v] of Object.entries(before1)) {
    if (k !== 'updatedAt') console.log(`  ${k}: sectionStatus=${v?.sectionStatus}, approved=${v?.approved}`);
  }

  // Call insert-all (ia1)
  const ia1 = await post(`/api/cases/${caseId}/insert-all`, {});
  console.log('\nia1 response:', JSON.stringify(ia1));

  // Read outputs.json after ia1
  const after1 = JSON.parse(fs.readFileSync(path.join(CASES_DIR, caseId, 'outputs.json'), 'utf8'));
  console.log('\nOutputs AFTER ia1:');
  for (const [k, v] of Object.entries(after1)) {
    if (k !== 'updatedAt') console.log(`  ${k}: sectionStatus=${v?.sectionStatus}, approved=${v?.approved}`);
  }

  // Write drafted sections (same as test 6e/6f setup)
  writeOutputSection(caseId, 'market_conditions',       { text: 'Test', sectionStatus: 'drafted', approved: false });
  writeOutputSection(caseId, 'neighborhood_description', { text: 'Test', sectionStatus: 'drafted', approved: false });

  // Read outputs.json before ia2
  const before2 = JSON.parse(fs.readFileSync(path.join(CASES_DIR, caseId, 'outputs.json'), 'utf8'));
  console.log('\nOutputs BEFORE ia2 (after writing drafted sections):');
  for (const [k, v] of Object.entries(before2)) {
    if (k !== 'updatedAt') console.log(`  ${k}: sectionStatus=${v?.sectionStatus}, approved=${v?.approved}`);
  }

  // Call insert-all (ia2) — should return ok:false
  const ia2 = await post(`/api/cases/${caseId}/insert-all`, {});
  console.log('\nia2 response:', JSON.stringify(ia2));
  console.log('\n6e check (ia2.ok === false):', ia2.ok === false, '← should be true');
  console.log('6f check (typeof ia2.error === string):', typeof ia2.error === 'string', '← should be true');

  // Cleanup
  fs.rmSync(path.join(CASES_DIR, caseId), { recursive: true, force: true });
  console.log('\nTest case deleted.');
})();
