/**
 * tests/unit/agentProbe.test.mjs
 * Unit tests for server/insertion/agentProbe.js
 */

import assert from 'assert/strict';
import {
  getProbeTimeoutMs,
  probeDestinationFields,
  selectProbeFieldIds,
} from '../../server/insertion/agentProbe.js';

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

function createResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

console.log('\nagentProbe');

await test('selectProbeFieldIds preserves explicit field list ordering and uniqueness', async () => {
  const fieldIds = selectProbeFieldIds({
    formType: '1004',
    fieldIds: ['neighborhood_description', 'site_comments', 'neighborhood_description', ''],
  });
  assert.deepEqual(fieldIds, ['neighborhood_description', 'site_comments']);
});

await test('getProbeTimeoutMs enforces longer ACI probe windows without inflating RQ defaults', async () => {
  assert.equal(getProbeTimeoutMs('aci', 6000), 20000);
  assert.equal(getProbeTimeoutMs('aci', 30000), 30000);
  assert.equal(getProbeTimeoutMs('real_quantum', 6000), 6000);
});

await test('probeDestinationFields passes when at least one field is locatable', async () => {
  const calls = [];
  const result = await probeDestinationFields({
    formType: '1004',
    targetSoftware: 'aci',
    fieldIds: ['neighborhood_description', 'site_comments'],
    agentBaseUrl: 'http://localhost:5180',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/health')) {
        return createResponse(200, { ok: true });
      }
      if (url.endsWith('/list-windows')) {
        return createResponse(200, { windows: [{ title: 'ACI Report', class: 'AciWnd' }] });
      }
      const payload = JSON.parse(options.body);
      if (payload.fieldId === 'site_comments') {
        return createResponse(200, { ok: true, found: true });
      }
      return createResponse(200, { ok: true, found: false, message: 'not visible' });
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(result.reachable, true);
  assert.equal(result.ready, true);
  assert.equal(result.sessionReady, true);
  assert.equal(result.foundCount, 1);
  assert.equal(result.fieldResults[1].found, true);
});

await test('probeDestinationFields returns session readiness failure before field probing', async () => {
  const result = await probeDestinationFields({
    formType: '1004',
    targetSoftware: 'aci',
    fieldIds: ['market_conditions'],
    agentBaseUrl: 'http://localhost:5180',
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        return createResponse(200, { ok: true });
      }
      if (url.endsWith('/list-windows')) {
        return createResponse(200, { windows: [] });
      }
      throw new Error('field probe should not run when session is not ready');
    },
  });

  assert.equal(result.reachable, true);
  assert.equal(result.ready, false);
  assert.equal(result.sessionReady, false);
  assert.equal(result.reason, 'ACI desktop window not detected');
  assert.equal(result.probedCount, 0);
});

await test('probeDestinationFields fails closed when session is ready but no fields are locatable', async () => {
  const result = await probeDestinationFields({
    formType: 'commercial',
    targetSoftware: 'real_quantum',
    fieldIds: ['market_area'],
    agentBaseUrl: 'http://localhost:5181',
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        return createResponse(200, { connected: true });
      }
      return createResponse(200, { ok: true, found: false, message: 'selector missing' });
    },
  });

  assert.equal(result.reachable, true);
  assert.equal(result.ready, false);
  assert.equal(result.sessionReady, true);
  assert.equal(result.foundCount, 0);
  assert.equal(result.reason, 'Live destination session is ready, but no probe field could be located');
});

console.log('\n' + '-'.repeat(60));
console.log(`agentProbe: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
