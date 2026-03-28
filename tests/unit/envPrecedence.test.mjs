/**
 * tests/unit/envPrecedence.test.mjs
 * ---------------------------------
 * Regression tests for environment precedence and runtime overrides.
 */

import assert from 'assert/strict';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

function randomPort() {
  return 6000 + Math.floor(Math.random() * 2000);
}

function runInlineModule(code) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
    },
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 12000, intervalMs = 80) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = fn();
    if (out) return out;
    await sleep(intervalMs);
  }
  return null;
}

console.log('\nenvironment precedence');

await test('openaiClient import does not overwrite runtime PORT env', () => {
  const markerPort = String(randomPort());
  const code = `
    process.env.PORT = '${markerPort}';
    await import('./server/openaiClient.js');
    process.stdout.write(String(process.env.PORT));
  `;
  const result = runInlineModule(code);
  assert.equal(result.status, 0, result.stderr || 'inline module process failed');
  const stdout = (result.stdout || '').trim();
  assert.ok(stdout.endsWith(markerPort), `PORT should remain runtime-provided value (stdout=${stdout})`);
});

await test('server entrypoint honors PORT passed by runtime', async () => {
  const port = randomPort();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-env-port-'));
  const dbPath = path.join(tmpRoot, 'server.db');
  let outTail = '';
  let errTail = '';

  const child = spawn(process.execPath, ['cacc-writer-server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      CACC_DB_PATH: dbPath,
      CACC_DISABLE_FILE_LOGGER: '1',
      CACC_DISABLE_KB_WRITES: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const appendTail = (tail, chunk) => (tail + chunk.toString()).slice(-5000);
  child.stdout?.on('data', chunk => { outTail = appendTail(outTail, chunk); });
  child.stderr?.on('data', chunk => { errTail = appendTail(errTail, chunk); });

  try {
    const started = await waitFor(() => {
      const all = outTail + '\n' + errTail;
      return all.includes(`running on port ${port}`) || all.includes(`\"port\":${port}`) || false;
    }, 15000, 100);

    assert.ok(started, `server did not report startup on port ${port}\nstdout/stderr tail:\n${outTail}\n${errTail}`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await waitFor(() => child.exitCode !== null, 2000, 50);
      if (child.exitCode === null) child.kill('SIGKILL');
    }

    try {
      if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

console.log('\n' + '-'.repeat(60));
console.log(`envPrecedence: ${passed} passed, ${failed} failed`);
console.log('-'.repeat(60));

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`- ${f.label}: ${f.err.message}`);
  }
  process.exit(1);
}
