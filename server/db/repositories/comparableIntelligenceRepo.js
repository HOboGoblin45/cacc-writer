/**
 * server/db/repositories/comparableIntelligenceRepo.js
 * ----------------------------------------------------
 * Persistence helpers for Comparable Intelligence Engine state.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database.js';

function parseJSON(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toJSON(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

export function markComparableCandidatesInactive(caseId) {
  getDb().prepare(`
    UPDATE comp_candidates
       SET is_active = 0,
           updated_at = ?
     WHERE case_id = ?
  `).run(new Date().toISOString(), caseId);
}

export function upsertComparableCandidate({
  id = null,
  caseId,
  sourceKey,
  sourceType,
  sourceDocumentId = null,
  reviewStatus = 'pending',
  isActive = 1,
  candidate = {},
}) {
  if (!caseId || !sourceKey || !sourceType) {
    throw new Error('caseId, sourceKey, and sourceType are required');
  }

  const db = getDb();
  const existing = db.prepare(`
    SELECT id, review_status
      FROM comp_candidates
     WHERE case_id = ? AND source_key = ?
     LIMIT 1
  `).get(caseId, sourceKey);

  const candidateId = existing?.id || id || uuidv4();
  const effectiveReviewStatus = existing?.review_status && reviewStatus === 'pending'
    ? existing.review_status
    : reviewStatus;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO comp_candidates (
      id, case_id, source_key, source_type, source_document_id,
      review_status, is_active, candidate_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id, source_key) DO UPDATE SET
      source_type = excluded.source_type,
      source_document_id = excluded.source_document_id,
      review_status = excluded.review_status,
      is_active = excluded.is_active,
      candidate_json = excluded.candidate_json,
      updated_at = excluded.updated_at
  `).run(
    candidateId,
    caseId,
    sourceKey,
    sourceType,
    sourceDocumentId,
    effectiveReviewStatus,
    isActive ? 1 : 0,
    toJSON(candidate, {}),
    now,
    now,
  );

  return candidateId;
}

export function listComparableCandidates(caseId, { activeOnly = true } = {}) {
  const rows = getDb().prepare(`
    SELECT *
      FROM comp_candidates
     WHERE case_id = ?
       ${activeOnly ? 'AND is_active = 1' : ''}
     ORDER BY datetime(updated_at) DESC, created_at DESC
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDocumentId: row.source_document_id,
    reviewStatus: row.review_status,
    isActive: Boolean(row.is_active),
    candidate: parseJSON(row.candidate_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getComparableCandidate(caseId, candidateId) {
  const row = getDb().prepare(`
    SELECT *
      FROM comp_candidates
     WHERE case_id = ? AND id = ?
     LIMIT 1
  `).get(caseId, candidateId);

  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    sourceDocumentId: row.source_document_id,
    reviewStatus: row.review_status,
    isActive: Boolean(row.is_active),
    candidate: parseJSON(row.candidate_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateComparableCandidateReviewStatus(caseId, candidateId, reviewStatus) {
  getDb().prepare(`
    UPDATE comp_candidates
       SET review_status = ?,
           updated_at = ?
     WHERE case_id = ? AND id = ?
  `).run(reviewStatus, new Date().toISOString(), caseId, candidateId);
}

export function replaceComparableScores(caseId, scores = []) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM comp_scores WHERE case_id = ?').run(caseId);
    db.prepare('DELETE FROM comp_tier_assignments WHERE case_id = ?').run(caseId);

    const scoreStmt = db.prepare(`
      INSERT INTO comp_scores (
        id, case_id, comp_candidate_id, overall_score, coverage_score,
        breakdown_json, weights_json, warnings_json, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tierStmt = db.prepare(`
      INSERT INTO comp_tier_assignments (
        id, case_id, comp_candidate_id, tier, reasoning_json, assigned_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const score of scores) {
      scoreStmt.run(
        uuidv4(),
        caseId,
        score.compCandidateId,
        score.overallScore,
        score.coverageScore ?? 0,
        toJSON(score.breakdown || {}, {}),
        toJSON(score.weights || {}, {}),
        toJSON(score.warnings || [], []),
        now,
      );
      tierStmt.run(
        uuidv4(),
        caseId,
        score.compCandidateId,
        score.tier,
        toJSON(score.tierReasoning || {}, {}),
        now,
      );
    }
  });

  tx();
}

export function listComparableScores(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM comp_scores
     WHERE case_id = ?
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    overallScore: row.overall_score,
    coverageScore: row.coverage_score,
    breakdown: parseJSON(row.breakdown_json, {}),
    weights: parseJSON(row.weights_json, {}),
    warnings: parseJSON(row.warnings_json, []),
    computedAt: row.computed_at,
  }));
}

export function listComparableTierAssignments(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM comp_tier_assignments
     WHERE case_id = ?
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    tier: row.tier,
    reasoning: parseJSON(row.reasoning_json, {}),
    assignedAt: row.assigned_at,
  }));
}

export function recordComparableAcceptanceEvent({
  caseId,
  compCandidateId,
  acceptedBy = 'appraiser',
  gridSlot = null,
  rankingScore = null,
  visibleReasoning = {},
  becameFinalComp = false,
  note = '',
}) {
  getDb().prepare(`
    INSERT INTO comp_acceptance_events (
      id, case_id, comp_candidate_id, accepted_by, grid_slot,
      ranking_score, visible_reasoning_json, became_final_comp, note, accepted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    caseId,
    compCandidateId,
    acceptedBy,
    gridSlot,
    rankingScore,
    toJSON(visibleReasoning, {}),
    becameFinalComp ? 1 : 0,
    note || '',
    new Date().toISOString(),
  );
}

export function listComparableAcceptanceEvents(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM comp_acceptance_events
     WHERE case_id = ?
     ORDER BY datetime(accepted_at) DESC, id DESC
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    acceptedBy: row.accepted_by,
    gridSlot: row.grid_slot,
    rankingScore: row.ranking_score,
    visibleReasoning: parseJSON(row.visible_reasoning_json, {}),
    becameFinalComp: Boolean(row.became_final_comp),
    note: row.note || '',
    acceptedAt: row.accepted_at,
  }));
}

export function recordComparableRejectionEvent({
  caseId,
  compCandidateId,
  rejectedBy = 'appraiser',
  reasonCode,
  rankingScore = null,
  visibleReasoning = {},
  note = '',
}) {
  getDb().prepare(`
    INSERT INTO comp_rejection_events (
      id, case_id, comp_candidate_id, rejected_by, reason_code,
      ranking_score, visible_reasoning_json, note, rejected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    caseId,
    compCandidateId,
    rejectedBy,
    reasonCode,
    rankingScore,
    toJSON(visibleReasoning, {}),
    note || '',
    new Date().toISOString(),
  );
}

export function summarizeComparableHistory(caseId) {
  const db = getDb();
  const acceptRows = db.prepare(`
    SELECT comp_candidate_id, COUNT(*) AS accept_count
      FROM comp_acceptance_events
     WHERE case_id = ?
     GROUP BY comp_candidate_id
  `).all(caseId);
  const rejectRows = db.prepare(`
    SELECT comp_candidate_id, COUNT(*) AS reject_count
      FROM comp_rejection_events
     WHERE case_id = ?
     GROUP BY comp_candidate_id
  `).all(caseId);

  const summary = new Map();
  for (const row of acceptRows) {
    summary.set(row.comp_candidate_id, {
      acceptedCount: row.accept_count || 0,
      rejectedCount: 0,
    });
  }
  for (const row of rejectRows) {
    const existing = summary.get(row.comp_candidate_id) || { acceptedCount: 0, rejectedCount: 0 };
    existing.rejectedCount = row.reject_count || 0;
    summary.set(row.comp_candidate_id, existing);
  }
  return summary;
}

export function listAdjustmentSupportRecords(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM adjustment_support_records
     WHERE case_id = ?
     ORDER BY grid_slot, adjustment_category
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    gridSlot: row.grid_slot,
    adjustmentCategory: row.adjustment_category,
    subjectValue: row.subject_value || '',
    compValue: row.comp_value || '',
    supportType: row.support_type,
    supportStrength: row.support_strength,
    suggestedAmount: row.suggested_amount,
    suggestedRange: parseJSON(row.suggested_range_json, {}),
    finalAmount: row.final_amount,
    finalRange: parseJSON(row.final_range_json, {}),
    supportEvidence: parseJSON(row.support_evidence_json, []),
    rationaleNote: row.rationale_note || '',
    decisionStatus: row.decision_status,
    recommendationSource: row.recommendation_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function replaceAdjustmentSupportRecords(caseId, records = []) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM adjustment_support_records WHERE case_id = ?').run(caseId);

    const stmt = db.prepare(`
      INSERT INTO adjustment_support_records (
        id, case_id, comp_candidate_id, grid_slot, adjustment_category,
        subject_value, comp_value, support_type, support_strength,
        suggested_amount, suggested_range_json, final_amount, final_range_json,
        support_evidence_json, rationale_note, decision_status,
        recommendation_source, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      const now = record.updatedAt || new Date().toISOString();
      stmt.run(
        record.id || uuidv4(),
        caseId,
        record.compCandidateId || null,
        record.gridSlot,
        record.adjustmentCategory,
        record.subjectValue || '',
        record.compValue || '',
        record.supportType || 'appraiser_judgment_with_explanation',
        record.supportStrength || 'medium',
        record.suggestedAmount ?? null,
        toJSON(record.suggestedRange || {}, {}),
        record.finalAmount ?? null,
        toJSON(record.finalRange || {}, {}),
        toJSON(record.supportEvidence || [], []),
        record.rationaleNote || '',
        record.decisionStatus || 'pending',
        record.recommendationSource || 'heuristic_seed',
        now,
        record.createdAt || now,
      );
    }
  });

  tx();
}

export function updateAdjustmentSupportDecision({
  caseId,
  gridSlot,
  adjustmentCategory,
  decisionStatus,
  rationaleNote = '',
  finalAmount = null,
  finalRange = undefined,
  supportType = undefined,
}) {
  const existing = getDb().prepare(`
    SELECT id, support_type
      FROM adjustment_support_records
     WHERE case_id = ? AND grid_slot = ? AND adjustment_category = ?
     LIMIT 1
  `).get(caseId, gridSlot, adjustmentCategory);

  if (!existing) return false;

  getDb().prepare(`
    UPDATE adjustment_support_records
       SET decision_status = ?,
           rationale_note = ?,
           final_amount = ?,
           final_range_json = ?,
           support_type = ?,
           updated_at = ?
     WHERE id = ?
  `).run(
    decisionStatus,
    rationaleNote || '',
    finalAmount,
    toJSON(finalRange === undefined ? {} : finalRange, {}),
    supportType || existing.support_type || 'appraiser_judgment_with_explanation',
    new Date().toISOString(),
    existing.id,
  );

  return true;
}

export function listAdjustmentRecommendations(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM adjustment_recommendations
     WHERE case_id = ?
     ORDER BY grid_slot, adjustment_category
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    gridSlot: row.grid_slot,
    adjustmentCategory: row.adjustment_category,
    recommendation: parseJSON(row.recommendation_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function replaceAdjustmentRecommendations(caseId, records = []) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM adjustment_recommendations WHERE case_id = ?').run(caseId);

    const stmt = db.prepare(`
      INSERT INTO adjustment_recommendations (
        id, case_id, comp_candidate_id, grid_slot, adjustment_category,
        recommendation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      const now = record.updatedAt || new Date().toISOString();
      stmt.run(
        record.id || uuidv4(),
        caseId,
        record.compCandidateId || null,
        record.gridSlot,
        record.adjustmentCategory,
        toJSON(record.recommendation || {}, {}),
        record.createdAt || now,
        now,
      );
    }
  });

  tx();
}

export function listCompBurdenMetrics(caseId) {
  const rows = getDb().prepare(`
    SELECT *
      FROM comp_burden_metrics
     WHERE case_id = ?
     ORDER BY grid_slot
  `).all(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    compCandidateId: row.comp_candidate_id,
    gridSlot: row.grid_slot,
    grossAdjustmentPercent: row.gross_adjustment_percent,
    netAdjustmentPercent: row.net_adjustment_percent,
    burdenByCategory: parseJSON(row.burden_by_category_json, {}),
    majorMismatchCount: row.major_mismatch_count || 0,
    dataConfidenceScore: row.data_confidence_score || 0,
    dateRelevanceScore: row.date_relevance_score || 0,
    locationConfidenceScore: row.location_confidence_score || 0,
    overallStabilityScore: row.overall_stability_score || 0,
    computedAt: row.computed_at,
  }));
}

export function replaceCompBurdenMetrics(caseId, metrics = []) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM comp_burden_metrics WHERE case_id = ?').run(caseId);

    const stmt = db.prepare(`
      INSERT INTO comp_burden_metrics (
        id, case_id, comp_candidate_id, grid_slot,
        gross_adjustment_percent, net_adjustment_percent,
        burden_by_category_json, major_mismatch_count,
        data_confidence_score, date_relevance_score,
        location_confidence_score, overall_stability_score, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const metric of metrics) {
      stmt.run(
        metric.id || uuidv4(),
        caseId,
        metric.compCandidateId || null,
        metric.gridSlot,
        metric.grossAdjustmentPercent ?? 0,
        metric.netAdjustmentPercent ?? 0,
        toJSON(metric.burdenByCategory || {}, {}),
        metric.majorMismatchCount ?? 0,
        metric.dataConfidenceScore ?? 0,
        metric.dateRelevanceScore ?? 0,
        metric.locationConfidenceScore ?? 0,
        metric.overallStabilityScore ?? 0,
        metric.computedAt || new Date().toISOString(),
      );
    }
  });

  tx();
}

export function upsertPairedSalesLibraryRecord(record = {}) {
  const id = record.id || uuidv4();
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO paired_sales_library_records (
      id, market_area, property_type, date_range_start, date_range_end,
      variable_analyzed, support_method, sample_size, conclusion, confidence,
      narrative_summary, linked_assignments_json, linked_comp_sets_json,
      creator, reviewer, approval_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      market_area = excluded.market_area,
      property_type = excluded.property_type,
      date_range_start = excluded.date_range_start,
      date_range_end = excluded.date_range_end,
      variable_analyzed = excluded.variable_analyzed,
      support_method = excluded.support_method,
      sample_size = excluded.sample_size,
      conclusion = excluded.conclusion,
      confidence = excluded.confidence,
      narrative_summary = excluded.narrative_summary,
      linked_assignments_json = excluded.linked_assignments_json,
      linked_comp_sets_json = excluded.linked_comp_sets_json,
      creator = excluded.creator,
      reviewer = excluded.reviewer,
      approval_status = excluded.approval_status,
      updated_at = excluded.updated_at
  `).run(
    id,
    record.marketArea || '',
    record.propertyType || '',
    record.dateRangeStart || null,
    record.dateRangeEnd || null,
    record.variableAnalyzed || '',
    record.supportMethod || 'appraiser_judgment_with_explanation',
    record.sampleSize ?? null,
    record.conclusion || '',
    record.confidence || 'medium',
    record.narrativeSummary || '',
    toJSON(record.linkedAssignments || [], []),
    toJSON(record.linkedCompSets || [], []),
    record.creator || '',
    record.reviewer || '',
    record.approvalStatus || 'draft',
    record.createdAt || now,
    now,
  );

  return id;
}

export function listPairedSalesLibraryRecords({
  variableAnalyzed = null,
  marketArea = null,
  propertyType = null,
  approvalStatus = null,
  limit = 50,
} = {}) {
  const clauses = [];
  const params = [];

  if (variableAnalyzed) {
    clauses.push('variable_analyzed = ?');
    params.push(variableAnalyzed);
  }
  if (marketArea) {
    clauses.push('(market_area = ? OR market_area = \'\')');
    params.push(marketArea);
  }
  if (propertyType) {
    clauses.push('(property_type = ? OR property_type = \'\')');
    params.push(propertyType);
  }
  if (approvalStatus) {
    clauses.push('approval_status = ?');
    params.push(approvalStatus);
  }

  params.push(Math.max(1, Math.min(limit || 50, 500)));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`
    SELECT *
      FROM paired_sales_library_records
      ${where}
     ORDER BY
       CASE approval_status WHEN 'approved' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
       datetime(updated_at) DESC
     LIMIT ?
  `).all(...params);

  return rows.map((row) => ({
    id: row.id,
    marketArea: row.market_area || '',
    propertyType: row.property_type || '',
    dateRangeStart: row.date_range_start || null,
    dateRangeEnd: row.date_range_end || null,
    variableAnalyzed: row.variable_analyzed,
    supportMethod: row.support_method,
    sampleSize: row.sample_size ?? null,
    conclusion: row.conclusion || '',
    confidence: row.confidence || 'medium',
    narrativeSummary: row.narrative_summary || '',
    linkedAssignments: parseJSON(row.linked_assignments_json, []),
    linkedCompSets: parseJSON(row.linked_comp_sets_json, []),
    creator: row.creator || '',
    reviewer: row.reviewer || '',
    approvalStatus: row.approval_status || 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
