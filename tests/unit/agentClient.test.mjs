/**
 * tests/unit/agentClient.test.mjs
 * Unit tests for server/insertion/agentClient.js
 * Run: node tests/unit/agentClient.test.mjs
 */

import assert from 'assert/strict';
import { callAgentInsert, readFieldFromAgent } from '../../server/insertion/agentClient.js';

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
  };
}

console.log('\nagentClient');

const originalFetch = global.fetch;

await test('callAgentInsert sends the live agent payload and accepts ok+inserted success', async () => {
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return createJsonResponse(200, { ok: true, inserted: true, verified: true, method: 'aci' });
  };

  const result = await callAgentInsert({
    fieldId: 'neighborhood_description',
    text: 'Narrative',
    formType: '1004',
    agentBaseUrl: 'http://localhost:5180',
    timeout: 500,
  });

  assert.equal(result.success, true);
  assert.equal(seen.url, 'http://localhost:5180/insert');
  assert.deepEqual(JSON.parse(seen.options.body), {
    fieldId: 'neighborhood_description',
    text: 'Narrative',
    formType: '1004',
  });
});

await test('callAgentInsert does not treat ok+inserted=false as a successful live insert', async () => {
  global.fetch = async () => createJsonResponse(200, {
    ok: true,
    inserted: false,
    message: 'stub mode',
  });

  const result = await callAgentInsert({
    fieldId: 'market_area',
    text: 'Commercial narrative',
    formType: 'commercial',
    agentBaseUrl: 'http://localhost:5181',
    timeout: 500,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'insertion_rejected');
});

await test('readFieldFromAgent sends fieldId/formType and returns text values', async () => {
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return createJsonResponse(200, { ok: true, text: 'Read back value' });
  };

  const value = await readFieldFromAgent({
    fieldId: 'reconciliation',
    formType: 'commercial',
    agentBaseUrl: 'http://localhost:5181',
    timeout: 500,
  });

  assert.equal(value, 'Read back value');
  assert.equal(seen.url, 'http://localhost:5181/read-field');
  assert.deepEqual(JSON.parse(seen.options.body), {
    fieldId: 'reconciliation',
    formType: 'commercial',
    targetRect: null,
  });
});

await test('readFieldFromAgent forwards targetRect when exact geometry is available', async () => {
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return createJsonResponse(200, { ok: true, text: 'Exact match value' });
  };

  const value = await readFieldFromAgent({
    fieldId: 'neighborhood_description',
    formType: '1004',
    agentBaseUrl: 'http://localhost:5180',
    targetRect: { left: 1031, top: 363, width: 825, height: 177 },
    timeout: 500,
  });

  assert.equal(value, 'Exact match value');
  assert.deepEqual(JSON.parse(seen.options.body), {
    fieldId: 'neighborhood_description',
    formType: '1004',
    targetRect: { left: 1031, top: 363, width: 825, height: 177 },
  });
});

await test('callAgentInsert forwards section hints for nested ACI field maps', async () => {
  let seen = null;
  global.fetch = async (url, options) => {
    seen = { url, options };
    return createJsonResponse(200, { ok: true, inserted: true });
  };

  await callAgentInsert({
    fieldId: 'market_conditions',
    text: 'Narrative',
    formType: '1004',
    section: 'narratives',
    agentBaseUrl: 'http://localhost:5180',
    timeout: 500,
  });

  assert.deepEqual(JSON.parse(seen.options.body), {
    fieldId: 'market_conditions',
    text: 'Narrative',
    formType: '1004',
    section: 'narratives',
  });
});

await test('readFieldFromAgent throws when the agent returns an explicit read failure', async () => {
  global.fetch = async () => createJsonResponse(200, {
    ok: false,
    error: 'fieldId is required',
  });

  await assert.rejects(
    () => readFieldFromAgent({
      fieldId: 'site_description',
      formType: '1004',
      agentBaseUrl: 'http://localhost:5180',
      timeout: 500,
    }),
    /fieldId is required/,
  );
});

global.fetch = originalFetch;

console.log('\n' + '-'.repeat(60));
console.log(`agentClient: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
