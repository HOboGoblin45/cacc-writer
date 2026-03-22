/**
 * server/intelligence/adjustmentLearner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Machine learning for adjustment values.
 *
 * As users approve comp adjustments, this module learns the actual
 * per-unit adjustment values for their market. Over time, the suggested
 * adjustments become hyper-local and accurate.
 *
 * This is a MOAT feature — the more reports an appraiser runs,
 * the smarter their adjustments get. Switching costs go up.
 *
 * Tracks:
 *   - $/SF for GLA adjustments by county/city/zip
 *   - $/year for age adjustments
 *   - $ per bedroom, bathroom, garage car
 *   - Custom adjustment categories
 *   - Time-weighted (recent data weighted higher)
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

export function ensureAdjustmentLearnerSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_adjustments (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id         TEXT NOT NULL,
      category        TEXT NOT NULL,
      per_unit_value  REAL NOT NULL,
      county          TEXT,
      city            TEXT,
      zip             TEXT,
      property_type   TEXT,
      case_id         TEXT,
      comp_address    TEXT,
      subject_value   TEXT,
      comp_value      TEXT,
      adjustment_amount REAL,
      confidence      TEXT DEFAULT 'medium',
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_learned_adj_user
      ON learned_adjustments(user_id, category, county);
  `);
}

/**
 * Record an approved adjustment for learning.
 */
export function recordAdjustment(userId, {
  category, perUnitValue, county, city, zip, propertyType,
  caseId, compAddress, subjectValue, compValue, adjustmentAmount
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO learned_adjustments
      (user_id, category, per_unit_value, county, city, zip, property_type,
       case_id, comp_address, subject_value, comp_value, adjustment_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, category, perUnitValue, county || null, city || null, zip || null,
    propertyType || null, caseId || null, compAddress || null,
    subjectValue || null, compValue || null, adjustmentAmount || null);

  log.info('adj-learner:recorded', { userId, category, perUnitValue, county });
}

/**
 * Get learned adjustment values for a user's market.
 * Returns weighted average of approved adjustments, with recent ones weighted higher.
 *
 * @param {string} userId
 * @param {string} category — 'gla', 'age', 'bedrooms', etc.
 * @param {Object} [filters] — { county, city, zip, propertyType }
 * @returns {Object} { value, count, confidence, range }
 */
export function getLearnedAdjustment(userId, category, filters = {}) {
  const db = getDb();

  // Try most specific first (county + city), then county, then all
  const queries = [
    { where: 'user_id = ? AND category = ? AND county = ? AND city = ?', params: [userId, category, filters.county, filters.city] },
    { where: 'user_id = ? AND category = ? AND county = ?', params: [userId, category, filters.county] },
    { where: 'user_id = ? AND category = ?', params: [userId, category] },
  ];

  for (const q of queries) {
    if (q.params.some(p => p === undefined || p === null)) continue;

    const rows = db.prepare(`
      SELECT per_unit_value, created_at,
             julianday('now') - julianday(created_at) as age_days
      FROM learned_adjustments
      WHERE ${q.where}
      ORDER BY created_at DESC
      LIMIT 50
    `).all(...q.params);

    if (rows.length >= 3) {
      // Time-weighted average (more recent = higher weight)
      let weightedSum = 0;
      let totalWeight = 0;

      for (const row of rows) {
        const ageDays = row.age_days || 1;
        const weight = 1 / Math.sqrt(ageDays + 1); // sqrt decay
        weightedSum += row.per_unit_value * weight;
        totalWeight += weight;
      }

      const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;
      const values = rows.map(r => r.per_unit_value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - weightedAvg, 2), 0) / values.length);

      return {
        value: Math.round(weightedAvg * 100) / 100,
        count: rows.length,
        confidence: rows.length >= 10 ? 'high' : rows.length >= 5 ? 'medium' : 'low',
        range: { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 },
        stdDev: Math.round(stdDev * 100) / 100,
        source: q.where.includes('city') ? 'city' : q.where.includes('county') ? 'county' : 'all',
      };
    }
  }

  return null; // Not enough data — fall back to defaults
}

/**
 * Get all learned market factors for a user + location.
 * Returns a complete set of adjustment values to use in comp analysis.
 */
export function getLearnedMarketFactors(userId, { county, city, zip } = {}) {
  const categories = ['gla', 'age', 'bedrooms', 'bathrooms', 'garage', 'basement', 'lot_size'];
  const defaults = {
    gla: 35, age: 1500, bedrooms: 5000, bathrooms: 7500,
    garage: 10000, basement: 25, lot_size: 0.5,
  };

  const factors = {};
  let learnedCount = 0;

  for (const cat of categories) {
    const learned = getLearnedAdjustment(userId, cat, { county, city, zip });
    if (learned) {
      factors[cat + 'Value'] = learned.value;
      factors[cat + '_learned'] = true;
      factors[cat + '_confidence'] = learned.confidence;
      factors[cat + '_count'] = learned.count;
      learnedCount++;
    } else {
      factors[cat + 'Value'] = defaults[cat];
      factors[cat + '_learned'] = false;
    }
  }

  // Map to the names compAnalyzer expects
  return {
    glaSfValue: factors.glaValue,
    ageYearValue: factors.ageValue,
    bedroomValue: factors.bedroomsValue,
    bathroomValue: factors.bathroomsValue,
    garageValue: factors.garageValue,
    basementSfValue: factors.basementValue,
    _learnedCount: learnedCount,
    _totalCategories: categories.length,
    _details: factors,
  };
}

/**
 * Get adjustment learning stats for a user.
 */
export function getAdjustmentStats(userId) {
  const db = getDb();

  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='learned_adjustments'").get();
  if (!tableExists) return { total: 0, byCategory: {}, byCounty: {} };

  const total = db.prepare('SELECT COUNT(*) as c FROM learned_adjustments WHERE user_id = ?').get(userId)?.c || 0;

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count, AVG(per_unit_value) as avg_value,
           MIN(per_unit_value) as min_value, MAX(per_unit_value) as max_value
    FROM learned_adjustments WHERE user_id = ?
    GROUP BY category ORDER BY count DESC
  `).all(userId);

  const byCounty = db.prepare(`
    SELECT county, COUNT(*) as count
    FROM learned_adjustments WHERE user_id = ? AND county IS NOT NULL
    GROUP BY county ORDER BY count DESC LIMIT 10
  `).all(userId);

  return {
    total,
    byCategory: Object.fromEntries(byCategory.map(r => [r.category, {
      count: r.count,
      avgValue: Math.round(r.avg_value * 100) / 100,
      range: { min: r.min_value, max: r.max_value },
    }])),
    byCounty: Object.fromEntries(byCounty.map(r => [r.county, r.count])),
  };
}

export default {
  ensureAdjustmentLearnerSchema, recordAdjustment, getLearnedAdjustment,
  getLearnedMarketFactors, getAdjustmentStats,
};
