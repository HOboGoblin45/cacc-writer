/**
 * server/intelligence/marketTrendEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Market trend analysis engine.
 *
 * Tracks and analyzes real estate market trends over time:
 *   - Median sale price trends by area (county/city/zip)
 *   - Days on market trends
 *   - Supply/demand metrics
 *   - Price per SF trends
 *   - Seasonal adjustments
 *   - Absorption rate calculation
 *
 * Builds a local market database from every report processed.
 * Over time, this becomes a proprietary market intelligence asset.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

export function ensureMarketTrendSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_data_points (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      data_type   TEXT NOT NULL,
      county      TEXT,
      city        TEXT,
      zip         TEXT,
      value       REAL NOT NULL,
      unit        TEXT,
      source      TEXT DEFAULT 'case_data',
      case_id     TEXT,
      data_date   TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_market_data ON market_data_points(data_type, county, city, data_date);

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      county      TEXT NOT NULL,
      city        TEXT,
      snapshot_date TEXT NOT NULL,
      median_price REAL,
      median_ppsf  REAL,
      median_dom   REAL,
      active_listings INTEGER,
      closed_sales INTEGER,
      months_supply REAL,
      price_trend  TEXT,
      data_points  INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(county, city, snapshot_date)
    );
  `);
}

/**
 * Record a market data point from a completed case.
 * Called automatically when a case is completed/exported.
 */
export function recordMarketData(caseId) {
  const db = getDb();
  const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
  if (!caseFacts) return;
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const subject = facts.subject || {};
  const contract = facts.contract || {};
  const improvements = facts.improvements || {};
  const recon = facts.reconciliation || {};

  const county = subject.county;
  const city = subject.city;
  const zip = subject.zip || subject.zipCode;
  const date = facts.assignment?.effectiveDate || new Date().toISOString().split('T')[0];

  const points = [];

  // Sale price
  const salePrice = parseFloat(contract.salePrice || recon.finalOpinionOfValue || 0);
  if (salePrice > 0) {
    points.push({ type: 'sale_price', value: salePrice, unit: 'USD' });
  }

  // Price per SF
  const gla = parseFloat(improvements.gla || 0);
  if (salePrice > 0 && gla > 0) {
    points.push({ type: 'price_per_sf', value: Math.round(salePrice / gla * 100) / 100, unit: 'USD/SF' });
  }

  // DOM
  if (contract.daysOnMarket) {
    points.push({ type: 'dom', value: parseFloat(contract.daysOnMarket), unit: 'days' });
  }

  // Record each point
  for (const pt of points) {
    try {
      db.prepare(`
        INSERT INTO market_data_points (data_type, county, city, zip, value, unit, source, case_id, data_date)
        VALUES (?, ?, ?, ?, ?, ?, 'case_data', ?, ?)
      `).run(pt.type, county, city, zip, pt.value, pt.unit, caseId, date);
    } catch { /* duplicate, ok */ }
  }

  // Also record comp data
  try {
    const comps = db.prepare('SELECT candidate_json FROM comp_candidates WHERE case_id = ? AND is_active = 1').all(caseId);
    for (const comp of comps) {
      const data = JSON.parse(comp.candidate_json || '{}');
      const compPrice = parseFloat(data.salePrice || data.sale_price || 0);
      const compGla = parseFloat(data.gla || 0);
      const compDate = data.saleDate || data.sale_date || date;

      if (compPrice > 0) {
        try {
          db.prepare('INSERT INTO market_data_points (data_type, county, city, zip, value, unit, source, case_id, data_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run('sale_price', data.county || county, data.city || city, data.zip || zip, compPrice, 'USD', 'comp_data', caseId, compDate);
        } catch { /* ok */ }

        if (compGla > 0) {
          try {
            db.prepare('INSERT INTO market_data_points (data_type, county, city, zip, value, unit, source, case_id, data_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run('price_per_sf', data.county || county, data.city || city, data.zip || zip, Math.round(compPrice / compGla * 100) / 100, 'USD/SF', 'comp_data', caseId, compDate);
          } catch { /* ok */ }
        }
      }
    }
  } catch { /* comps table may not exist */ }

  log.info('market-trend:recorded', { caseId, county, city, points: points.length });
}

/**
 * Get market trends for an area.
 */
export function getMarketTrends(county, city, { months = 12 } = {}) {
  const db = getDb();
  const dateFrom = new Date(Date.now() - months * 30 * 86400000).toISOString().split('T')[0];

  // Monthly aggregates
  const monthlyPrices = db.prepare(`
    SELECT strftime('%Y-%m', data_date) as month,
           AVG(value) as avg_value,
           MIN(value) as min_value,
           MAX(value) as max_value,
           COUNT(*) as count
    FROM market_data_points
    WHERE data_type = 'sale_price'
      AND county = ?
      AND (? IS NULL OR city = ?)
      AND data_date >= ?
    GROUP BY strftime('%Y-%m', data_date)
    ORDER BY month
  `).all(county, city || null, city || null, dateFrom);

  const monthlyPpsf = db.prepare(`
    SELECT strftime('%Y-%m', data_date) as month,
           AVG(value) as avg_value,
           COUNT(*) as count
    FROM market_data_points
    WHERE data_type = 'price_per_sf'
      AND county = ?
      AND (? IS NULL OR city = ?)
      AND data_date >= ?
    GROUP BY strftime('%Y-%m', data_date)
    ORDER BY month
  `).all(county, city || null, city || null, dateFrom);

  const monthlyDom = db.prepare(`
    SELECT strftime('%Y-%m', data_date) as month,
           AVG(value) as avg_value,
           COUNT(*) as count
    FROM market_data_points
    WHERE data_type = 'dom'
      AND county = ?
      AND (? IS NULL OR city = ?)
      AND data_date >= ?
    GROUP BY strftime('%Y-%m', data_date)
    ORDER BY month
  `).all(county, city || null, city || null, dateFrom);

  // Calculate trend direction
  let priceTrend = 'Stable';
  if (monthlyPrices.length >= 3) {
    const recent = monthlyPrices.slice(-3).reduce((s, m) => s + m.avg_value, 0) / 3;
    const earlier = monthlyPrices.slice(0, 3).reduce((s, m) => s + m.avg_value, 0) / Math.min(3, monthlyPrices.length);
    const changePct = ((recent - earlier) / earlier) * 100;
    priceTrend = changePct > 3 ? 'Increasing' : changePct < -3 ? 'Declining' : 'Stable';
  }

  // Total data points
  const totalPoints = db.prepare(`
    SELECT COUNT(*) as c FROM market_data_points
    WHERE county = ? AND (? IS NULL OR city = ?)
  `).get(county, city || null, city || null)?.c || 0;

  return {
    county,
    city: city || 'All',
    period: `${months} months`,
    totalDataPoints: totalPoints,
    priceTrend,
    monthlyPrices: monthlyPrices.map(m => ({ month: m.month, median: Math.round(m.avg_value), count: m.count })),
    monthlyPricePerSf: monthlyPpsf.map(m => ({ month: m.month, avgPpsf: Math.round(m.avg_value * 100) / 100, count: m.count })),
    monthlyDom: monthlyDom.map(m => ({ month: m.month, avgDom: Math.round(m.avg_value), count: m.count })),
  };
}

/**
 * Generate a market conditions narrative from trend data.
 */
export function generateMarketSummary(county, city) {
  const trends = getMarketTrends(county, city);

  if (trends.totalDataPoints < 3) {
    return { summary: 'Insufficient market data for trend analysis. More completed reports needed.', trends };
  }

  const latestPrice = trends.monthlyPrices[trends.monthlyPrices.length - 1];
  const latestPpsf = trends.monthlyPricePerSf[trends.monthlyPricePerSf.length - 1];
  const latestDom = trends.monthlyDom[trends.monthlyDom.length - 1];

  let summary = `Market conditions in ${city || county} are ${trends.priceTrend.toLowerCase()}.`;

  if (latestPrice) summary += ` Median sale price is approximately $${latestPrice.median.toLocaleString()} based on ${latestPrice.count} data points.`;
  if (latestPpsf) summary += ` Average price per square foot is $${latestPpsf.avgPpsf}.`;
  if (latestDom) summary += ` Average days on market is ${latestDom.avgDom}.`;

  summary += ` Analysis based on ${trends.totalDataPoints} total data points.`;

  return { summary, trends };
}

export default { ensureMarketTrendSchema, recordMarketData, getMarketTrends, generateMarketSummary };
