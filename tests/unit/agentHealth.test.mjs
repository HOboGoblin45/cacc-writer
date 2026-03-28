/**
 * tests/unit/agentHealth.test.mjs
 * Unit tests for server/api/agentHealth.js
 * Run: node tests/unit/agentHealth.test.mjs
 */

import assert from 'assert/strict';
import { detectAciWindow, probeAciAgent, probeRqAgent } from '../../server/api/agentHealth.js';

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

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

console.log('\nagentHealth');

await test('detectAciWindow identifies ACI windows from title or class', () => {
  assert.equal(detectAciWindow([{ title: 'ACI Report', class: 'Window' }]), true);
  assert.equal(detectAciWindow([{ title: 'Some App', class: 'ACIRpdCompView' }]), true);
  assert.equal(detectAciWindow([{ title: 'Codex', class: 'Chrome_WidgetWin_1' }]), false);
});

await test('probeAciAgent requires both HTTP reachability and an ACI desktop window', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('/health')) return response(200, { ok: true });
    if (url.endsWith('/list-windows')) {
      return response(200, { ok: true, windows: [{ title: 'ACI Appraisal', class: 'Window' }] });
    }
    throw new Error('Unexpected URL');
  };

  const probe = await probeAciAgent('http://localhost:5180', fetchImpl);
  assert.equal(probe.reachable, true);
  assert.equal(probe.ready, true);
  assert.equal(calls.length, 2);
});

await test('probeAciAgent reports degraded when the agent is up but no ACI window is open', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/health')) return response(200, { ok: true });
    if (url.endsWith('/list-windows')) return response(200, { ok: true, windows: [{ title: 'Codex', class: 'Chrome_WidgetWin_1' }] });
    throw new Error('Unexpected URL');
  };

  const probe = await probeAciAgent('http://localhost:5180', fetchImpl);
  assert.equal(probe.reachable, true);
  assert.equal(probe.ready, false);
  assert.match(probe.reason, /desktop window not detected/i);
});

await test('probeRqAgent requires connected=true from the agent health payload', async () => {
  const fetchImpl = async () => response(200, { ok: true, connected: false });
  const probe = await probeRqAgent('http://localhost:5181', fetchImpl);
  assert.equal(probe.reachable, true);
  assert.equal(probe.ready, false);
  assert.match(probe.reason, /not connected/i);
});

global.fetch = global.fetch;
console.log('\n' + '-'.repeat(60));
console.log(`agentHealth: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
