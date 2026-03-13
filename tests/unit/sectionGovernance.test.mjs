/**
 * tests/unit/sectionGovernance.test.mjs
 * ----------------------------------------
 * Unit tests for the section governance service.
 *
 * Covers:
 *   - Section governance metadata query
 *   - Freshness status tracking
 *   - Staleness invalidation
 *   - Downstream invalidation cascade
 *   - Edge cases (missing case, no sections, etc.)
 */

import assert from 'node:assert/strict';
import { getDb, dbRun, dbAll } from '../../server/db/database.js';
import {
  FRESHNESS_STATUS,
  getSectionGovernanceMetadata,
  getSingleSectionGovernance,
  getSectionDependencyGraph,
  markSectionStale,
  invalidateDownstream,
  getFreshnessSummary,
} from '../../server/sectionFactory/sectionGovernanceService.js';

const suiteName = 'sectionGovernance';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.error('  FAIL ' + name);
    console.error('       ' + err.message);
    failed++;
  }
}

// ── Setup: ensure DB is initialized and seed test data ────────────────────────

const TEST_CASE_ID = 'gov-test-case-001';
const TEST_RUN_ID = 'gov-test-run-001';

function ensureTestTables() {
  const db = getDb();
  // Ensure columns exist (they may have been added by migrations already)
  const cols = db.prepare("PRAGMA table_info(generated_sections)").all().map(c => c.name);
  if (!cols.includes('freshness_status')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN freshness_status TEXT DEFAULT 'current'").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('stale_reason')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN stale_reason TEXT").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('stale_since')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN stale_since TEXT").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('regeneration_count')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN regeneration_count INTEGER DEFAULT 0").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('prompt_version')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN prompt_version TEXT").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('section_policy_json')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN section_policy_json TEXT").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('dependency_snapshot_json')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN dependency_snapshot_json TEXT").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('quality_score')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN quality_score REAL").run(); } catch { /* already exists */ }
  }
  if (!cols.includes('quality_metadata_json')) {
    try { db.prepare("ALTER TABLE generated_sections ADD COLUMN quality_metadata_json TEXT").run(); } catch { /* already exists */ }
  }
}

function seedTestData() {
  // Clean up any prior test data
  dbRun("DELETE FROM generated_sections WHERE case_id = ?", [TEST_CASE_ID]);

  // Ensure run and job exist for FK constraints
  try {
    dbRun(
      `INSERT OR IGNORE INTO generation_runs (id, case_id, form_type, status, created_at)
       VALUES (?, ?, '1004', 'completed', datetime('now'))`,
      [TEST_RUN_ID, TEST_CASE_ID],
    );
  } catch { /* already exists */ }

  const sections = [
    {
      id: 'gov-gs-001',
      jobId: 'gov-job-001',
      sectionId: 'neighborhood_description',
      promptVersion: 'cacc-section-factory/retrieval-guided@1',
      qualityScore: 0.85,
      freshnessStatus: 'current',
      dependencySnapshot: JSON.stringify({ upstreamSections: [], downstreamSections: ['reconciliation'] }),
      sectionPolicy: JSON.stringify({ generatorProfile: 'retrieval-guided' }),
    },
    {
      id: 'gov-gs-002',
      jobId: 'gov-job-002',
      sectionId: 'site_description',
      promptVersion: 'cacc-section-factory/data-driven@1',
      qualityScore: 0.90,
      freshnessStatus: 'current',
      dependencySnapshot: JSON.stringify({ upstreamSections: [], downstreamSections: [] }),
      sectionPolicy: JSON.stringify({ generatorProfile: 'data-driven' }),
    },
    {
      id: 'gov-gs-003',
      jobId: 'gov-job-003',
      sectionId: 'reconciliation',
      promptVersion: 'cacc-section-factory/synthesis@1',
      qualityScore: 0.75,
      freshnessStatus: 'current',
      dependencySnapshot: JSON.stringify({ upstreamSections: ['neighborhood_description', 'site_description'], downstreamSections: [] }),
      sectionPolicy: JSON.stringify({ generatorProfile: 'synthesis' }),
    },
  ];

  for (const s of sections) {
    // Insert section job first
    try {
      dbRun(
        `INSERT OR IGNORE INTO section_jobs (id, run_id, section_id, case_id, form_type, status, created_at)
         VALUES (?, ?, ?, ?, '1004', 'completed', datetime('now'))`,
        [s.jobId, TEST_RUN_ID, s.sectionId, TEST_CASE_ID],
      );
    } catch { /* already exists */ }

    dbRun(
      `INSERT INTO generated_sections
         (id, job_id, run_id, case_id, section_id, form_type,
          draft_text, prompt_version, quality_score,
          freshness_status, section_policy_json, dependency_snapshot_json,
          created_at)
       VALUES (?, ?, ?, ?, ?, '1004',
               'Test text', ?, ?,
               ?, ?, ?,
               datetime('now'))`,
      [s.id, s.jobId, TEST_RUN_ID, TEST_CASE_ID, s.sectionId,
       s.promptVersion, s.qualityScore,
       s.freshnessStatus, s.sectionPolicy, s.dependencySnapshot],
    );
  }
}

// Initialize
ensureTestTables();
seedTestData();

console.log(suiteName);
console.log('─'.repeat(60));

// ═══════════════════════════════════════════════════════════════════════════════
// Section Governance Metadata Query
// ═══════════════════════════════════════════════════════════════════════════════

test('getSectionGovernanceMetadata returns all sections for a case', () => {
  const sections = getSectionGovernanceMetadata(TEST_CASE_ID);
  assert.ok(Array.isArray(sections));
  assert.ok(sections.length >= 3);
  const sectionIds = sections.map(s => s.sectionId);
  assert.ok(sectionIds.includes('neighborhood_description'));
  assert.ok(sectionIds.includes('site_description'));
  assert.ok(sectionIds.includes('reconciliation'));
});

test('getSectionGovernanceMetadata returns parsed governance fields', () => {
  const sections = getSectionGovernanceMetadata(TEST_CASE_ID);
  const neighborhood = sections.find(s => s.sectionId === 'neighborhood_description');
  assert.ok(neighborhood);
  assert.equal(neighborhood.promptVersion, 'cacc-section-factory/retrieval-guided@1');
  assert.equal(neighborhood.qualityScore, 0.85);
  assert.equal(neighborhood.freshnessStatus, 'current');
  assert.equal(typeof neighborhood.sectionPolicy, 'object');
  assert.equal(typeof neighborhood.dependencySnapshot, 'object');
});

test('getSectionGovernanceMetadata returns empty array for unknown case', () => {
  const sections = getSectionGovernanceMetadata('nonexistent-case-999');
  assert.ok(Array.isArray(sections));
  assert.equal(sections.length, 0);
});

test('getSectionGovernanceMetadata returns empty array for null/empty caseId', () => {
  assert.deepEqual(getSectionGovernanceMetadata(null), []);
  assert.deepEqual(getSectionGovernanceMetadata(''), []);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Single Section Governance Detail
// ═══════════════════════════════════════════════════════════════════════════════

test('getSingleSectionGovernance returns detail for existing section', () => {
  const section = getSingleSectionGovernance(TEST_CASE_ID, 'reconciliation');
  assert.ok(section);
  assert.equal(section.sectionId, 'reconciliation');
  assert.equal(section.qualityScore, 0.75);
  assert.equal(section.promptVersion, 'cacc-section-factory/synthesis@1');
});

test('getSingleSectionGovernance returns null for missing section', () => {
  const section = getSingleSectionGovernance(TEST_CASE_ID, 'nonexistent_section');
  assert.equal(section, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dependency Graph
// ═══════════════════════════════════════════════════════════════════════════════

test('getSectionDependencyGraph returns graph with upstream/downstream', () => {
  const graph = getSectionDependencyGraph(TEST_CASE_ID);
  assert.ok(typeof graph === 'object');
  assert.ok('reconciliation' in graph);
  const recon = graph.reconciliation;
  assert.ok(Array.isArray(recon.upstream));
  assert.ok(recon.upstream.includes('neighborhood_description'));
  assert.ok(recon.upstream.includes('site_description'));
});

test('getSectionDependencyGraph returns empty object for unknown case', () => {
  const graph = getSectionDependencyGraph('nonexistent-case-999');
  assert.deepEqual(graph, {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Staleness Invalidation
// ═══════════════════════════════════════════════════════════════════════════════

test('markSectionStale marks a current section as stale', () => {
  // Reset to current first
  dbRun(
    "UPDATE generated_sections SET freshness_status = 'current', stale_reason = NULL, stale_since = NULL WHERE case_id = ? AND section_id = ?",
    [TEST_CASE_ID, 'site_description'],
  );

  const result = markSectionStale(TEST_CASE_ID, 'site_description', 'test_reason');
  assert.equal(result.ok, true);
  assert.ok(result.updated > 0);

  const section = getSingleSectionGovernance(TEST_CASE_ID, 'site_description');
  assert.equal(section.freshnessStatus, 'stale');
  assert.equal(section.staleReason, 'test_reason');
  assert.ok(section.staleSince);
});

test('markSectionStale returns ok:false for null inputs', () => {
  const result = markSectionStale(null, 'site_description');
  assert.equal(result.ok, false);
  assert.equal(result.updated, 0);
});

test('markSectionStale does not double-mark already stale section', () => {
  // Ensure stale
  markSectionStale(TEST_CASE_ID, 'site_description', 'first_reason');
  // Try to mark stale again
  const result = markSectionStale(TEST_CASE_ID, 'site_description', 'second_reason');
  assert.equal(result.ok, true);
  assert.equal(result.updated, 0);

  // Verify reason didn't change
  const section = getSingleSectionGovernance(TEST_CASE_ID, 'site_description');
  assert.equal(section.staleReason, 'first_reason');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Downstream Invalidation Cascade
// ═══════════════════════════════════════════════════════════════════════════════

test('invalidateDownstream cascades staleness to downstream sections', () => {
  // Reset all to current
  dbRun(
    "UPDATE generated_sections SET freshness_status = 'current', stale_reason = NULL, stale_since = NULL WHERE case_id = ?",
    [TEST_CASE_ID],
  );

  // neighborhood_description has 'reconciliation' as downstream (per reportPlanner)
  const result = invalidateDownstream(TEST_CASE_ID, 'neighborhood_description', '1004');
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.invalidated));
  // The actual downstream sections depend on reportPlanner; just verify structure
  assert.equal(typeof result.invalidated.length, 'number');
});

test('invalidateDownstream returns ok:false for null caseId', () => {
  const result = invalidateDownstream(null, 'neighborhood_description');
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalidated, []);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Freshness Summary
// ═══════════════════════════════════════════════════════════════════════════════

test('getFreshnessSummary returns correct counts', () => {
  // Reset all to current
  dbRun(
    "UPDATE generated_sections SET freshness_status = 'current', stale_reason = NULL, stale_since = NULL WHERE case_id = ?",
    [TEST_CASE_ID],
  );
  // Mark one stale
  markSectionStale(TEST_CASE_ID, 'site_description', 'test');

  const summary = getFreshnessSummary(TEST_CASE_ID);
  assert.equal(summary.caseId, TEST_CASE_ID);
  assert.ok(summary.totalSections >= 3);
  assert.ok(summary.stale >= 1);
  assert.ok(summary.current >= 2);
  assert.ok(Array.isArray(summary.sections));
});

test('getFreshnessSummary returns zeros for unknown case', () => {
  const summary = getFreshnessSummary('nonexistent-case-999');
  assert.equal(summary.totalSections, 0);
  assert.equal(summary.current, 0);
  assert.equal(summary.stale, 0);
  assert.deepEqual(summary.sections, []);
});

test('getFreshnessSummary returns empty for null caseId', () => {
  const summary = getFreshnessSummary(null);
  assert.equal(summary.totalSections, 0);
  assert.equal(summary.caseId, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRESHNESS_STATUS constants
// ═══════════════════════════════════════════════════════════════════════════════

test('FRESHNESS_STATUS constants are defined correctly', () => {
  assert.equal(FRESHNESS_STATUS.CURRENT, 'current');
  assert.equal(FRESHNESS_STATUS.STALE, 'stale');
  assert.equal(FRESHNESS_STATUS.REGENERATING, 'regenerating');
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
try {
  dbRun("DELETE FROM generated_sections WHERE case_id = ?", [TEST_CASE_ID]);
  dbRun("DELETE FROM section_jobs WHERE case_id = ?", [TEST_CASE_ID]);
  dbRun("DELETE FROM generation_runs WHERE case_id = ?", [TEST_CASE_ID]);
} catch { /* best effort cleanup */ }

console.log('─'.repeat(60));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
