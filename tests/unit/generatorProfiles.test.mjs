/**
 * tests/unit/generatorProfiles.test.mjs
 * ----------------------------------------
 * Unit tests for generator profiles and section resolution.
 */

import assert from 'node:assert/strict';

import {
  GENERATOR_PROFILES,
  getProfile,
  resolveProfileForSection,
  buildGenerationOptions,
  listProfileIds,
} from '../../server/generators/generatorProfiles.js';

const suiteName = 'generatorProfiles';
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

// ── Profile existence ───────────────────────────────────────────────────────

test('all expected profiles exist', () => {
  const ids = listProfileIds();
  assert.ok(ids.includes('template-heavy'));
  assert.ok(ids.includes('retrieval-guided'));
  assert.ok(ids.includes('data-driven'));
  assert.ok(ids.includes('logic-template'));
  assert.ok(ids.includes('analysis-narrative'));
  assert.ok(ids.includes('synthesis'));
  assert.ok(ids.includes('valuation-approach'));
  assert.ok(ids.includes('prior-transaction'));
  assert.ok(ids.includes('exposure-time'));
});

test('valuation-approach profile covers cost and income sections', () => {
  const profile = GENERATOR_PROFILES['valuation-approach'];
  assert.ok(profile.sections.includes('cost_approach_summary'));
  assert.ok(profile.sections.includes('income_approach_summary'));
  assert.equal(profile.temperature, 0.30);
});

test('prior-transaction profile covers prior_sales and offering_history', () => {
  const profile = GENERATOR_PROFILES['prior-transaction'];
  assert.ok(profile.sections.includes('prior_sales'));
  assert.ok(profile.sections.includes('offering_history'));
  assert.equal(profile.temperature, 0.20);
});

test('exposure-time profile covers exposure_time section', () => {
  const profile = GENERATOR_PROFILES['exposure-time'];
  assert.ok(profile.sections.includes('exposure_time'));
});

// ── resolveProfileForSection ────────────────────────────────────────────────

test('resolves correct profile for cost_approach_summary', () => {
  const profile = resolveProfileForSection('cost_approach_summary');
  assert.equal(profile.id, 'valuation-approach');
});

test('resolves correct profile for income_approach_summary', () => {
  const profile = resolveProfileForSection('income_approach_summary');
  assert.equal(profile.id, 'valuation-approach');
});

test('resolves correct profile for prior_sales', () => {
  const profile = resolveProfileForSection('prior_sales');
  assert.equal(profile.id, 'prior-transaction');
});

test('resolves correct profile for offering_history', () => {
  const profile = resolveProfileForSection('offering_history');
  assert.equal(profile.id, 'prior-transaction');
});

test('resolves correct profile for exposure_time', () => {
  const profile = resolveProfileForSection('exposure_time');
  assert.equal(profile.id, 'exposure-time');
});

test('falls back to retrieval-guided for unknown sections', () => {
  const profile = resolveProfileForSection('nonexistent_section');
  assert.equal(profile.id, 'retrieval-guided');
});

// ── buildGenerationOptions ──────────────────────────────────────────────────

test('buildGenerationOptions merges profile defaults', () => {
  const opts = buildGenerationOptions('valuation-approach');
  assert.equal(opts.temperature, 0.30);
  assert.equal(opts.profileId, 'valuation-approach');
  assert.ok(opts.systemHint.includes('valuation approach'));
});

test('buildGenerationOptions allows overrides', () => {
  const opts = buildGenerationOptions('valuation-approach', { temperature: 0.5 });
  assert.equal(opts.temperature, 0.5);
  assert.equal(opts.profileId, 'valuation-approach');
});

// ── getProfile ──────────────────────────────────────────────────────────────

test('getProfile returns correct profile', () => {
  const profile = getProfile('prior-transaction');
  assert.equal(profile.id, 'prior-transaction');
  assert.equal(profile.label, 'Prior-Transaction');
});

test('getProfile falls back for unknown', () => {
  const profile = getProfile('nonexistent');
  assert.equal(profile.id, 'retrieval-guided');
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
