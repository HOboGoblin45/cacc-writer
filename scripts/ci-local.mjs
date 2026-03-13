#!/usr/bin/env node
/**
 * scripts/ci-local.mjs
 * ---------------------
 * Phase A (OS-A4): Deterministic CI-local pipeline.
 *
 * Runs: typecheck -> unit tests -> smoke tests
 * Exits with non-zero status on first failure.
 *
 * Usage: node scripts/ci-local.mjs
 *    or: npm run test:ci
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const steps = [
  { name: 'typecheck', cmd: 'npx', args: ['tsc', '--project', 'tsconfig.json', '--noEmit'] },
  { name: 'unit tests', cmd: 'node', args: ['tests/unit/run.mjs'] },
  { name: 'smoke tests', cmd: 'node', args: ['_test_smoke.mjs'] },
];

console.log('='.repeat(60));
console.log('CACC Writer — CI-Local Pipeline');
console.log('='.repeat(60));

let allPassed = true;

for (const step of steps) {
  console.log(`\n▶ ${step.name}`);
  console.log('─'.repeat(60));

  const result = spawnSync(step.cmd, step.args, {
    cwd: projectRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    env: {
      ...process.env,
      CACC_DISABLE_FILE_LOGGER: process.env.CACC_DISABLE_FILE_LOGGER || '1',
      CACC_DISABLE_KB_WRITES: process.env.CACC_DISABLE_KB_WRITES || '1',
    },
  });

  if (result.status !== 0) {
    console.log(`\n✗ ${step.name} failed (exit code ${result.status})`);

    // Typecheck failures are warnings if tsconfig doesn't exist
    if (step.name === 'typecheck' && result.status !== 0) {
      console.log('  (typecheck failure is non-blocking if tsconfig.json is missing)');
      try {
        const fs = await import('fs');
        if (!fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
          console.log('  Skipping: no tsconfig.json found');
          continue;
        }
      } catch {
        // fall through
      }
    }

    allPassed = false;
    console.log('\n✗ Pipeline stopped at: ' + step.name);
    process.exit(1);
  }

  console.log(`✓ ${step.name} passed`);
}

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✓ All CI-local steps passed');
} else {
  console.log('✗ Some steps failed');
  process.exit(1);
}
console.log('='.repeat(60));
