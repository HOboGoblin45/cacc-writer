/**
 * server/migration/phase17Schema.js
 * -----------------------------------
 * Phase 17 — Valuation workspace tables.
 * Income approach, cost approach, and reconciliation data persistence.
 */
import log from '../logger.js';

export function initPhase17Schema(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS income_approach_data (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL UNIQUE,
        rent_comps_json TEXT NOT NULL DEFAULT '[]',
        monthly_market_rent REAL,
        grm REAL,
        expenses_json TEXT NOT NULL DEFAULT '{}',
        gross_income REAL,
        net_income REAL,
        indicated_value REAL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cost_approach_data (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL UNIQUE,
        land_value REAL,
        land_value_source TEXT,
        replacement_cost_new REAL,
        cost_method TEXT DEFAULT 'cost_manual',
        cost_per_sqft REAL,
        gla_sqft REAL,
        extras_json TEXT NOT NULL DEFAULT '[]',
        physical_depreciation REAL DEFAULT 0,
        functional_depreciation REAL DEFAULT 0,
        external_depreciation REAL DEFAULT 0,
        total_depreciation REAL DEFAULT 0,
        depreciated_value REAL,
        site_improvements REAL DEFAULT 0,
        indicated_value REAL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reconciliation_data (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL UNIQUE,
        sales_comparison_value REAL,
        sales_comparison_weight REAL DEFAULT 0,
        income_value REAL,
        income_weight REAL DEFAULT 0,
        cost_value REAL,
        cost_weight REAL DEFAULT 0,
        final_opinion_value REAL,
        reconciliation_narrative TEXT,
        approach_applicability_json TEXT NOT NULL DEFAULT '{}',
        supporting_data_json TEXT NOT NULL DEFAULT '{}',
        as_is_value REAL,
        as_completed_value REAL,
        effective_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      log.error('schema:phase17-init', { error: err.message });
    }
  }
}
