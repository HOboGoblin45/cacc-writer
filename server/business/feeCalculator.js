/**
 * server/business/feeCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smart fee calculator and profitability analyzer.
 *
 * Helps appraisers price their services correctly:
 *   - Suggests fees based on property complexity, form type, and area
 *   - Tracks actual time spent per report type
 *   - Calculates effective hourly rate
 *   - Identifies most/least profitable AMCs and property types
 *   - Benchmarks against market rates
 *   - Flags underpriced orders
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

// Base fee schedule by form type (typical market rates 2026)
const BASE_FEES = {
  '1004': { base: 400, complex: 550, rush: 150, desktop: 275 },
  '1025': { base: 500, complex: 700, rush: 175, desktop: 325 },
  '1073': { base: 375, complex: 500, rush: 150, desktop: 250 },
  'commercial': { base: 1500, complex: 3000, rush: 500, desktop: 800 },
  '1004c': { base: 375, complex: 500, rush: 125, desktop: 250 },
};

// Complexity factors
const COMPLEXITY_FACTORS = {
  high_value: 1.25,        // >$750K
  acreage: 1.20,           // >5 acres
  multi_building: 1.30,    // Multiple structures
  historical: 1.15,        // Historic property
  litigation: 1.50,        // Legal/divorce/estate
  fha: 1.10,               // FHA requirements
  rural: 1.15,             // Rural area
  waterfront: 1.20,        // Waterfront/lakefront
};

/**
 * Calculate suggested fee for a case.
 */
export function calculateSuggestedFee(caseId) {
  const db = getDb();
  const caseRecord = db.prepare('SELECT * FROM case_records WHERE case_id = ?').get(caseId);
  if (!caseRecord) throw new Error('Case not found');

  const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  const formType = caseRecord.form_type || '1004';
  const baseFeeSchedule = BASE_FEES[formType] || BASE_FEES['1004'];
  let baseFee = baseFeeSchedule.base;

  const factors = [];
  let multiplier = 1.0;

  // Check complexity factors
  const salePrice = parseFloat(facts.contract?.salePrice || 0);
  if (salePrice > 750000) {
    multiplier *= COMPLEXITY_FACTORS.high_value;
    factors.push({ factor: 'High value (>$750K)', multiplier: COMPLEXITY_FACTORS.high_value });
  }

  const lotSize = parseFloat(facts.site?.lotSize || facts.site?.area || 0);
  const lotAcres = lotSize > 0 ? lotSize / 43560 : parseFloat(facts.site?.lotAcres || 0);
  if (lotAcres > 5) {
    multiplier *= COMPLEXITY_FACTORS.acreage;
    factors.push({ factor: 'Large acreage (>5 acres)', multiplier: COMPLEXITY_FACTORS.acreage });
  }

  const loanType = (facts.assignment?.loanType || '').toLowerCase();
  if (loanType.includes('fha')) {
    multiplier *= COMPLEXITY_FACTORS.fha;
    factors.push({ factor: 'FHA assignment', multiplier: COMPLEXITY_FACTORS.fha });
  }

  const purpose = (facts.assignment?.purpose || '').toLowerCase();
  if (purpose.includes('litigation') || purpose.includes('divorce') || purpose.includes('estate')) {
    multiplier *= COMPLEXITY_FACTORS.litigation;
    factors.push({ factor: 'Litigation/legal purpose', multiplier: COMPLEXITY_FACTORS.litigation });
  }

  // Check if rush
  const dueDate = facts.order?.dueDate;
  let isRush = false;
  if (dueDate) {
    const daysUntilDue = (new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24);
    if (daysUntilDue < 3) {
      isRush = true;
      baseFee += baseFeeSchedule.rush;
      factors.push({ factor: 'Rush order (<3 days)', additional: baseFeeSchedule.rush });
    }
  }

  const suggestedFee = Math.round(baseFee * multiplier);

  // Compare to AMC's offered fee
  const offeredFee = parseFloat(facts.order?.fee || 0);
  let feeAnalysis = null;
  if (offeredFee > 0) {
    const diff = offeredFee - suggestedFee;
    const pctDiff = ((diff / suggestedFee) * 100).toFixed(1);
    feeAnalysis = {
      offeredFee,
      suggestedFee,
      difference: diff,
      percentDifference: pctDiff + '%',
      assessment: diff >= 0 ? 'Fair or above market' : Math.abs(diff) < 50 ? 'Slightly below market' : 'Significantly below market — consider negotiating',
    };
  }

  return {
    formType,
    baseFee: baseFeeSchedule.base,
    complexityMultiplier: Math.round(multiplier * 100) / 100,
    complexityFactors: factors,
    rushSurcharge: isRush ? baseFeeSchedule.rush : 0,
    suggestedFee,
    feeAnalysis,
    marketRange: {
      low: Math.round(baseFeeSchedule.base * 0.85),
      typical: baseFeeSchedule.base,
      high: Math.round(baseFeeSchedule.complex * 1.1),
    },
  };
}

/**
 * Get profitability analysis across all cases.
 */
export function getProfitabilityAnalysis(userId, period = 'month') {
  const db = getDb();
  const dateFrom = getDateFilter(period);

  // By form type
  let byFormType = [];
  try {
    byFormType = db.prepare(`
      SELECT r.form_type,
             COUNT(*) as count,
             AVG(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as avg_fee,
             SUM(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as total_revenue,
             AVG((julianday(r.updated_at) - julianday(r.created_at)) * 24) as avg_hours
      FROM case_records r
      JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.created_at >= ?
        AND r.status IN ('complete', 'exported', 'delivered')
        AND CAST(json_extract(f.facts_json, '$.order.fee') AS REAL) > 0
      GROUP BY r.form_type
      ORDER BY avg_fee DESC
    `).all(dateFrom);
  } catch { /* ok */ }

  // By AMC/client
  let byClient = [];
  try {
    byClient = db.prepare(`
      SELECT COALESCE(json_extract(f.facts_json, '$.amc.name'), json_extract(f.facts_json, '$.lender.name'), 'Direct') as client,
             COUNT(*) as count,
             AVG(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as avg_fee,
             SUM(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as total_revenue
      FROM case_records r
      JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.created_at >= ?
        AND CAST(json_extract(f.facts_json, '$.order.fee') AS REAL) > 0
      GROUP BY client
      HAVING client IS NOT NULL
      ORDER BY avg_fee DESC
    `).all(dateFrom);
  } catch { /* ok */ }

  // Effective hourly rate
  let effectiveRate = null;
  try {
    const totals = db.prepare(`
      SELECT SUM(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as revenue,
             SUM((julianday(r.updated_at) - julianday(r.created_at)) * 24) as hours
      FROM case_records r
      JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.created_at >= ?
        AND r.status IN ('complete', 'exported', 'delivered')
        AND CAST(json_extract(f.facts_json, '$.order.fee') AS REAL) > 0
    `).get(dateFrom);

    if (totals?.revenue && totals?.hours) {
      effectiveRate = Math.round(totals.revenue / totals.hours);
    }
  } catch { /* ok */ }

  return {
    period,
    byFormType: byFormType.map(r => ({
      formType: r.form_type,
      count: r.count,
      avgFee: Math.round(r.avg_fee),
      totalRevenue: Math.round(r.total_revenue),
      avgHours: r.avg_hours ? Math.round(r.avg_hours * 10) / 10 : null,
      effectiveRate: r.avg_hours > 0 ? Math.round(r.avg_fee / r.avg_hours) : null,
    })),
    byClient: byClient.map(r => ({
      client: r.client,
      count: r.count,
      avgFee: Math.round(r.avg_fee),
      totalRevenue: Math.round(r.total_revenue),
    })),
    effectiveHourlyRate: effectiveRate,
  };
}

function getDateFilter(period) {
  const now = new Date();
  switch (period) {
    case 'week': return new Date(now - 7 * 86400000).toISOString();
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case 'quarter': return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString();
    case 'year': return new Date(now.getFullYear(), 0, 1).toISOString();
    default: return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
}

export default { calculateSuggestedFee, getProfitabilityAnalysis, BASE_FEES };
