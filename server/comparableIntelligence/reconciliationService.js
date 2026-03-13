/**
 * server/comparableIntelligence/reconciliationService.js
 * -------------------------------------------------------
 * Reconciliation Service — manages the three approach values,
 * weighting, narrative, and final opinion of value.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from '../db/database.js';
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

function ensureRecord(caseId) {
  const existing = dbGet(`SELECT id FROM reconciliation_data WHERE case_id = ?`, [caseId]);
  if (!existing) {
    dbRun(`
      INSERT INTO reconciliation_data (id, case_id)
      VALUES (?, ?)
    `, [uuidv4(), caseId]);
  }
}

// ── getReconciliation ────────────────────────────────────────────────────────

/**
 * Get the full reconciliation workspace data.
 */
export function getReconciliation(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT * FROM reconciliation_data WHERE case_id = ?`, [caseId]);

  return {
    id: row.id,
    caseId: row.case_id,
    salesComparisonValue: row.sales_comparison_value,
    salesComparisonWeight: row.sales_comparison_weight,
    incomeValue: row.income_value,
    incomeWeight: row.income_weight,
    costValue: row.cost_value,
    costWeight: row.cost_weight,
    finalOpinionValue: row.final_opinion_value,
    reconciliationNarrative: row.reconciliation_narrative,
    approachApplicability: safeParseJSON(row.approach_applicability_json, {}),
    supportingData: safeParseJSON(row.supporting_data_json, {}),
    asIsValue: row.as_is_value,
    asCompletedValue: row.as_completed_value,
    effectiveDate: row.effective_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── saveApproachValues ───────────────────────────────────────────────────────

/**
 * Save the three approach values.
 */
export function saveApproachValues(caseId, { salesComparison, income, cost }) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const now = new Date().toISOString();
  dbRun(`
    UPDATE reconciliation_data
       SET sales_comparison_value = ?,
           income_value = ?,
           cost_value = ?,
           updated_at = ?
     WHERE case_id = ?
  `, [salesComparison ?? null, income ?? null, cost ?? null, now, caseId]);

  log.info('reconciliation:saveValues', { caseId, salesComparison, income, cost });
  return { success: true, caseId };
}

// ── saveWeights ──────────────────────────────────────────────────────────────

/**
 * Save reconciliation weights. Must sum to 1.0 or less.
 */
export function saveWeights(caseId, { salesWeight, incomeWeight, costWeight }) {
  if (!caseId) throw new Error('caseId is required');

  const sw = salesWeight ?? 0;
  const iw = incomeWeight ?? 0;
  const cw = costWeight ?? 0;
  const total = sw + iw + cw;

  // Allow small floating-point tolerance
  if (total > 1.001) {
    throw new Error(`Weights must sum to 1.0 or less. Current sum: ${total.toFixed(4)}`);
  }

  ensureRecord(caseId);

  const now = new Date().toISOString();
  dbRun(`
    UPDATE reconciliation_data
       SET sales_comparison_weight = ?,
           income_weight = ?,
           cost_weight = ?,
           updated_at = ?
     WHERE case_id = ?
  `, [sw, iw, cw, now, caseId]);

  log.info('reconciliation:saveWeights', { caseId, salesWeight: sw, incomeWeight: iw, costWeight: cw });
  return { success: true, caseId, totalWeight: total };
}

// ── calculateFinalValue ──────────────────────────────────────────────────────

/**
 * Calculate weighted average of the three approaches.
 */
export function calculateFinalValue(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`
    SELECT sales_comparison_value, sales_comparison_weight,
           income_value, income_weight,
           cost_value, cost_weight
      FROM reconciliation_data
     WHERE case_id = ?
  `, [caseId]);

  const sv = row?.sales_comparison_value ?? 0;
  const sw = row?.sales_comparison_weight ?? 0;
  const iv = row?.income_value ?? 0;
  const iw = row?.income_weight ?? 0;
  const cv = row?.cost_value ?? 0;
  const cw = row?.cost_weight ?? 0;

  const totalWeight = sw + iw + cw;
  let finalValue = null;

  if (totalWeight > 0) {
    finalValue = Math.round((sv * sw) + (iv * iw) + (cv * cw));
  }

  const now = new Date().toISOString();
  dbRun(`
    UPDATE reconciliation_data
       SET final_opinion_value = ?, as_is_value = ?, updated_at = ?
     WHERE case_id = ?
  `, [finalValue, finalValue, now, caseId]);

  log.info('reconciliation:calculateFinal', { caseId, finalValue, totalWeight });
  return {
    caseId,
    salesContribution: sv * sw,
    incomeContribution: iv * iw,
    costContribution: cv * cw,
    totalWeight,
    finalOpinionValue: finalValue,
  };
}

// ── saveReconciliationNarrative ──────────────────────────────────────────────

/**
 * Save the reconciliation narrative text.
 */
export function saveReconciliationNarrative(caseId, narrative) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const now = new Date().toISOString();
  dbRun(`
    UPDATE reconciliation_data
       SET reconciliation_narrative = ?, updated_at = ?
     WHERE case_id = ?
  `, [narrative ?? '', now, caseId]);

  log.info('reconciliation:saveNarrative', { caseId, length: (narrative ?? '').length });
  return { success: true, caseId };
}

// ── getReconciliationSummary ─────────────────────────────────────────────────

/**
 * Full summary with weighted contributions.
 */
export function getReconciliationSummary(caseId) {
  if (!caseId) throw new Error('caseId is required');
  const data = getReconciliation(caseId);

  const sv = data.salesComparisonValue ?? 0;
  const sw = data.salesComparisonWeight ?? 0;
  const iv = data.incomeValue ?? 0;
  const iw = data.incomeWeight ?? 0;
  const cv = data.costValue ?? 0;
  const cw = data.costWeight ?? 0;

  return {
    caseId,
    approaches: {
      salesComparison: { value: data.salesComparisonValue, weight: sw, contribution: sv * sw },
      income: { value: data.incomeValue, weight: iw, contribution: iv * iw },
      cost: { value: data.costValue, weight: cw, contribution: cv * cw },
    },
    totalWeight: sw + iw + cw,
    finalOpinionValue: data.finalOpinionValue,
    reconciliationNarrative: data.reconciliationNarrative,
    asIsValue: data.asIsValue,
    asCompletedValue: data.asCompletedValue,
    effectiveDate: data.effectiveDate,
  };
}

// ── Default export ───────────────────────────────────────────────────────────

export default {
  getReconciliation,
  saveApproachValues,
  saveWeights,
  calculateFinalValue,
  saveReconciliationNarrative,
  getReconciliationSummary,
};
