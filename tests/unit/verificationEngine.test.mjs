/**
 * tests/unit/verificationEngine.test.mjs
 * Unit tests for server/insertion/verificationEngine.js
 */

import assert from 'assert/strict';
import { verifyInsertion } from '../../server/insertion/verificationEngine.js';

let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

console.log('\nverificationEngine');

const originalFetch = global.fetch;

await test('verifyInsertion passes formType and targetRect through to agent read-back', async () => {
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return createJsonResponse(200, { ok: true, text: 'The market remains stable.' });
  };

  const result = await verifyInsertion({
    fieldId: 'market_conditions',
    agentFieldKey: 'market_conditions',
    formattedText: 'The market remains stable.',
    formType: '1004',
    targetSoftware: 'aci',
    agentBaseUrl: 'http://localhost:5180',
    targetRect: { left: 1031, top: 363, width: 825, height: 177 },
    timeout: 500,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(JSON.parse(seen.options.body), {
    fieldId: 'market_conditions',
    formType: '1004',
    targetRect: { left: 1031, top: 363, width: 825, height: 177 },
  });
});

await test('verifyInsertion reports unreadable when agent read-back returns null', async () => {
  global.fetch = async () => createJsonResponse(200, { ok: true, text: null });

  const result = await verifyInsertion({
    fieldId: 'reconciliation',
    agentFieldKey: 'reconciliation',
    formattedText: 'A reconciliation note.',
    formType: '1004',
    targetSoftware: 'aci',
    agentBaseUrl: 'http://localhost:5180',
    timeout: 500,
  });

  assert.equal(result.status, 'unreadable');
  assert.match(result.mismatchDetail, /null\/empty/i);
});

global.fetch = originalFetch;

console.log('\n' + '-'.repeat(60));
console.log(`verificationEngine: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
