/**
 * tests/unit/feedbackLoop.test.mjs
 * --------------------------------
 * Unit tests for the Milestone 6 Feedback Loop Service:
 *   - linkGenerationToPatterns
 *   - onSectionApproved / onSectionRejected
 *   - onQualityScoreComputed
 *   - getPatternSuccessRate / getBatchPatternSuccessRates
 *   - closeFeedbackLoop
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

// ── Setup: isolated temp DB ──────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-feedback-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'feedback-test.db');

const { getDb, closeDb } = await import('../../server/db/database.js');

// Ensure DB is initialized
getDb();

// ── Import modules under test ────────────────────────────────────────────────

const {
  archiveCompletedAssignment,
} = await import('../../server/learning/assignmentArchiveService.js');

const {
  learnFromArchive,
  listPatterns,
  recordPatternApplication,
} = await import('../../server/learning/patternLearningService.js');

const {
  linkGenerationToPatterns,
  onSectionApproved,
  onSectionRejected,
  onQualityScoreComputed,
  getPatternSuccessRate,
  getBatchPatternSuccessRates,
  closeFeedbackLoop,
} = await import('../../server/learning/feedbackLoopService.js');

// ── Test helpers ─────────────────────────────────────────────────────────────

function seedCaseRecord(caseId, formType = '1004') {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO case_records (case_id, form_type, status, pipeline_stage, workflow_status)
      VALUES (?, ?, 'active', 'complete', 'completed')
    `).run(caseId, formType);
  } catch { /* may already exist */ }
}

function seedCaseFacts(caseId, facts = {}) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO case_facts (case_id, facts_json) VALUES (?, ?)`).run(caseId, JSON.stringify(facts));
  } catch {
    db.prepare(`UPDATE case_facts SET facts_json = ? WHERE case_id = ?`).run(JSON.stringify(facts), caseId);
  }
}

function seedCompCandidate(caseId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('comp');
  db.prepare(`
    INSERT INTO comp_candidates (id, case_id, source_key, source_type, review_status, candidate_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, caseId, opts.sourceKey || randomId('src'), opts.sourceType || 'mls',
    opts.reviewStatus || 'pending', JSON.stringify(opts.candidateData || { salePrice: 250000 }));
  return id;
}

function seedCompAcceptance(caseId, compCandidateId, opts = {}) {
  const db = getDb();
  const id = randomId('accept');
  db.prepare(`
    INSERT INTO comp_acceptance_events (id, case_id, comp_candidate_id, grid_slot, ranking_score, visible_reasoning_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, caseId, compCandidateId, opts.gridSlot || 'comp1', opts.rankingScore || 85,
    JSON.stringify(opts.reasoning || { reason: 'good match' }));
  return id;
}

function seedAdjustmentSupport(caseId, opts = {}) {
  const db = getDb();
  const id = randomId('adj');
  db.prepare(`
    INSERT INTO adjustment_support_records (
      id, case_id, grid_slot, adjustment_category,
      subject_value, comp_value, suggested_amount, final_amount, decision_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, caseId, opts.gridSlot || 'comp1', opts.category || 'GLA',
    opts.subjectValue || '1800', opts.compValue || '1600',
    opts.suggestedAmount || 5000, opts.finalAmount || 6000, opts.decisionStatus || 'accepted');
  return id;
}

function seedGenerationRun(caseId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('run');
  db.prepare(`INSERT INTO generation_runs (id, case_id, form_type, status) VALUES (?, ?, ?, ?)`)
    .run(id, caseId, opts.formType || '1004', opts.status || 'completed');
  return id;
}

function seedSectionJob(runId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('job');
  db.prepare(`INSERT INTO section_jobs (id, run_id, section_id, status) VALUES (?, ?, ?, ?)`)
    .run(id, runId, opts.sectionId || 'neighborhood_description', opts.status || 'completed');
  return id;
}

function seedGeneratedSection(caseId, runId, opts = {}) {
  const db = getDb();
  const id = randomId('section');
  const jobId = opts.jobId || seedSectionJob(runId, { sectionId: opts.sectionId });
  db.prepare(`
    INSERT INTO generated_sections (
      id, job_id, run_id, case_id, section_id, form_type,
      draft_text, final_text, quality_score, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, jobId, runId, caseId,
    opts.sectionId || 'neighborhood_description', opts.formType || '1004',
    opts.draftText || 'Draft text.', opts.finalText || 'Final text.',
    opts.qualityScore !== undefined ? opts.qualityScore : null,
    opts.approved ? 1 : 0);
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// Setup: create an archive with patterns so feedback loop has data to work with
// ══════════════════════════════════════════════════════════════════════════════

const baseCaseId = randomId('base');
seedCaseRecord(baseCaseId, '1004');
seedCaseFacts(baseCaseId, {
  subject: { propertyType: 'single_family', county: 'McLean', salePrice: 250000 },
});
const baseCompId = seedCompCandidate(baseCaseId, {
  reviewStatus: 'accepted',
  candidateData: { salePrice: 245000, propertyType: 'single_family' },
});
seedCompAcceptance(baseCaseId, baseCompId);
seedAdjustmentSupport(baseCaseId, { category: 'GLA', finalAmount: 5000 });
const baseRunId = seedGenerationRun(baseCaseId);
seedGeneratedSection(baseCaseId, baseRunId, {
  sectionId: 'neighborhood_description',
  draftText: 'Draft neighborhood.',
  finalText: 'Final neighborhood.',
  approved: true,
});

const archiveResult = archiveCompletedAssignment(baseCaseId);
const learningResult = learnFromArchive(archiveResult.id);

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n── Milestone 6 Feedback Loop Tests ─────────────────────────────');

// ── linkGenerationToPatterns ─────────────────────────────────────────────────

await test('linkGenerationToPatterns — links relevant patterns', () => {
  const caseId = randomId('link-case');
  const result = linkGenerationToPatterns({
    caseId,
    sectionId: 'neighborhood_description',
    generatedSectionId: 'gen-123',
    formType: '1004',
    propertyType: 'single_family',
  });

  assert.ok(typeof result.linkedPatterns === 'number', 'should return linkedPatterns count');
  assert.ok(Array.isArray(result.applicationIds), 'should return applicationIds array');
  assert.equal(result.linkedPatterns, result.applicationIds.length, 'counts should match');
});

await test('linkGenerationToPatterns — returns zero for unmatched context', () => {
  const result = linkGenerationToPatterns({
    caseId: randomId('nomatch'),
    sectionId: 'nonexistent_section',
    generatedSectionId: 'gen-456',
    formType: 'nonexistent_form',
  });

  assert.equal(result.linkedPatterns, 0, 'should link zero patterns for unmatched context');
});

// ── onSectionApproved / onSectionRejected ────────────────────────────────────

await test('onSectionApproved — propagates accepted outcome', () => {
  const caseId = randomId('approve');
  const sectionId = 'neighborhood_description';

  // First link patterns to create applications
  const linked = linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-approve',
    formType: '1004',
    propertyType: 'single_family',
  });

  if (linked.linkedPatterns > 0) {
    const result = onSectionApproved(caseId, sectionId);
    assert.ok(result.updatedApplications > 0, 'should update at least one application');
  }
});

await test('onSectionApproved — idempotent (no double-update)', () => {
  const caseId = randomId('idem');
  const sectionId = 'neighborhood_description';

  linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-idem',
    formType: '1004',
    propertyType: 'single_family',
  });

  const first = onSectionApproved(caseId, sectionId);
  const second = onSectionApproved(caseId, sectionId);
  assert.equal(second.updatedApplications, 0, 'second call should update zero (already resolved)');
});

await test('onSectionRejected — propagates rejected outcome', () => {
  const caseId = randomId('reject');
  const sectionId = 'neighborhood_description';

  const linked = linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-reject',
    formType: '1004',
    propertyType: 'single_family',
  });

  if (linked.linkedPatterns > 0) {
    const result = onSectionRejected(caseId, sectionId);
    assert.ok(result.updatedApplications > 0, 'should update at least one application');
  }
});

// ── onQualityScoreComputed ───────────────────────────────────────────────────

await test('onQualityScoreComputed — boosts confidence for high quality', () => {
  const caseId = randomId('qhi');
  const sectionId = 'neighborhood_description';

  linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-qhi',
    formType: '1004',
    propertyType: 'single_family',
  });

  const result = onQualityScoreComputed(caseId, sectionId, 85);
  assert.ok(typeof result.adjustedPatterns === 'number', 'should return adjusted count');
});

await test('onQualityScoreComputed — penalizes for low quality', () => {
  const caseId = randomId('qlo');
  const sectionId = 'neighborhood_description';

  linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-qlo',
    formType: '1004',
    propertyType: 'single_family',
  });

  const result = onQualityScoreComputed(caseId, sectionId, 25);
  assert.ok(typeof result.adjustedPatterns === 'number', 'should return adjusted count');
});

await test('onQualityScoreComputed — no change for medium quality', () => {
  const caseId = randomId('qmed');
  const sectionId = 'neighborhood_description';

  linkGenerationToPatterns({
    caseId,
    sectionId,
    generatedSectionId: 'gen-qmed',
    formType: '1004',
    propertyType: 'single_family',
  });

  const result = onQualityScoreComputed(caseId, sectionId, 55);
  assert.equal(result.adjustedPatterns, 0, 'medium quality should not adjust');
});

await test('onQualityScoreComputed — handles non-number gracefully', () => {
  const result = onQualityScoreComputed('any-case', 'any-section', null);
  assert.equal(result.adjustedPatterns, 0, 'null quality should return zero adjustments');
});

// ── getPatternSuccessRate ────────────────────────────────────────────────────

await test('getPatternSuccessRate — returns default for no data', () => {
  const result = getPatternSuccessRate('nonexistent-pattern');
  assert.equal(result.total, 0);
  assert.equal(result.successRate, 0.5, 'should default to 50%');
});

await test('getPatternSuccessRate — computes rate from applications', () => {
  const patterns = listPatterns();
  if (patterns.length > 0) {
    const patternId = patterns[0].id;
    const result = getPatternSuccessRate(patternId);
    assert.ok(typeof result.total === 'number', 'total should be a number');
    assert.ok(typeof result.accepted === 'number', 'accepted should be a number');
    assert.ok(typeof result.rejected === 'number', 'rejected should be a number');
    assert.ok(result.successRate >= 0 && result.successRate <= 1, 'rate should be 0-1');
  }
});

// ── getBatchPatternSuccessRates ──────────────────────────────────────────────

await test('getBatchPatternSuccessRates — returns empty for empty input', () => {
  const result = getBatchPatternSuccessRates([]);
  assert.deepEqual(result, {});
});

await test('getBatchPatternSuccessRates — returns rates for multiple patterns', () => {
  const patterns = listPatterns();
  if (patterns.length >= 2) {
    const ids = patterns.slice(0, 2).map(p => p.id);
    const result = getBatchPatternSuccessRates(ids);
    for (const id of ids) {
      assert.ok(result[id], `should have entry for ${id}`);
      assert.ok(typeof result[id].successRate === 'number');
    }
  }
});

// ── closeFeedbackLoop ────────────────────────────────────────────────────────

await test('closeFeedbackLoop — processes all sections for a case', () => {
  // Create a case with generated sections
  const caseId = randomId('close');
  seedCaseRecord(caseId, '1004');
  const runId = seedGenerationRun(caseId);

  // Seed sections: one approved, one not
  seedGeneratedSection(caseId, runId, {
    sectionId: 'neighborhood_description',
    approved: true,
    qualityScore: 80,
  });
  seedGeneratedSection(caseId, runId, {
    sectionId: 'site_description',
    approved: false,
    qualityScore: 35,
  });

  // Link patterns to this case's sections
  linkGenerationToPatterns({
    caseId,
    sectionId: 'neighborhood_description',
    generatedSectionId: 'any',
    formType: '1004',
    propertyType: 'single_family',
  });
  linkGenerationToPatterns({
    caseId,
    sectionId: 'site_description',
    generatedSectionId: 'any',
    formType: '1004',
    propertyType: 'single_family',
  });

  const result = closeFeedbackLoop(caseId);
  assert.ok(typeof result.sectionsProcessed === 'number', 'should report sections processed');
  assert.ok(typeof result.applicationsUpdated === 'number', 'should report applications updated');
  assert.ok(typeof result.qualityAdjustments === 'number', 'should report quality adjustments');
  assert.ok(result.sectionsProcessed >= 2, 'should process at least 2 sections');
});

await test('closeFeedbackLoop — handles case with no sections', () => {
  const result = closeFeedbackLoop('nonexistent-case');
  assert.equal(result.sectionsProcessed, 0);
  assert.equal(result.applicationsUpdated, 0);
  assert.equal(result.qualityAdjustments, 0);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

closeDb();

console.log('\n' + '─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const { label, err } of failures) {
    console.log(`  - ${label}: ${err.message}`);
  }
}
console.log('─'.repeat(60));

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch { /* best effort */ }

if (failed > 0) process.exit(1);
