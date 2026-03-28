/**
 * scripts/test_server_runtime.mjs
 * --------------------------------
 * Phase 1 runtime integration test.
 * Starts the server, hits /api/health and /api/forms/1004, then exits.
 *
 * Usage: node scripts/test_server_runtime.mjs
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const PORT = 5178;
const BASE = `http://localhost:${PORT}`;

// ── Start server ──────────────────────────────────────────────────────────────
console.log('Starting server...');
const server = spawn('node', ['cacc-writer-server.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT) },
});

let serverReady = false;
server.stdout.on('data', (d) => {
  const line = d.toString().trim();
  if (line.includes('running at')) {
    serverReady = true;
    console.log('  Server stdout:', line);
  }
});
server.stderr.on('data', (d) => {
  const line = d.toString().trim();
  if (line && !line.includes('ExperimentalWarning')) {
    console.log('  Server stderr:', line);
  }
});

// ── Wait for server to be ready ───────────────────────────────────────────────
let waited = 0;
while (!serverReady && waited < 10000) {
  await sleep(300);
  waited += 300;
}

if (!serverReady) {
  console.error('FAIL: Server did not start within 10s');
  server.kill();
  process.exit(1);
}

await sleep(500); // brief extra settle time

let passed = 0;
let failed = 0;

// ── Test 3a: /api/health ──────────────────────────────────────────────────────
try {
  const res  = await fetch(`${BASE}/api/health`);
  const data = await res.json();
  if (res.ok && data.ok === true && data.model) {
    console.log(`\nTEST 3a PASS  /api/health → ok=${data.ok}, model=${data.model}`);
    passed++;
  } else {
    console.error(`\nTEST 3a FAIL  /api/health → unexpected response:`, JSON.stringify(data));
    failed++;
  }
} catch (e) {
  console.error(`\nTEST 3a FAIL  /api/health → ${e.message}`);
  failed++;
}

// ── Test 3b: /api/forms/1004 ──────────────────────────────────────────────────
try {
  const res  = await fetch(`${BASE}/api/forms/1004`);
  const data = await res.json();
  if (res.ok && data.ok && data.config?.id === '1004' && Array.isArray(data.config?.fields)) {
    console.log(`TEST 3b PASS  /api/forms/1004 → id=${data.config.id}, fields=${data.config.fields.length}, label="${data.config.label}"`);
    passed++;
  } else {
    console.error(`TEST 3b FAIL  /api/forms/1004 → unexpected response:`, JSON.stringify(data).slice(0, 200));
    failed++;
  }
} catch (e) {
  console.error(`TEST 3b FAIL  /api/forms/1004 → ${e.message}`);
  failed++;
}

// ── Test 3c: /api/forms (listForms) ──────────────────────────────────────────
try {
  const res  = await fetch(`${BASE}/api/forms`);
  const data = await res.json();
  const ids  = (data.forms || []).map(f => f.id);
  const expected = ['1004', '1025', '1073', '1004c', 'commercial'];
  const allPresent = expected.every(id => ids.includes(id));
  if (res.ok && data.ok && allPresent) {
    console.log(`TEST 3c PASS  /api/forms → forms=[${ids.join(', ')}]`);
    passed++;
  } else {
    console.error(`TEST 3c FAIL  /api/forms → missing forms. Got: [${ids.join(', ')}]`);
    failed++;
  }
} catch (e) {
  console.error(`TEST 3c FAIL  /api/forms → ${e.message}`);
  failed++;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
server.kill();
await sleep(200);

console.log(`\n${'─'.repeat(50)}`);
console.log(`RUNTIME TESTS COMPLETE  passed=${passed}  failed=${failed}`);
console.log('─'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
