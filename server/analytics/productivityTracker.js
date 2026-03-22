/**
 * server/analytics/productivityTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business analytics engine.
 *
 * Tracks everything an appraiser cares about:
 *   - Revenue (fees earned per month/quarter/year)
 *   - Turnaround time (order received → report delivered)
 *   - Volume (reports completed per period)
 *   - AI time savings (estimated hours saved)
 *   - Pipeline efficiency (which stages take longest)
 *   - Revision rate (% of reports requiring revisions)
 *   - Client/AMC breakdown
 *
 * This is the "business intelligence" layer that turns data
 * into decisions: which AMCs pay best, where to focus, etc.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

/**
 * Get comprehensive productivity stats for a user.
 *
 * @param {string} userId
 * @param {Object} [filters]
 * @param {string} [filters.period] — 'week' | 'month' | 'quarter' | 'year' | 'all'
 * @param {string} [filters.formType]
 * @returns {Object} analytics
 */
export function getProductivityStats(userId, filters = {}) {
  const db = getDb();
  const period = filters.period || 'month';

  const dateFilter = getDateFilter(period);

  // ── Report volume ──────────────────────────────────────────────────────
  let totalReports = 0;
  let completedReports = 0;
  let avgTurnaroundHours = null;

  try {
    const reports = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN case_status IN ('complete','exported','delivered') THEN 1 ELSE 0 END) as completed,
             AVG(CASE WHEN case_status IN ('complete','exported','delivered')
               THEN (julianday(updated_at) - julianday(created_at)) * 24
               ELSE NULL END) as avg_turnaround_hours
      FROM case_records
      WHERE created_at >= ?
    `).get(dateFilter);

    totalReports = reports?.total || 0;
    completedReports = reports?.completed || 0;
    avgTurnaroundHours = reports?.avg_turnaround_hours ? Math.round(reports.avg_turnaround_hours * 10) / 10 : null;
  } catch { /* ok */ }

  // ── Revenue tracking ───────────────────────────────────────────────────
  let totalRevenue = 0;
  let avgFee = 0;

  try {
    const revenue = db.prepare(`
      SELECT SUM(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as total_revenue,
             AVG(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as avg_fee
      FROM case_facts f
      JOIN case_records r ON r.case_id = f.case_id
      WHERE r.created_at >= ?
        AND json_extract(f.facts_json, '$.order.fee') IS NOT NULL
        AND CAST(json_extract(f.facts_json, '$.order.fee') AS REAL) > 0
    `).get(dateFilter);

    totalRevenue = Math.round(revenue?.total_revenue || 0);
    avgFee = Math.round(revenue?.avg_fee || 0);
  } catch { /* ok */ }

  // ── AI generation stats ────────────────────────────────────────────────
  let sectionsGenerated = 0;
  let estimatedHoursSaved = 0;

  try {
    const genStats = db.prepare(`
      SELECT COUNT(*) as sections
      FROM generated_sections
      WHERE created_at >= ?
    `).get(dateFilter);

    sectionsGenerated = genStats?.sections || 0;
    // Conservative estimate: 12 minutes saved per AI-generated section
    estimatedHoursSaved = Math.round((sectionsGenerated * 12 / 60) * 10) / 10;
  } catch { /* ok */ }

  // ── Form type breakdown ────────────────────────────────────────────────
  let byFormType = {};
  try {
    const formBreakdown = db.prepare(`
      SELECT form_type, COUNT(*) as count
      FROM case_records
      WHERE created_at >= ?
      GROUP BY form_type ORDER BY count DESC
    `).all(dateFilter);
    byFormType = Object.fromEntries(formBreakdown.map(r => [r.form_type, r.count]));
  } catch { /* ok */ }

  // ── Revision rate ──────────────────────────────────────────────────────
  let revisionRate = 0;
  let totalRevisions = 0;

  try {
    const revStats = db.prepare(`
      SELECT COUNT(DISTINCT case_id) as cases_with_revisions
      FROM revision_requests
      WHERE created_at >= ?
    `).get(dateFilter);

    totalRevisions = revStats?.cases_with_revisions || 0;
    revisionRate = completedReports > 0 ? Math.round((totalRevisions / completedReports) * 100) : 0;
  } catch { /* ok */ }

  // ── Export stats ───────────────────────────────────────────────────────
  let exports = { total: 0, byFormat: {} };
  try {
    const expStats = db.prepare(`
      SELECT output_format, COUNT(*) as count
      FROM export_jobs
      WHERE created_at >= ? AND export_status = 'completed'
      GROUP BY output_format
    `).all(dateFilter);

    exports.total = expStats.reduce((sum, r) => sum + r.count, 0);
    exports.byFormat = Object.fromEntries(expStats.map(r => [r.output_format, r.count]));
  } catch { /* ok */ }

  // ── AMC breakdown ──────────────────────────────────────────────────────
  let amcStats = [];
  try {
    amcStats = db.prepare(`
      SELECT json_extract(f.facts_json, '$.amc.name') as amc_name,
             json_extract(f.facts_json, '$.lender.name') as lender_name,
             COUNT(*) as count,
             AVG(CAST(json_extract(f.facts_json, '$.order.fee') AS REAL)) as avg_fee
      FROM case_facts f
      JOIN case_records r ON r.case_id = f.case_id
      WHERE r.created_at >= ?
      GROUP BY COALESCE(json_extract(f.facts_json, '$.amc.name'), json_extract(f.facts_json, '$.lender.name'))
      HAVING amc_name IS NOT NULL OR lender_name IS NOT NULL
      ORDER BY count DESC LIMIT 10
    `).all(dateFilter).map(r => ({
      name: r.amc_name || r.lender_name || 'Unknown',
      orders: r.count,
      avgFee: Math.round(r.avg_fee || 0),
    }));
  } catch { /* ok */ }

  // ── Daily volume (for charts) ──────────────────────────────────────────
  let dailyVolume = [];
  try {
    dailyVolume = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM case_records
      WHERE created_at >= ?
      GROUP BY date(created_at)
      ORDER BY day
    `).all(dateFilter);
  } catch { /* ok */ }

  return {
    period,
    dateRange: { from: dateFilter, to: new Date().toISOString() },
    volume: {
      totalReports,
      completedReports,
      inProgress: totalReports - completedReports,
      avgTurnaroundHours,
    },
    revenue: {
      total: totalRevenue,
      avgFee,
      projected: period === 'month' ? totalRevenue * 12 : null,
    },
    ai: {
      sectionsGenerated,
      estimatedHoursSaved,
      estimatedValueSaved: Math.round(estimatedHoursSaved * 75), // $75/hr appraiser time
    },
    quality: {
      revisionRate: revisionRate + '%',
      totalRevisions,
    },
    byFormType,
    exports,
    amcBreakdown: amcStats,
    dailyVolume,
  };
}

/**
 * Get financial projections based on current pace.
 */
export function getProjections(userId) {
  const monthStats = getProductivityStats(userId, { period: 'month' });
  const quarterStats = getProductivityStats(userId, { period: 'quarter' });

  const monthlyPace = monthStats.volume.completedReports;
  const monthlyRevenue = monthStats.revenue.total;

  return {
    monthly: {
      reports: monthlyPace,
      revenue: monthlyRevenue,
    },
    quarterly: {
      reports: quarterStats.volume.completedReports,
      revenue: quarterStats.revenue.total,
    },
    annualized: {
      reports: monthlyPace * 12,
      revenue: monthlyRevenue * 12,
      hoursSaved: monthStats.ai.estimatedHoursSaved * 12,
      valueSaved: monthStats.ai.estimatedValueSaved * 12,
    },
    efficiency: {
      reportsPerWeek: Math.round((monthlyPace / 4.33) * 10) / 10,
      avgFee: monthStats.revenue.avgFee,
      effectiveHourlyRate: monthStats.volume.avgTurnaroundHours && monthStats.revenue.avgFee
        ? Math.round(monthStats.revenue.avgFee / (monthStats.volume.avgTurnaroundHours || 1))
        : null,
    },
  };
}

function getDateFilter(period) {
  const now = new Date();
  switch (period) {
    case 'week': return new Date(now - 7 * 86400000).toISOString();
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case 'quarter': return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString();
    case 'year': return new Date(now.getFullYear(), 0, 1).toISOString();
    case 'all': return '2000-01-01T00:00:00.000Z';
    default: return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
}

export default { getProductivityStats, getProjections };
