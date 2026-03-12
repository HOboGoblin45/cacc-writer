/**
 * tests/unit/contradictionResolution.test.mjs
 * ---------------------------------------------
 * Unit tests for the contradiction resolution workflow service (Phase E).
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Set up temp case directory before importing modules
const tmpDir = path.join(os.tmpdir(), `cacc-cres-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
const caseDir = path.join(tmpDir, 'case-resolution-test');
fs.mkdirSync(caseDir, { recursive: true });
process.env.CACC_DATA_DIR = tmpDir;

// Write initial case projection
const initialProjection = {
  facts: { subject: { city: { value: 'Chicago' } } },
  provenance: {},
  meta: { formType: '1004' },
};
fs.writeFileSync(path.join(caseDir, 'canonical_record.json'), JSON.stringify(initialProjection));
fs.writeFileSync(path.join(caseDir, 'facts.json'), JSON.stringify(initialProjection.facts));
fs.writeFileSync(path.join(caseDir, 'meta.json'), JSON.stringify(initialProjection.meta));

import {
  resolveContradiction,
  dismissContradiction,
  acknowledgeContradiction,
  reopenContradiction,
  getContradictionResolution,
  getAllResolutions,
  mergeResolutionStatus,
  buildResolutionSummary,
  RESOLUTION_STATUS,
} from '../../server/contradictionGraph/contradictionResolutionService.js';

const suiteName = 'contradictionResolution';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error('     ', err.message);
    failed++;
  }
}

console.log(suiteName);
console.log('─'.repeat(60));

// ── RESOLUTION_STATUS constants ─────────────────────────────────────────────

test('RESOLUTION_STATUS has expected values', () => {
  assert.equal(RESOLUTION_STATUS.OPEN, 'open');
  assert.equal(RESOLUTION_STATUS.RESOLVED, 'resolved');
  assert.equal(RESOLUTION_STATUS.DISMISSED, 'dismissed');
  assert.equal(RESOLUTION_STATUS.ACKNOWLEDGED, 'acknowledged');
});

// ── mergeResolutionStatus ───────────────────────────────────────────────────

test('mergeResolutionStatus adds open status to unresolved items', () => {
  const items = [
    { id: 'c-1', category: 'dates', severity: 'medium', message: 'Date mismatch' },
    { id: 'c-2', category: 'gla', severity: 'high', message: 'GLA mismatch' },
  ];
  const merged = mergeResolutionStatus('nonexistent-case', items);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].resolution.status, 'open');
  assert.equal(merged[1].resolution.status, 'open');
});

// ── buildResolutionSummary ──────────────────────────────────────────────────

test('buildResolutionSummary computes correct counts for all open', () => {
  const items = [
    { id: 'c-1', category: 'dates' },
    { id: 'c-2', category: 'gla' },
  ];
  const summary = buildResolutionSummary('nonexistent-case', items);
  assert.equal(summary.total, 2);
  assert.equal(summary.open, 2);
  assert.equal(summary.resolved, 0);
  assert.equal(summary.allAddressed, false);
  assert.equal(summary.completionPercent, 0);
});

test('buildResolutionSummary handles empty items', () => {
  const summary = buildResolutionSummary('nonexistent-case', []);
  assert.equal(summary.total, 0);
  assert.equal(summary.allAddressed, true);
  assert.equal(summary.completionPercent, 100);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${passed} passed, ${failed} failed`);

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

if (failed > 0) process.exit(1);
