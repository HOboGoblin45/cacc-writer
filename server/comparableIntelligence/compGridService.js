/**
 * server/comparableIntelligence/compGridService.js
 * --------------------------------------------------
 * Comp Grid Editor Service — manages the up-to-6 grid slots
 * used in the sales comparison approach grid.
 *
 * Grid state is derived from comp_acceptance_events (grid_slot),
 * adjustment_support_records, and comp_burden_metrics tables.
 */

import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const VALID_GRID_SLOTS = ['1', '2', '3', '4', '5', '6'];

function validateGridSlot(slot) {
  const s = String(slot);
  if (!VALID_GRID_SLOTS.includes(s)) {
    throw new Error(`Invalid grid slot "${slot}". Must be 1-6.`);
  }
  return s;
}

// ── getCompGrid ──────────────────────────────────────────────────────────────

/**
 * Returns the full comp grid state for a case.
 * Each slot contains comp candidate data, adjustments, and burden metrics.
 */
export function getCompGrid(caseId) {
  if (!caseId) throw new Error('caseId is required');

  const slots = {};

  // Get accepted comps that have grid slots
  const acceptances = dbAll(`
    SELECT ae.grid_slot, ae.comp_candidate_id, ae.ranking_score,
           ae.visible_reasoning_json, ae.accepted_at,
           cc.candidate_json, cc.source_key, cc.source_type
      FROM comp_acceptance_events ae
      JOIN comp_candidates cc ON cc.id = ae.comp_candidate_id
     WHERE ae.case_id = ? AND ae.grid_slot IS NOT NULL
       AND cc.is_active = 1
     ORDER BY ae.accepted_at DESC
  `, [caseId]);

  // Build grid — take the most recent acceptance per slot
  const seenSlots = new Set();
  for (const row of acceptances) {
    const slot = String(row.grid_slot);
    if (seenSlots.has(slot)) continue;
    seenSlots.add(slot);

    const candidateData = safeParseJSON(row.candidate_json, {});

    // Get adjustments for this slot
    const adjustments = dbAll(`
      SELECT adjustment_category, subject_value, comp_value,
             suggested_amount, final_amount, support_type,
             support_strength, rationale_note, decision_status
        FROM adjustment_support_records
       WHERE case_id = ? AND grid_slot = ?
       ORDER BY adjustment_category
    `, [caseId, slot]);

    // Get burden metrics for this slot
    const burden = dbGet(`
      SELECT gross_adjustment_percent, net_adjustment_percent,
             burden_by_category_json, major_mismatch_count,
             data_confidence_score, date_relevance_score,
             location_confidence_score, overall_stability_score
        FROM comp_burden_metrics
       WHERE case_id = ? AND grid_slot = ?
    `, [caseId, slot]);

    slots[slot] = {
      gridSlot: slot,
      compCandidateId: row.comp_candidate_id,
      sourceKey: row.source_key,
      sourceType: row.source_type,
      candidateData,
      rankingScore: row.ranking_score,
      reasoning: safeParseJSON(row.visible_reasoning_json, {}),
      adjustments: adjustments.map(a => ({
        ...a,
        suggestedAmount: a.suggested_amount,
        finalAmount: a.final_amount,
      })),
      burden: burden ? {
        grossAdjustmentPercent: burden.gross_adjustment_percent,
        netAdjustmentPercent: burden.net_adjustment_percent,
        burdenByCategory: safeParseJSON(burden.burden_by_category_json, {}),
        majorMismatchCount: burden.major_mismatch_count,
        dataConfidenceScore: burden.data_confidence_score,
        dateRelevanceScore: burden.date_relevance_score,
        locationConfidenceScore: burden.location_confidence_score,
        overallStabilityScore: burden.overall_stability_score,
      } : null,
    };
  }

  log.info('compGrid:get', { caseId, slotCount: Object.keys(slots).length });
  return { caseId, slots };
}

// ── updateGridSlot ───────────────────────────────────────────────────────────

/**
 * Update adjustment values or other data for a specific grid slot.
 */
export function updateGridSlot(caseId, gridSlot, updates) {
  if (!caseId) throw new Error('caseId is required');
  const slot = validateGridSlot(gridSlot);

  if (updates.adjustments && Array.isArray(updates.adjustments)) {
    const now = new Date().toISOString();
    dbTransaction(() => {
      for (const adj of updates.adjustments) {
        if (!adj.adjustment_category) continue;
        dbRun(`
          UPDATE adjustment_support_records
             SET final_amount = ?,
                 rationale_note = COALESCE(?, rationale_note),
                 decision_status = COALESCE(?, decision_status),
                 updated_at = ?
           WHERE case_id = ? AND grid_slot = ? AND adjustment_category = ?
        `, [
          adj.final_amount ?? adj.finalAmount ?? null,
          adj.rationale_note ?? adj.rationaleNote ?? null,
          adj.decision_status ?? adj.decisionStatus ?? null,
          now,
          caseId, slot, adj.adjustment_category,
        ]);
      }
    });
  }

  log.info('compGrid:updateSlot', { caseId, gridSlot: slot });
  return { success: true, caseId, gridSlot: slot };
}

// ── swapGridSlots ────────────────────────────────────────────────────────────

/**
 * Swap two comps in the grid by exchanging their grid_slot values.
 */
export function swapGridSlots(caseId, slotA, slotB) {
  if (!caseId) throw new Error('caseId is required');
  const a = validateGridSlot(slotA);
  const b = validateGridSlot(slotB);

  if (a === b) throw new Error('Cannot swap a slot with itself');

  const now = new Date().toISOString();
  const tempSlot = '__swap_temp__';

  dbTransaction(() => {
    // Move A -> temp
    dbRun(`UPDATE comp_acceptance_events SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [tempSlot, caseId, a]);
    dbRun(`UPDATE adjustment_support_records SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [tempSlot, now, caseId, a]);
    dbRun(`UPDATE comp_burden_metrics SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [tempSlot, caseId, a]);
    dbRun(`UPDATE adjustment_recommendations SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [tempSlot, now, caseId, a]);

    // Move B -> A
    dbRun(`UPDATE comp_acceptance_events SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [a, caseId, b]);
    dbRun(`UPDATE adjustment_support_records SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [a, now, caseId, b]);
    dbRun(`UPDATE comp_burden_metrics SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [a, caseId, b]);
    dbRun(`UPDATE adjustment_recommendations SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [a, now, caseId, b]);

    // Move temp -> B
    dbRun(`UPDATE comp_acceptance_events SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [b, caseId, tempSlot]);
    dbRun(`UPDATE adjustment_support_records SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [b, now, caseId, tempSlot]);
    dbRun(`UPDATE comp_burden_metrics SET grid_slot = ? WHERE case_id = ? AND grid_slot = ?`, [b, caseId, tempSlot]);
    dbRun(`UPDATE adjustment_recommendations SET grid_slot = ?, updated_at = ? WHERE case_id = ? AND grid_slot = ?`, [b, now, caseId, tempSlot]);
  });

  log.info('compGrid:swap', { caseId, slotA: a, slotB: b });
  return { success: true, caseId, slotA: a, slotB: b };
}

// ── removeFromGrid ───────────────────────────────────────────────────────────

/**
 * Remove a comp from a grid slot (nullifies grid_slot on acceptance event).
 */
export function removeFromGrid(caseId, gridSlot) {
  if (!caseId) throw new Error('caseId is required');
  const slot = validateGridSlot(gridSlot);

  dbTransaction(() => {
    dbRun(`UPDATE comp_acceptance_events SET grid_slot = NULL WHERE case_id = ? AND grid_slot = ?`, [caseId, slot]);
    dbRun(`DELETE FROM adjustment_support_records WHERE case_id = ? AND grid_slot = ?`, [caseId, slot]);
    dbRun(`DELETE FROM comp_burden_metrics WHERE case_id = ? AND grid_slot = ?`, [caseId, slot]);
    dbRun(`DELETE FROM adjustment_recommendations WHERE case_id = ? AND grid_slot = ?`, [caseId, slot]);
  });

  log.info('compGrid:remove', { caseId, gridSlot: slot });
  return { success: true, caseId, gridSlot: slot };
}

// ── calculateIndicatedValue ──────────────────────────────────────────────────

/**
 * Calculate indicated value for a grid slot: sale price +/- net adjustment.
 */
export function calculateIndicatedValue(caseId, gridSlot) {
  if (!caseId) throw new Error('caseId is required');
  const slot = validateGridSlot(gridSlot);

  // Get the comp candidate data for sale price
  const acceptance = dbGet(`
    SELECT ae.comp_candidate_id, cc.candidate_json
      FROM comp_acceptance_events ae
      JOIN comp_candidates cc ON cc.id = ae.comp_candidate_id
     WHERE ae.case_id = ? AND ae.grid_slot = ? AND cc.is_active = 1
     ORDER BY ae.accepted_at DESC
     LIMIT 1
  `, [caseId, slot]);

  if (!acceptance) {
    return { gridSlot: slot, salePrice: null, netAdjustment: 0, indicatedValue: null };
  }

  const candidateData = safeParseJSON(acceptance.candidate_json, {});
  const salePrice = candidateData.salePrice ?? candidateData.sale_price ?? null;

  // Sum final_amount from adjustments
  const adjRow = dbGet(`
    SELECT COALESCE(SUM(COALESCE(final_amount, suggested_amount, 0)), 0) AS net
      FROM adjustment_support_records
     WHERE case_id = ? AND grid_slot = ?
  `, [caseId, slot]);

  const netAdjustment = adjRow?.net ?? 0;
  const indicatedValue = salePrice != null ? salePrice + netAdjustment : null;

  return { gridSlot: slot, salePrice, netAdjustment, indicatedValue };
}

// ── getGridSummary ───────────────────────────────────────────────────────────

/**
 * Returns a summary of the grid: total adjustments per comp, indicated values, and range.
 */
export function getGridSummary(caseId) {
  if (!caseId) throw new Error('caseId is required');

  const grid = getCompGrid(caseId);
  const slotSummaries = [];
  const indicatedValues = [];

  for (const slot of VALID_GRID_SLOTS) {
    if (!grid.slots[slot]) continue;
    const iv = calculateIndicatedValue(caseId, slot);
    slotSummaries.push(iv);
    if (iv.indicatedValue != null) {
      indicatedValues.push(iv.indicatedValue);
    }
  }

  const range = indicatedValues.length > 0
    ? { low: Math.min(...indicatedValues), high: Math.max(...indicatedValues) }
    : { low: null, high: null };

  const average = indicatedValues.length > 0
    ? indicatedValues.reduce((a, b) => a + b, 0) / indicatedValues.length
    : null;

  log.info('compGrid:summary', { caseId, compCount: slotSummaries.length });

  return {
    caseId,
    compCount: slotSummaries.length,
    slots: slotSummaries,
    range,
    average,
  };
}

// ── Default export ───────────────────────────────────────────────────────────

export default {
  getCompGrid,
  updateGridSlot,
  swapGridSlots,
  removeFromGrid,
  calculateIndicatedValue,
  getGridSummary,
};
