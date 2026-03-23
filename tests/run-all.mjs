#!/usr/bin/env node
/**
 * tests/run-all.mjs — Test Runner
 * Runs all test files and outputs a summary.
 * Exit code 1 if any failures.
 */

import { execSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const TEST_FILES = [
  'tests/syntax.test.mjs',
  'tests/quality.test.mjs',
  'tests/api.test.mjs',
];

console.log('═══════════════════════════════════════════════════════');
console.log('  CACC Writer — Automated Test Suite');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Running: ${TEST_FILES.length} test file(s)`);
console.log(`  Base URL: https://appraisal-agent.com`);
console.log(`  Timestamp: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════\n');

// Use node --test with glob pattern
const args = ['--test', ...TEST_FILES];

const child = spawn(process.execPath, args, {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

child.on('close', (code) => {
  console.log('\n═══════════════════════════════════════════════════════');
  if (code === 0) {
    console.log('  ✅ All tests passed');
  } else {
    console.log(`  ❌ Tests completed with failures (exit code: ${code})`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error(`Failed to run tests: ${err.message}`);
  process.exit(1);
});
