import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { extractAndSavePdf } from '../../server/intake/xmlParser.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
    failed++;
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-xml-parser-'));
const simplePdfBase64 = Buffer.from('%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF', 'utf8').toString('base64');

console.log('\nxmlParser');

test('extractAndSavePdf writes a valid PDF to disk', () => {
  const savedPath = extractAndSavePdf(simplePdfBase64, tmpDir, 'sample-report');
  assert.ok(savedPath);
  assert.equal(fs.existsSync(savedPath), true);
  assert.equal(path.extname(savedPath), '.pdf');
});

test('extractAndSavePdf prevents filename traversal from escaping destination', () => {
  const savedPath = extractAndSavePdf(simplePdfBase64, tmpDir, '..\\..\\escape\\evil');
  assert.ok(savedPath);

  const resolvedTmp = path.resolve(tmpDir);
  const resolvedSaved = path.resolve(savedPath);
  const relative = path.relative(resolvedTmp, resolvedSaved);

  assert.equal(relative.startsWith('..'), false);
  assert.equal(path.isAbsolute(relative), false);
  assert.equal(fs.existsSync(savedPath), true);
});

test('extractAndSavePdf rejects non-PDF content', () => {
  const savedPath = extractAndSavePdf(Buffer.from('not-a-pdf', 'utf8').toString('base64'), tmpDir, 'bad-file');
  assert.equal(savedPath, null);
});

console.log('\n' + '-'.repeat(60));
console.log(`xmlParser: ${passed} passed, ${failed} failed`);
console.log('-'.repeat(60));

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failed > 0) process.exit(1);
