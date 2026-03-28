/**
 * tests/unit/insertionReplay.test.mjs
 * Verifies Priority 5 insertion reliability completion:
 *   - Dry-run report generation
 *   - Replay execution
 *   - Selective replay
 *   - Diff engine
 *   - Enhanced retry taxonomy
 *   - Run resume
 */

import assert from 'assert/strict';
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

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-insertion-replay-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'insertion-replay.db');

const originalFetch = global.fetch;

const { getDb, closeDb } = await import('../../server/db/database.js');
const { resolveAllMappings } = await import('../../server/insertion/destinationMapper.js');
const {
  prepareInsertionRun,
  executeInsertionRun,
  buildDryRunReport,
  resumeInsertionRun,
  getRetryClassConfig,
} = await import('../../server/insertion/insertionRunEngine.js');
const { executeReplay, executeSelectiveReplay } = await import('../../server/insertion/replayEngine.js');
const { buildInsertionDiff } = await import('../../server/insertion/diffEngine.js');
const {
  getInsertionRunItems,
  getInsertionRun,
  updateInsertionRun,
  updateInsertionRunItem,
} = await import('../../server/insertion/insertionRepo.js');

function insertGeneratedSection({ caseId, formType, fieldId, text }) {
  const db = getDb();
  const runId = randomId('run');
  const jobId = randomId('job');
  db.prepare(`
    INSERT INTO generation_runs (
      id, case_id, form_type, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(runId, caseId, formType, new Date().toISOString());
  db.prepare(`
    INSERT INTO section_jobs (
      id, run_id, section_id, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(jobId, runId, fieldId, new Date().toISOString());
  db.prepare(`
    INSERT INTO generated_sections (
      id, job_id, run_id, case_id, section_id, form_type, final_text, approved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    randomId('gs'), jobId, runId, caseId, fieldId, formType,
    text, new Date().toISOString(),
  );
}

function firstSupportedMapping(formType = '1004', software = 'aci') {
  const mapping = resolveAllMappings(formType, software).find((entry) => entry.supported);
  assert.ok(mapping, `expected a supported ${software} mapping for ${formType}`);
  return mapping;
}

function twoSupportedMappings(formType = '1004', software = 'aci') {
  const mappings = resolveAllMappings(formType, software).filter((entry) => entry.supported);
  assert.ok(mappings.length >= 2, `expected at least 2 supported ${software} mappings for ${formType}`);
  return [mappings[0], mappings[1]];
}

async function cleanup() {
  global.fetch = originalFetch;
  try { closeDb(); } catch { /* best effort */ }
  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch { /* best effort */ }
}

console.log('\ninsertionReplay');

// ── Enhanced Retry Taxonomy ───────────────────────────────────────────────────

await test('classifyRetryClass handles auth, stale_session, and rate_limit classes', async () => {
  // getRetryClassConfig is the exported accessor for retry class configs
  const authConfig = getRetryClassConfig('auth');
  assert.equal(authConfig.maxRetries, 0, 'auth errors should not be retried');
  assert.equal(authConfig.baseDelayMs, 0);

  const staleConfig = getRetryClassConfig('stale_session');
  assert.equal(staleConfig.maxRetries, 1);
  assert.ok(staleConfig.baseDelayMs >= 2000, 'stale_session should have a longer delay');

  const rateConfig = getRetryClassConfig('rate_limit');
  assert.equal(rateConfig.maxRetries, 3);
  assert.ok(rateConfig.baseDelayMs >= 5000, 'rate_limit should have the longest delay');

  const transportConfig = getRetryClassConfig('transport');
  assert.equal(transportConfig.maxRetries, 3);
  assert.equal(transportConfig.baseDelayMs, 1200);

  const unknownConfig = getRetryClassConfig('nonexistent_class');
  assert.ok(unknownConfig, 'unknown class should return default config');
  assert.ok(unknownConfig.maxRetries >= 1, 'unknown class should allow retries');
});

// ── Dry-Run Report ────────────────────────────────────────────────────────────

await test('buildDryRunReport returns structured preview with field details and potential issues', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Test narrative for dry run report generation.',
  });

  global.fetch = async (url) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  const prepared = prepareInsertionRun({
    caseId,
    formType: '1004',
    config: { dryRun: true },
  });

  const report = buildDryRunReport(prepared.run.id);

  assert.equal(report.isDryRun, true);
  assert.equal(report.caseId, caseId);
  assert.equal(report.formType, '1004');
  assert.ok(report.totalFields >= 1);
  assert.ok(Array.isArray(report.fieldPreviews));
  assert.ok(Array.isArray(report.potentialIssues));

  // Check field preview structure
  const fieldPreview = report.fieldPreviews.find(f => f.fieldId === mapping.fieldId);
  assert.ok(fieldPreview, 'expected field preview for inserted field');
  assert.ok(fieldPreview.canonicalTextPreview.length > 0);
  assert.ok(fieldPreview.formattedTextPreview.length > 0);
  assert.ok(fieldPreview.formattingMode);
  assert.ok(fieldPreview.humanLabel);
  assert.ok(typeof fieldPreview.supported === 'boolean');

  // Check issue counting
  assert.ok(typeof report.issuesBySevertiy.error === 'number');
  assert.ok(typeof report.issuesBySevertiy.warning === 'number');
  assert.ok(typeof report.issuesBySevertiy.info === 'number');
});

// ── Replay Execution ─────────────────────────────────────────────────────────

await test('executeReplay creates a new run linked to the original and replays failed items', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Narrative text for replay test.',
  });

  // First run: force a failure using a non-retryable error with 'skip' fallback
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      return jsonResponse({ success: false, errorCode: 'insertion_rejected', message: 'Simulated failure' });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'Pre-existing value' });
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  const prepared = prepareInsertionRun({
    caseId, formType: '1004',
    config: { defaultFallback: 'retry', maxRetries: 1 },
  });
  const firstRun = await executeInsertionRun(prepared.run.id);
  // Run should complete (possibly with fallback) or fail — either way items will have non-verified status
  assert.ok(['failed', 'partial', 'completed'].includes(firstRun.status), `unexpected status: ${firstRun.status}`);

  // Now set up a successful agent for replay
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'Narrative text for replay test.' });
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  // Verify the first run has failed items to replay
  const firstRunItems = getInsertionRunItems(prepared.run.id);
  const firstRunFailed = firstRunItems.filter(i => i.status === 'failed' || i.fallbackUsed);
  assert.ok(firstRunFailed.length >= 1, 'first run should have failed items');

  const replayRun = await executeReplay(prepared.run.id);

  assert.ok(replayRun, 'replay run should be returned');
  assert.equal(replayRun.runType, 'replay');
  assert.equal(replayRun.originalRunId, prepared.run.id);
  assert.ok(['completed', 'partial'].includes(replayRun.status), `unexpected replay status: ${replayRun.status}`);

  const replayItems = getInsertionRunItems(replayRun.id);
  assert.ok(replayItems.length >= 1, 'replay should have items');
});

// ── Selective Replay ──────────────────────────────────────────────────────────

await test('executeSelectiveReplay replays only specified fields', async () => {
  const caseId = randomId('case');
  const [mapping1, mapping2] = twoSupportedMappings();

  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping1.fieldId,
    text: 'First field narrative for selective replay.',
  });
  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping2.fieldId,
    text: 'Second field narrative for selective replay.',
  });

  // First run: fail all
  global.fetch = async (url) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) return jsonResponse({ success: false, errorCode: 'insertion_rejected' });
    if (String(url).endsWith('/read-field')) return jsonResponse({ success: true, value: '' });
    throw new Error(`Unhandled: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  await executeInsertionRun(prepared.run.id);

  // Now replay only the first field
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'First field narrative for selective replay.' });
    }
    throw new Error(`Unhandled: ${url}`);
  };

  const replayRun = await executeSelectiveReplay(prepared.run.id, [mapping1.fieldId]);

  assert.ok(replayRun);
  assert.equal(replayRun.runType, 'replay');
  assert.equal(replayRun.originalRunId, prepared.run.id);

  const replayItems = getInsertionRunItems(replayRun.id);
  assert.equal(replayItems.length, 1, 'selective replay should only have 1 item');
  assert.equal(replayItems[0].fieldId, mapping1.fieldId);
});

await test('executeSelectiveReplay throws on empty fieldIds', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Text for empty fieldIds test.',
  });

  global.fetch = async (url) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) return jsonResponse({ success: false });
    if (String(url).endsWith('/read-field')) return jsonResponse({ success: true, value: '' });
    throw new Error(`Unhandled: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  await executeInsertionRun(prepared.run.id);

  await assert.rejects(
    () => executeSelectiveReplay(prepared.run.id, []),
    /non-empty array/i,
  );
});

// ── Diff Engine ───────────────────────────────────────────────────────────────

await test('buildInsertionDiff produces structured diffs for run items', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  const originalText = 'The subject property is in average condition with no significant deficiencies noted.';
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: mapping.fieldId,
    text: originalText,
  });

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      // Return slightly different text to create a mismatch scenario
      return jsonResponse({ success: true, value: originalText });
    }
    throw new Error(`Unhandled: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  await executeInsertionRun(prepared.run.id);

  const diff = buildInsertionDiff(prepared.run.id);

  assert.ok(diff, 'diff should be returned');
  assert.equal(diff.runId, prepared.run.id);
  assert.equal(diff.caseId, caseId);
  assert.ok(Array.isArray(diff.itemDiffs));
  assert.ok(diff.itemDiffs.length >= 1);
  assert.ok(typeof diff.totalMismatches === 'number');
  assert.ok(typeof diff.totalTruncations === 'number');
  assert.ok(typeof diff.totalFormattingDiffs === 'number');

  const itemDiff = diff.itemDiffs.find(d => d.fieldId === mapping.fieldId);
  assert.ok(itemDiff, 'expected diff for the inserted field');
  assert.ok(typeof itemDiff.formattingSimilarity === 'number');
  assert.ok(typeof itemDiff.hasTruncation === 'boolean');
  assert.ok(typeof itemDiff.hasFormattingDiff === 'boolean');
  assert.ok(typeof itemDiff.hasMismatch === 'boolean');
  assert.ok(Array.isArray(itemDiff.changes));
  assert.ok(itemDiff.canonicalPreview.length > 0);

  // Also verify the item was updated with diff_json and similarity_score
  const items = getInsertionRunItems(prepared.run.id);
  const updatedItem = items.find(i => i.fieldId === mapping.fieldId);
  assert.ok(updatedItem.diffJson !== null, 'diff_json should be persisted on the item');
  assert.ok(typeof updatedItem.similarityScore === 'number', 'similarity_score should be persisted');
});

// ── Run Resume ────────────────────────────────────────────────────────────────

await test('resumeInsertionRun resumes a partial run and skips verified items', async () => {
  const caseId = randomId('case');
  const [mapping1, mapping2] = twoSupportedMappings();

  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping1.fieldId,
    text: 'First field for resume test.',
  });
  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping2.fieldId,
    text: 'Second field for resume test.',
  });

  // Run all items successfully first
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'First field for resume test.' });
    }
    throw new Error(`Unhandled: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  await executeInsertionRun(prepared.run.id);

  // Manually set run to 'partial' and second item to 'failed' to simulate
  // a run that was interrupted midway
  const itemsAfterFirst = getInsertionRunItems(prepared.run.id);
  assert.ok(itemsAfterFirst.length >= 2, 'should have at least 2 items');
  const secondItem = itemsAfterFirst[1];
  updateInsertionRunItem(secondItem.id, {
    status: 'failed',
    errorCode: 'agent_timeout',
    errorText: 'Simulated timeout for resume test',
    verificationStatus: 'pending',
  });
  updateInsertionRun(prepared.run.id, { status: 'partial' });

  // Set up successful agent and resume
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'Second field for resume test.' });
    }
    throw new Error(`Unhandled: ${url}`);
  };

  const resumed = await resumeInsertionRun(prepared.run.id);

  assert.equal(resumed.status, 'completed');
  assert.ok(resumed.summary.resumed, 'summary should indicate this was a resume');
  assert.equal(resumed.summary.resumedItemCount, 1, 'should have resumed exactly 1 item');

  // Verify all items are now done
  const finalItems = getInsertionRunItems(prepared.run.id);
  const stillFailed = finalItems.filter(i => i.status === 'failed');
  assert.equal(stillFailed.length, 0, 'no items should remain failed after resume');
});

await test('resumeInsertionRun throws for completed runs', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId, formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Text for resume error test.',
  });

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      return jsonResponse({ success: true, value: 'Text for resume error test.' });
    }
    throw new Error(`Unhandled: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  await executeInsertionRun(prepared.run.id);

  await assert.rejects(
    () => resumeInsertionRun(prepared.run.id),
    /Cannot resume run in status/,
  );
});

// ── Replay throws for nonexistent runs ─────────────────────────────────────

await test('executeReplay throws for nonexistent run ID', async () => {
  await assert.rejects(
    () => executeReplay('nonexistent_run_id'),
    /not found/i,
  );
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) {
    console.log('\n - ' + failure.label);
    console.log('   ' + failure.err.stack);
  }
  await cleanup();
  process.exit(1);
}

await cleanup();
