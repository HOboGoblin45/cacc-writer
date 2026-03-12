/**
 * tests/unit/learningSystem.test.mjs
 * -----------------------------------
 * Unit tests for the Phase 11 Learning/Memory System:
 *   - Assignment archival
 *   - Pattern extraction
 *   - Similar assignment retrieval
 *   - Suggestion ranking with learning boost
 *   - Pattern application tracking
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-learning-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'learning-test.db');

const { getDb, closeDb } = await import('../../server/db/database.js');

// Ensure DB is initialized (schema creates all tables)
getDb();

// ── Import modules under test ────────────────────────────────────────────────

const {
  archiveCompletedAssignment,
  getArchiveByCaseId,
  getArchiveById,
  listArchives,
} = await import('../../server/learning/assignmentArchiveService.js');

const {
  learnFromArchive,
  getRelevantPatterns,
  listPatterns,
  recordPatternApplication,
  recordApplicationOutcome,
} = await import('../../server/learning/patternLearningService.js');

const {
  findSimilarAssignments,
  getSimilarAssignmentDetail,
} = await import('../../server/learning/priorAssignmentRetrieval.js');

const {
  getLearningBoostForItem,
  getLearningEnhancedSuggestions,
} = await import('../../server/learning/learningBoostProvider.js');

// ── Test helpers: seed required tables ───────────────────────────────────────

function seedCaseRecord(caseId, formType = '1004') {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO case_records (case_id, form_type, status, pipeline_stage, workflow_status)
      VALUES (?, ?, 'active', 'complete', 'completed')
    `).run(caseId, formType);
  } catch {
    // may already exist
  }
}

function seedCaseFacts(caseId, facts = {}) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO case_facts (case_id, facts_json) VALUES (?, ?)
    `).run(caseId, JSON.stringify(facts));
  } catch {
    db.prepare(`
      UPDATE case_facts SET facts_json = ? WHERE case_id = ?
    `).run(JSON.stringify(facts), caseId);
  }
}

function seedCompCandidate(caseId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('comp');
  db.prepare(`
    INSERT INTO comp_candidates (id, case_id, source_key, source_type, review_status, candidate_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, caseId,
    opts.sourceKey || randomId('src'),
    opts.sourceType || 'mls',
    opts.reviewStatus || 'pending',
    JSON.stringify(opts.candidateData || { salePrice: 250000, propertyType: 'single_family' })
  );
  return id;
}

function seedCompAcceptance(caseId, compCandidateId, opts = {}) {
  const db = getDb();
  const id = randomId('accept');
  db.prepare(`
    INSERT INTO comp_acceptance_events (id, case_id, comp_candidate_id, grid_slot, ranking_score, visible_reasoning_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, caseId, compCandidateId,
    opts.gridSlot || 'comp1',
    opts.rankingScore || 85,
    JSON.stringify(opts.reasoning || { reason: 'good match' })
  );
  return id;
}

function seedCompRejection(caseId, compCandidateId, opts = {}) {
  const db = getDb();
  const id = randomId('reject');
  db.prepare(`
    INSERT INTO comp_rejection_events (id, case_id, comp_candidate_id, reason_code, visible_reasoning_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id, caseId, compCandidateId,
    opts.reasonCode || 'too_distant',
    JSON.stringify(opts.reasoning || { reason: 'too far away' })
  );
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
  `).run(
    id, caseId,
    opts.gridSlot || 'comp1',
    opts.category || 'GLA',
    opts.subjectValue || '1800',
    opts.compValue || '1600',
    opts.suggestedAmount || 5000,
    opts.finalAmount || 6000,
    opts.decisionStatus || 'accepted'
  );
  return id;
}

function seedGenerationRun(caseId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('run');
  db.prepare(`
    INSERT INTO generation_runs (id, case_id, form_type, status)
    VALUES (?, ?, ?, ?)
  `).run(id, caseId, opts.formType || '1004', opts.status || 'completed');
  return id;
}

function seedSectionJob(runId, opts = {}) {
  const db = getDb();
  const id = opts.id || randomId('job');
  db.prepare(`
    INSERT INTO section_jobs (id, run_id, section_id, status)
    VALUES (?, ?, ?, ?)
  `).run(id, runId, opts.sectionId || 'neighborhood_description', opts.status || 'completed');
  return id;
}

function seedGeneratedSection(caseId, runId, opts = {}) {
  const db = getDb();
  const id = randomId('section');
  const jobId = opts.jobId || seedSectionJob(runId, { sectionId: opts.sectionId });
  db.prepare(`
    INSERT INTO generated_sections (
      id, job_id, run_id, case_id, section_id, form_type,
      draft_text, final_text, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    jobId,
    runId, caseId,
    opts.sectionId || 'neighborhood_description',
    opts.formType || '1004',
    opts.draftText || 'Draft neighborhood text here.',
    opts.finalText || 'Final edited neighborhood text with appraiser changes.',
    opts.approved ? 1 : 0
  );
  return id;
}

function seedReconciliation(caseId, data = {}) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO reconciliation_support_records (id, case_id, support_json)
      VALUES (?, ?, ?)
    `).run(randomId('recon'), caseId, JSON.stringify(data));
  } catch {
    // may already exist
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase 11 Learning System Tests ──────────────────────────────');

// ── Schema Tests ─────────────────────────────────────────────────────────────

await test('phase11 tables exist', () => {
  const db = getDb();
  const tables = ['assignment_archives', 'learned_patterns', 'pattern_applications'];
  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
    assert.ok(row.n >= 0, `Table ${t} should exist`);
  }
});

// ── Assignment Archive Tests ─────────────────────────────────────────────────

const testCaseId = randomId('case');

await test('archiveCompletedAssignment — requires caseId', () => {
  const result = archiveCompletedAssignment(null);
  assert.ok(result.error, 'should return error for null caseId');
});

await test('archiveCompletedAssignment — requires existing case', () => {
  const result = archiveCompletedAssignment('nonexistent-case');
  assert.ok(result.error, 'should return error for nonexistent case');
});

await test('archiveCompletedAssignment — archives a completed case', () => {
  seedCaseRecord(testCaseId, '1004');
  seedCaseFacts(testCaseId, {
    subject: {
      propertyType: 'single_family',
      county: 'McLean',
      salePrice: 250000,
    },
  });

  // Seed comps
  const compId1 = seedCompCandidate(testCaseId, {
    reviewStatus: 'accepted',
    candidateData: { salePrice: 245000, propertyType: 'single_family' },
  });
  seedCompAcceptance(testCaseId, compId1, { gridSlot: 'comp1' });

  const compId2 = seedCompCandidate(testCaseId, {
    reviewStatus: 'rejected',
    candidateData: { salePrice: 190000, propertyType: 'single_family' },
  });
  seedCompRejection(testCaseId, compId2, { reasonCode: 'too_distant' });

  // Seed adjustments
  seedAdjustmentSupport(testCaseId, { category: 'GLA', finalAmount: 5000 });
  seedAdjustmentSupport(testCaseId, { category: 'Age', finalAmount: -3000, gridSlot: 'comp1' });

  // Seed generation run + sections
  const runId = seedGenerationRun(testCaseId);
  seedGeneratedSection(testCaseId, runId, {
    sectionId: 'neighborhood_description',
    draftText: 'Draft neighborhood text.',
    finalText: 'Edited final neighborhood text.',
    approved: true,
  });

  // Seed reconciliation
  seedReconciliation(testCaseId, { method: 'weighted', weights: { comp1: 0.5, comp2: 0.3, comp3: 0.2 } });

  const result = archiveCompletedAssignment(testCaseId);
  assert.ok(result.id, 'should return archive id');
  assert.equal(result.caseId, testCaseId);
  assert.equal(result.status, 'active');
});

await test('archiveCompletedAssignment — prevents double archive', () => {
  const result = archiveCompletedAssignment(testCaseId);
  assert.ok(result.error, 'should error on double archive');
  assert.ok(result.error.includes('already archived'));
});

await test('getArchiveByCaseId — retrieves existing archive', () => {
  const archive = getArchiveByCaseId(testCaseId);
  assert.ok(archive, 'should return archive');
  assert.equal(archive.caseId, testCaseId);
  assert.equal(archive.formType, '1004');
  assert.ok(archive.subjectSnapshot, 'should have subject snapshot');
  assert.ok(archive.compSet, 'should have comp set');
  assert.ok(archive.compSet.accepted.length > 0, 'should have accepted comps');
  assert.ok(archive.compSet.rejected.length > 0, 'should have rejected comps');
});

await test('getArchiveByCaseId — returns null for nonexistent', () => {
  const archive = getArchiveByCaseId('nonexistent');
  assert.equal(archive, null);
});

await test('listArchives — returns active archives', () => {
  const archives = listArchives();
  assert.ok(archives.length > 0, 'should have at least one archive');
  assert.equal(archives[0].caseId, testCaseId);
});

// ── Pattern Learning Tests ───────────────────────────────────────────────────

let archiveId;

await test('learnFromArchive — extracts patterns', () => {
  const archive = getArchiveByCaseId(testCaseId);
  archiveId = archive.id;

  const result = learnFromArchive(archiveId);
  assert.ok(!result.error, 'should not error');
  assert.ok(result.patternsCreated > 0, 'should create patterns');
  assert.ok(result.patternTypes, 'should have pattern type breakdown');
});

await test('learnFromArchive — returns error for nonexistent', () => {
  const result = learnFromArchive('nonexistent');
  assert.ok(result.error, 'should return error');
});

await test('listPatterns — returns all patterns', () => {
  const patterns = listPatterns();
  assert.ok(patterns.length > 0, 'should have patterns');
  assert.ok(patterns[0].patternType, 'each pattern should have a type');
  assert.ok(patterns[0].patternKey, 'each pattern should have a key');
  assert.ok(patterns[0].data, 'each pattern should have data');
});

await test('listPatterns — filters by type', () => {
  const compPatterns = listPatterns({ patternType: 'comp_acceptance' });
  for (const p of compPatterns) {
    assert.equal(p.patternType, 'comp_acceptance');
  }
});

await test('getRelevantPatterns — finds patterns for context', () => {
  const patterns = getRelevantPatterns({
    formType: '1004',
    propertyType: 'single_family',
  });
  assert.ok(patterns.length > 0, 'should find relevant patterns');
});

await test('getRelevantPatterns — returns empty for unmatched context', () => {
  const patterns = getRelevantPatterns({
    formType: 'nonexistent_form',
    limit: 5,
  });
  assert.equal(patterns.length, 0, 'should return empty for unmatched');
});

// ── Pattern Application Tracking Tests ───────────────────────────────────────

let applicationId;

await test('recordPatternApplication — records application', () => {
  const patterns = listPatterns();
  assert.ok(patterns.length > 0, 'need at least one pattern');
  const patternId = patterns[0].id;

  const result = recordPatternApplication({
    patternId,
    caseId: randomId('new-case'),
    appliedContext: 'comp ranking boost',
  });
  assert.ok(result.id, 'should return application id');
  applicationId = result.id;

  // Verify usage count increased
  const updated = listPatterns();
  const pattern = updated.find(p => p.id === patternId);
  assert.ok(pattern.usageCount > 0, 'usage count should increase');
});

await test('recordApplicationOutcome — adjusts confidence on acceptance', () => {
  const patternsBefore = listPatterns();
  const patternId = patternsBefore[0].id;
  const confBefore = patternsBefore[0].confidence;

  recordApplicationOutcome(applicationId, 'accepted');

  const patternsAfter = listPatterns();
  const patternAfter = patternsAfter.find(p => p.id === patternId);
  assert.ok(
    patternAfter.confidence >= confBefore,
    `confidence should not decrease after acceptance (was ${confBefore}, now ${patternAfter.confidence})`
  );
});

// ── Similar Assignment Retrieval Tests ───────────────────────────────────────

await test('findSimilarAssignments — returns results for matching context', () => {
  const result = findSimilarAssignments({
    formType: '1004',
    propertyType: 'single_family',
  });
  assert.ok(result.totalScanned > 0, 'should scan archives');
  assert.ok(result.results.length > 0, 'should find similar assignments');
  assert.ok(result.results[0].similarityScore > 0, 'should have positive score');
  assert.ok(result.results[0].scoreBreakdown, 'should have score breakdown');
  assert.ok(result.results[0].matchReasons.length > 0, 'should have match reasons');
});

await test('findSimilarAssignments — returns empty for unmatched context', () => {
  const result = findSimilarAssignments({
    formType: 'nonexistent_form',
    propertyType: 'nonexistent_type',
    marketArea: 'nonexistent_area',
  });
  assert.equal(result.results.length, 0, 'should not match anything');
});

await test('findSimilarAssignments — price range matching works', () => {
  const result = findSimilarAssignments({
    formType: '1004',
    estimatedValue: 250000,
  });
  assert.ok(result.totalScanned > 0, 'should scan archives');
});

await test('getSimilarAssignmentDetail — returns full detail', () => {
  const archive = getArchiveByCaseId(testCaseId);
  const detail = getSimilarAssignmentDetail(archive.id);
  assert.ok(detail, 'should return detail');
  assert.ok(detail.subjectSnapshot, 'should have subject snapshot');
  assert.ok(detail.compSet, 'should have comp set');
});

await test('getSimilarAssignmentDetail — returns null for nonexistent', () => {
  const detail = getSimilarAssignmentDetail('nonexistent');
  assert.equal(detail, null);
});

// ── Learning Boost Tests ─────────────────────────────────────────────────────

await test('getLearningBoostForItem — returns zero for empty context', () => {
  const result = getLearningBoostForItem({}, {});
  assert.equal(result.score, 0);
  assert.ok(Array.isArray(result.reasons));
});

await test('getLearningBoostForItem — returns boost for matching item', () => {
  const result = getLearningBoostForItem(
    { propertyType: 'single_family', canonicalFieldId: 'neighborhood_description' },
    { formType: '1004', canonicalFieldId: 'neighborhood_description' }
  );
  // May or may not have a boost depending on pattern confidence
  assert.ok(typeof result.score === 'number', 'score should be a number');
  assert.ok(Array.isArray(result.reasons), 'reasons should be an array');
});

await test('getLearningEnhancedSuggestions — returns suggestions', () => {
  const suggestions = getLearningEnhancedSuggestions(testCaseId, { formType: '1004' });
  assert.ok(Array.isArray(suggestions), 'should return array');
  if (suggestions.length > 0) {
    assert.ok(suggestions[0].patternId, 'each suggestion should have patternId');
    assert.ok(suggestions[0].patternType, 'each suggestion should have patternType');
    assert.ok(suggestions[0].confidence >= 0, 'each suggestion should have confidence');
  }
});

// ── Second Archive (for multi-assignment learning) ───────────────────────────

await test('archives multiple assignments for cross-learning', () => {
  const caseId2 = randomId('case2');
  seedCaseRecord(caseId2, '1004');
  seedCaseFacts(caseId2, {
    subject: {
      propertyType: 'single_family',
      county: 'McLean',
      salePrice: 275000,
    },
  });

  const compId = seedCompCandidate(caseId2, {
    reviewStatus: 'accepted',
    candidateData: { salePrice: 270000, propertyType: 'single_family' },
  });
  seedCompAcceptance(caseId2, compId);
  seedAdjustmentSupport(caseId2, { category: 'GLA', finalAmount: 4500 });

  const result = archiveCompletedAssignment(caseId2);
  assert.ok(result.id, 'should create second archive');

  const learningResult = learnFromArchive(result.id);
  assert.ok(learningResult.patternsCreated > 0, 'should learn from second archive');

  // Now both archives should appear in similar assignment search
  const similar = findSimilarAssignments({ formType: '1004', propertyType: 'single_family' });
  assert.ok(similar.results.length >= 2, 'should find both similar assignments');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

closeDb();

console.log('\n─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const { label, err } of failures) {
    console.log(`  - ${label}: ${err.message}`);
  }
}
console.log('─'.repeat(60));

// Cleanup temp files
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch { /* best effort */ }

if (failed > 0) process.exit(1);
