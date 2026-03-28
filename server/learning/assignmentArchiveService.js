/**
 * server/learning/assignmentArchiveService.js
 * ----------------------------------------------
 * Phase 11 — Assignment Archive Service
 *
 * Captures the full final state of a completed assignment for learning.
 * Archives include:
 *   - Final subject facts snapshot
 *   - Final comp set (accepted/rejected comps with scores)
 *   - Final adjustment amounts per comp per category
 *   - Final narratives per section (draft vs final text)
 *   - Final reconciliation and value opinion
 *   - QC issues found and resolutions
 *   - AI draft vs final diff (what the appraiser changed)
 *   - Accepted vs rejected suggestions
 *
 * All functions are synchronous (better-sqlite3).
 */

import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// ── Archive Creation ────────────────────────────────────────────────────────

/**
 * Archive a completed assignment by capturing its full final state.
 *
 * Gathers data from:
 *   - case_facts (subject facts)
 *   - comp_candidates + comp_scores + comp_acceptance/rejection_events
 *   - adjustment_support_records
 *   - generated_sections + case_outputs (narratives)
 *   - reconciliation_support_records
 *   - qc_runs + qc_findings
 *
 * @param {string} caseId
 * @returns {{ id: string, caseId: string, status: string } | { error: string }}
 */
export function archiveCompletedAssignment(caseId) {
  if (!caseId) return { error: 'caseId is required' };

  // Check if already archived
  const existing = dbGet(
    "SELECT id, status FROM assignment_archives WHERE case_id = ? AND status = 'active'",
    [caseId]
  );
  if (existing) {
    return { error: `Assignment ${caseId} is already archived (id: ${existing.id})` };
  }

  // Load case record for form_type
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  if (!caseRecord) {
    return { error: `Case ${caseId} not found` };
  }

  // WS8: Only learn from approved/completed cases — policy enforcement
  const ARCHIVABLE_STAGES = new Set(['approved', 'inserting', 'complete']);
  if (!ARCHIVABLE_STAGES.has(caseRecord.pipeline_stage)) {
    return {
      error: `Case ${caseId} is not in an approved state (pipeline_stage: ${caseRecord.pipeline_stage}). Only approved/completed cases can be archived for learning.`,
    };
  }

  const formType = caseRecord.form_type;

  // ── 1. Subject facts snapshot ──────────────────────────────────────────
  const subjectSnapshot = buildSubjectSnapshot(caseId);

  // ── 2. Comp set snapshot ───────────────────────────────────────────────
  const compSet = buildCompSetSnapshot(caseId);

  // ── 3. Adjustments snapshot ────────────────────────────────────────────
  const adjustments = buildAdjustmentsSnapshot(caseId);

  // ── 4. Narratives snapshot ─────────────────────────────────────────────
  const narratives = buildNarrativesSnapshot(caseId);

  // ── 5. Reconciliation snapshot ─────────────────────────────────────────
  const reconciliation = buildReconciliationSnapshot(caseId);

  // ── 6. QC snapshot ─────────────────────────────────────────────────────
  const qcSnapshot = buildQcSnapshot(caseId);

  // ── 7. Edit diff (AI draft vs final) ───────────────────────────────────
  const editDiff = buildEditDiffSnapshot(caseId);

  // ── 8. Suggestion decisions ────────────────────────────────────────────
  const suggestionDecisions = buildSuggestionDecisionsSnapshot(caseId);

  // ── Extract searchable metadata ────────────────────────────────────────
  const facts = subjectSnapshot.facts || {};
  const subject = facts.subject || facts;
  const propertyType = subject.propertyType || subject.property_type || null;
  const marketArea = subject.marketArea || subject.market_area ||
    subject.county || subject.city || null;
  const priceRangeLow = extractPriceRangeLow(compSet, facts);
  const priceRangeHigh = extractPriceRangeHigh(compSet, facts);

  // ── Insert archive ─────────────────────────────────────────────────────
  const id = uuidv4();

  dbRun(`
    INSERT INTO assignment_archives (
      id, case_id, form_type, status,
      subject_snapshot_json, comp_set_json, adjustments_json,
      narratives_json, reconciliation_json, qc_snapshot_json,
      edit_diff_json, suggestion_decisions_json,
      property_type, market_area, price_range_low, price_range_high
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, caseId, formType,
    toJSON(subjectSnapshot),
    toJSON(compSet),
    toJSON(adjustments),
    toJSON(narratives),
    toJSON(reconciliation),
    toJSON(qcSnapshot),
    toJSON(editDiff),
    toJSON(suggestionDecisions),
    propertyType,
    marketArea,
    priceRangeLow,
    priceRangeHigh,
  ]);

  log.info('learning:archive-created', { id, caseId, formType });
  return { id, caseId, status: 'active' };
}

// ── Archive Retrieval ────────────────────────────────────────────────────────

/**
 * Get the archive for a case.
 *
 * @param {string} caseId
 * @returns {Object|null}
 */
export function getArchiveByCaseId(caseId) {
  const row = dbGet(
    "SELECT * FROM assignment_archives WHERE case_id = ? AND status = 'active'",
    [caseId]
  );
  return row ? hydrateArchive(row) : null;
}

/**
 * Get an archive by its ID.
 *
 * @param {string} archiveId
 * @returns {Object|null}
 */
export function getArchiveById(archiveId) {
  const row = dbGet('SELECT * FROM assignment_archives WHERE id = ?', [archiveId]);
  return row ? hydrateArchive(row) : null;
}

/**
 * List all active archives.
 *
 * @param {Object} [filters]
 * @param {string} [filters.formType]
 * @param {string} [filters.propertyType]
 * @param {string} [filters.marketArea]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Object[]}
 */
export function listArchives(filters = {}) {
  const where = ["status = 'active'"];
  const params = [];

  if (filters.formType) { where.push('form_type = ?'); params.push(filters.formType); }
  if (filters.propertyType) { where.push('property_type = ?'); params.push(filters.propertyType); }
  if (filters.marketArea) { where.push('market_area = ?'); params.push(filters.marketArea); }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const rows = dbAll(
    `SELECT * FROM assignment_archives WHERE ${where.join(' AND ')}
     ORDER BY archived_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return rows.map(hydrateArchive);
}

// ── Snapshot Builders ────────────────────────────────────────────────────────

function buildSubjectSnapshot(caseId) {
  const factsRow = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  return {
    facts: parseJSON(factsRow?.facts_json, {}),
    provenance: parseJSON(factsRow?.provenance_json, {}),
  };
}

function buildCompSetSnapshot(caseId) {
  const candidates = dbAll(
    'SELECT * FROM comp_candidates WHERE case_id = ? ORDER BY created_at',
    [caseId]
  );

  const accepted = [];
  const rejected = [];

  for (const c of candidates) {
    const candidateData = parseJSON(c.candidate_json, {});
    const scoreRow = dbGet(
      'SELECT * FROM comp_scores WHERE comp_candidate_id = ? ORDER BY computed_at DESC LIMIT 1',
      [c.id]
    );
    const score = scoreRow ? {
      overall: scoreRow.overall_score,
      coverage: scoreRow.coverage_score,
      breakdown: parseJSON(scoreRow.breakdown_json, {}),
    } : null;

    const entry = {
      id: c.id,
      sourceKey: c.source_key,
      sourceType: c.source_type,
      reviewStatus: c.review_status,
      candidateData,
      score,
    };

    if (c.review_status === 'accepted') {
      const acceptEvent = dbGet(
        'SELECT * FROM comp_acceptance_events WHERE comp_candidate_id = ? ORDER BY accepted_at DESC LIMIT 1',
        [c.id]
      );
      if (acceptEvent) {
        entry.gridSlot = acceptEvent.grid_slot;
        entry.acceptanceReasoning = parseJSON(acceptEvent.visible_reasoning_json, {});
      }
      accepted.push(entry);
    } else if (c.review_status === 'rejected') {
      const rejectEvent = dbGet(
        'SELECT * FROM comp_rejection_events WHERE comp_candidate_id = ? ORDER BY rejected_at DESC LIMIT 1',
        [c.id]
      );
      if (rejectEvent) {
        entry.rejectionReason = rejectEvent.reason_code;
        entry.rejectionReasoning = parseJSON(rejectEvent.visible_reasoning_json, {});
      }
      rejected.push(entry);
    }
  }

  return { accepted, rejected, totalCandidates: candidates.length };
}

function buildAdjustmentsSnapshot(caseId) {
  const rows = dbAll(
    'SELECT * FROM adjustment_support_records WHERE case_id = ? ORDER BY grid_slot, adjustment_category',
    [caseId]
  );

  return rows.map(r => ({
    gridSlot: r.grid_slot,
    adjustmentCategory: r.adjustment_category,
    subjectValue: r.subject_value,
    compValue: r.comp_value,
    supportType: r.support_type,
    supportStrength: r.support_strength,
    suggestedAmount: r.suggested_amount,
    suggestedRange: parseJSON(r.suggested_range_json, {}),
    finalAmount: r.final_amount,
    finalRange: parseJSON(r.final_range_json, {}),
    decisionStatus: r.decision_status,
    recommendationSource: r.recommendation_source,
    rationaleNote: r.rationale_note,
  }));
}

function buildNarrativesSnapshot(caseId) {
  // Get latest generation run
  const latestRun = dbGet(
    "SELECT id FROM generation_runs WHERE case_id = ? AND status IN ('completed', 'partial') ORDER BY created_at DESC LIMIT 1",
    [caseId]
  );

  if (!latestRun) return { sections: [], runId: null };

  const sections = dbAll(
    'SELECT * FROM generated_sections WHERE case_id = ? AND run_id = ? ORDER BY section_id',
    [caseId, latestRun.id]
  );

  // Also get case outputs for final text
  const outputsRow = dbGet('SELECT * FROM case_outputs WHERE case_id = ?', [caseId]);
  const outputs = parseJSON(outputsRow?.outputs_json, {});

  return {
    runId: latestRun.id,
    sections: sections.map(s => ({
      sectionId: s.section_id,
      draftText: s.draft_text,
      reviewedText: s.reviewed_text,
      finalText: s.final_text || outputs[s.section_id]?.text || null,
      approved: !!s.approved,
      qualityScore: s.quality_score,
    })),
  };
}

function buildReconciliationSnapshot(caseId) {
  const row = dbGet(
    'SELECT * FROM reconciliation_support_records WHERE case_id = ?',
    [caseId]
  );
  return row ? parseJSON(row.support_json, {}) : {};
}

function buildQcSnapshot(caseId) {
  const latestRun = dbGet(
    "SELECT * FROM qc_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1",
    [caseId]
  );

  if (!latestRun) return { runId: null, findings: [] };

  const findings = dbAll(
    'SELECT * FROM qc_findings WHERE qc_run_id = ? ORDER BY severity, created_at',
    [latestRun.id]
  );

  return {
    runId: latestRun.id,
    status: latestRun.status,
    findings: findings.map(f => ({
      id: f.id,
      ruleId: f.rule_id,
      severity: f.severity,
      category: f.category,
      message: f.message,
      status: f.status,
    })),
  };
}

function buildEditDiffSnapshot(caseId) {
  const sections = dbAll(
    `SELECT gs.section_id, gs.draft_text, gs.final_text, gs.reviewed_text
     FROM generated_sections gs
     INNER JOIN generation_runs gr ON gs.run_id = gr.id
     WHERE gs.case_id = ?
       AND gr.status IN ('completed', 'partial')
     ORDER BY gr.created_at DESC`,
    [caseId]
  );

  const diffs = {};
  for (const s of sections) {
    const draft = (s.draft_text || '').trim();
    const final = (s.final_text || s.reviewed_text || '').trim();
    if (draft && final && draft !== final) {
      diffs[s.section_id] = {
        draftLength: draft.length,
        finalLength: final.length,
        changed: true,
        lengthDelta: final.length - draft.length,
      };
    }
  }

  return diffs;
}

function buildSuggestionDecisionsSnapshot(caseId) {
  // Capture comp acceptance/rejection decisions as suggestion decisions
  const acceptances = dbAll(
    'SELECT * FROM comp_acceptance_events WHERE case_id = ? ORDER BY accepted_at',
    [caseId]
  );
  const rejections = dbAll(
    'SELECT * FROM comp_rejection_events WHERE case_id = ? ORDER BY rejected_at',
    [caseId]
  );

  return {
    compAcceptances: acceptances.map(a => ({
      compCandidateId: a.comp_candidate_id,
      gridSlot: a.grid_slot,
      rankingScore: a.ranking_score,
      reasoning: parseJSON(a.visible_reasoning_json, {}),
    })),
    compRejections: rejections.map(r => ({
      compCandidateId: r.comp_candidate_id,
      reasonCode: r.reason_code,
      rankingScore: r.ranking_score,
      reasoning: parseJSON(r.visible_reasoning_json, {}),
    })),
  };
}

// ── Price Range Helpers ──────────────────────────────────────────────────────

function extractPriceRangeLow(compSet, facts) {
  const prices = [];
  if (facts?.subject?.salePrice) prices.push(Number(facts.subject.salePrice));
  if (facts?.contract?.salePrice) prices.push(Number(facts.contract.salePrice));
  for (const comp of (compSet.accepted || [])) {
    const price = comp.candidateData?.salePrice || comp.candidateData?.sale_price;
    if (price) prices.push(Number(price));
  }
  const valid = prices.filter(p => p > 0 && isFinite(p));
  return valid.length > 0 ? Math.min(...valid) : null;
}

function extractPriceRangeHigh(compSet, facts) {
  const prices = [];
  if (facts?.subject?.salePrice) prices.push(Number(facts.subject.salePrice));
  if (facts?.contract?.salePrice) prices.push(Number(facts.contract.salePrice));
  for (const comp of (compSet.accepted || [])) {
    const price = comp.candidateData?.salePrice || comp.candidateData?.sale_price;
    if (price) prices.push(Number(price));
  }
  const valid = prices.filter(p => p > 0 && isFinite(p));
  return valid.length > 0 ? Math.max(...valid) : null;
}

// ── Hydration ────────────────────────────────────────────────────────────────

function hydrateArchive(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    formType: row.form_type,
    status: row.status,
    subjectSnapshot: parseJSON(row.subject_snapshot_json, {}),
    compSet: parseJSON(row.comp_set_json, {}),
    adjustments: parseJSON(row.adjustments_json, {}),
    narratives: parseJSON(row.narratives_json, {}),
    reconciliation: parseJSON(row.reconciliation_json, {}),
    qcSnapshot: parseJSON(row.qc_snapshot_json, {}),
    editDiff: parseJSON(row.edit_diff_json, {}),
    suggestionDecisions: parseJSON(row.suggestion_decisions_json, {}),
    propertyType: row.property_type,
    marketArea: row.market_area,
    priceRangeLow: row.price_range_low,
    priceRangeHigh: row.price_range_high,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}
