import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function httpPost(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port,
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': body.length },
      timeout: 120000
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function uploadPdf(caseId, pdfPath, docType) {
  const boundary = '----TestBoundary' + Date.now();
  const fileBuffer = fs.readFileSync(pdfPath);
  const filename = path.basename(pdfPath);
  const pre = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="docType"\r\n\r\n' +
    docType + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
    'Content-Type: application/pdf\r\n\r\n'
  );
  const post = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([pre, fileBuffer, post]);
  return httpPost(
    'http://localhost:5178/api/cases/' + caseId + '/upload',
    body,
    'multipart/form-data; boundary=' + boundary
  );
}

async function jsonPost(url, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return httpPost(url, body, 'application/json');
}

const CID = '98e488d5';
const PDF = path.join(__dirname, 'voice_pdfs', '1004', '47674.PDF');

console.log('=== DOCUMENT UPLOAD ===');
const up = await uploadPdf(CID, PDF, 'purchase_contract');
console.log('upload status:', up.status);
console.log('upload ok:', up.body.ok, '| docType:', up.body.docType, '| filename:', up.body.filename, '| error:', up.body.error);

if (up.body.ok) {
  console.log('\n=== EXTRACT-FACTS (with uploaded doc) ===');
  const ef = await jsonPost('http://localhost:5178/api/cases/' + CID + '/extract-facts', {});
  console.log('extract-facts status:', ef.status);
  console.log('extract-facts ok:', ef.body.ok, '| error:', ef.body.error);
  if (ef.body.facts) {
    const sections = Object.keys(ef.body.facts);
    console.log('facts sections:', sections.join(', '));
    if (ef.body.facts.subject) {
      const s = ef.body.facts.subject;
      console.log('  subject.address:', s.address, '| gla:', s.gla, '| beds:', s.beds);
    }
  }
}

console.log('\n=== VOICE IMPORT ===');
// voice import uses its own endpoint
const voiceBoundary = '----VoiceBoundary' + Date.now();
const voiceFileBuffer = fs.readFileSync(PDF);
const voiceFilename = path.basename(PDF);
const voicePre = Buffer.from(
  '--' + voiceBoundary + '\r\n' +
  'Content-Disposition: form-data; name="formType"\r\n\r\n' +
  '1004\r\n' +
  '--' + voiceBoundary + '\r\n' +
  'Content-Disposition: form-data; name="file"; filename="' + voiceFilename + '"\r\n' +
  'Content-Type: application/pdf\r\n\r\n'
);
const voicePost = Buffer.from('\r\n--' + voiceBoundary + '--\r\n');
const voiceBody = Buffer.concat([voicePre, voiceFileBuffer, voicePost]);
const voiceResp = await httpPost(
  'http://localhost:5178/api/voice/import-pdf',
  voiceBody,
  'multipart/form-data; boundary=' + voiceBoundary
);
console.log('voice import status:', voiceResp.status);
console.log('voice import ok:', voiceResp.body.ok, '| extracted:', voiceResp.body.extracted, '| total:', voiceResp.body.total, '| error:', voiceResp.body.error);

console.log('\n=== GRADE (with pasted text) ===');
const pastedText = `NEIGHBORHOOD DESCRIPTION
The subject property is located in a well-established residential neighborhood in Bloomington, IL. 
The area is characterized by single-family residences built primarily between 1980 and 2005. 
Proximity to schools, shopping, and employment centers supports stable demand.

MARKET CONDITIONS
The subject market area reflects stable conditions with a 3-6 month supply of homes. 
Median days on market is approximately 45 days. No significant oversupply or undersupply is noted.`;

const gr = await jsonPost('http://localhost:5178/api/cases/' + CID + '/grade', { pastedText });
console.log('grade status:', gr.status);
console.log('grade ok:', gr.body.ok, '| score:', gr.body.grade?.score, '| error:', gr.body.error);
if (gr.body.grade?.summary) console.log('grade summary:', gr.body.grade.summary.slice(0, 150) + '...');
