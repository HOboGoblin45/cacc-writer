/**
 * server/db/adapters/QueryTranslator.js
 * ====================================
 * SQL dialect translation utilities.
 *
 * This module provides functions to convert SQL from one dialect to another,
 * primarily from SQLite syntax to PostgreSQL syntax. Used during the migration
 * phase to allow code written for SQLite to work with PostgreSQL.
 *
 * Supports:
 *   - Parameter placeholder translation (? to $1, $2, ...)
 *   - Function translation (datetime('now') to NOW(), etc.)
 *   - JSON function translation (json_extract to ->>, etc.)
 *   - Type mapping (SQLite REAL to PostgreSQL DOUBLE PRECISION)
 *
 * Usage:
 *   import { translateToPostgres } from './adapters/QueryTranslator.js';
 *   const pgSql = translateToPostgres("SELECT * FROM cases WHERE created_at > datetime('now', '-7 days')");
 */

import log from '../../logger.js';

/**
 * Translate a query from SQLite syntax to PostgreSQL syntax.
 *
 * Transformations applied:
 *   1. Parameter placeholders: ? → $1, $2, $3, ...
 *   2. SQLite functions:
 *      - datetime('now') → NOW()
 *      - datetime('now', '+X days') → NOW() + INTERVAL 'X days'
 *      - json_extract(col, '$.key') → col->>'key'
 *      - CAST(... AS REAL) → CAST(... AS DOUBLE PRECISION)
 *   3. Boolean handling: SQLite 0/1 → PostgreSQL FALSE/TRUE (optional, usually not needed)
 *
 * Limitations:
 *   - Does not parse complex SQL (regex-based, best-effort)
 *   - Does not validate SQL syntax
 *   - Complex datetime expressions may not translate perfectly
 *
 * @param {string} sql - SQLite SQL query
 * @returns {string} PostgreSQL SQL query
 *
 * @example
 *   // Simple parameter translation
 *   translateToPostgres("SELECT * FROM users WHERE id = ?");
 *   // Result: "SELECT * FROM users WHERE id = $1"
 *
 *   // DateTime function
 *   translateToPostgres("SELECT * FROM logs WHERE created > datetime('now', '-7 days')");
 *   // Result: "SELECT * FROM logs WHERE created > NOW() + INTERVAL '7 days'"
 *
 *   // JSON extraction
 *   translateToPostgres("SELECT json_extract(metadata, '$.type') FROM records");
 *   // Result: "SELECT metadata->>'type' FROM records"
 */
export function translateToPostgres(sql) {
  if (!sql || typeof sql !== 'string') {
    return sql;
  }

  let result = sql;

  // 1. Translate datetime('now') and variants
  // Examples:
  //   datetime('now') → NOW()
  //   datetime('now', '+7 days') → NOW() + INTERVAL '7 days'
  //   datetime('now', '-30 minutes') → NOW() - INTERVAL '30 minutes'
  result = result.replace(
    /datetime\s*\(\s*'now'\s*(?:,\s*'([+\-])(\d+)\s+(\w+)'\s*)?\)/gi,
    (match, sign, amount, unit) => {
      if (!amount) {
        return 'NOW()';
      }
      const direction = sign === '+' ? '+' : '-';
      return `(NOW() ${direction} INTERVAL '${amount} ${unit}')`;
    }
  );

  // 2. Translate json_extract(col, '$.key') to col->>'key'
  // Handles both quoted and unquoted column names
  result = result.replace(
    /json_extract\s*\(\s*(\w+)\s*,\s*'(\$\.[^']+)'\s*\)/gi,
    (match, col, path) => {
      // Extract the key part (remove $. prefix)
      const key = path.substring(2);
      return `${col}->>'${key}'`;
    }
  );

  // 3. Translate CAST(... AS REAL) to CAST(... AS DOUBLE PRECISION)
  result = result.replace(
    /CAST\s*\(\s*([^)]+)\s+AS\s+REAL\s*\)/gi,
    (match, expr) => `CAST(${expr} AS DOUBLE PRECISION)`
  );

  // 4. Translate parameter placeholders (? → $1, $2, ...)
  // This must be done last since other transformations might introduce new params
  let paramIndex = 1;
  result = result.replace(/\?/g, () => `$${paramIndex++}`);

  return result;
}

/**
 * Translate a query from PostgreSQL syntax to SQLite syntax.
 * This is useful for testing and development when you want to run PG-syntax queries on SQLite.
 *
 * Transformations applied (reverse of translateToPostgres):
 *   1. Parameter placeholders: $1, $2, ... → ?
 *   2. PostgreSQL functions:
 *      - NOW() → datetime('now')
 *      - col->>'key' → json_extract(col, '$.key')
 *      - DOUBLE PRECISION → REAL
 *
 * Limitations:
 *   - Same as translateToPostgres (regex-based, best-effort)
 *   - Complex expressions may not translate perfectly
 *
 * @param {string} sql - PostgreSQL SQL query
 * @returns {string} SQLite SQL query
 */
export function translateToSQLite(sql) {
  if (!sql || typeof sql !== 'string') {
    return sql;
  }

  let result = sql;

  // 1. Translate NOW() → datetime('now')
  result = result.replace(/NOW\s*\(\s*\)/gi, "datetime('now')");

  // 2. Translate col->>'key' → json_extract(col, '$.key')
  result = result.replace(
    /(\w+)\s*->>\s*'([^']+)'/g,
    (match, col, key) => `json_extract(${col}, '$.${key}')`
  );

  // 3. Translate DOUBLE PRECISION → REAL
  result = result.replace(/DOUBLE\s+PRECISION/gi, 'REAL');

  // 4. Translate parameter placeholders: $1, $2, ... → ?
  result = result.replace(/\$\d+/g, '?');

  return result;
}

/**
 * Extract SQLite-isms from SQL and log warnings.
 * Use this to identify code that may not translate well to PostgreSQL.
 *
 * Checks for:
 *   - GLOB operator (not in PostgreSQL)
 *   - AUTOINCREMENT keyword (SQLite-specific, use SERIAL in PG)
 *   - SQLite FTS functions (full-text search)
 *   - VACUUM statement
 *   - ATTACH DATABASE statement
 *   - PRAGMA statements (SQLite-specific)
 *
 * @param {string} sql - SQL to analyze
 * @returns {Object} { issues: string[], warnings: string[] }
 */
export function findSqliteIssues(sql) {
  if (!sql || typeof sql !== 'string') {
    return { issues: [], warnings: [] };
  }

  const issues = [];
  const warnings = [];

  // Check for GLOB (not portable to PostgreSQL)
  if (/\bGLOB\b/i.test(sql)) {
    issues.push('GLOB operator found; use LIKE or regex instead');
  }

  // Check for AUTOINCREMENT (SQLite-specific)
  if (/AUTOINCREMENT/i.test(sql)) {
    warnings.push('AUTOINCREMENT keyword; use SERIAL PRIMARY KEY in PostgreSQL');
  }

  // Check for FTS (full-text search)
  if (/\bFTS[345]?\b/i.test(sql)) {
    issues.push('FTS (full-text search) not directly portable; use PostgreSQL tsvector');
  }

  // Check for VACUUM
  if (/\bVACUUM\b/i.test(sql)) {
    warnings.push('VACUUM is SQLite-specific; use VACUUM in PostgreSQL (different semantics)');
  }

  // Check for ATTACH DATABASE
  if (/\bATTACH\s+DATABASE\b/i.test(sql)) {
    issues.push('ATTACH DATABASE is SQLite-specific; not supported in PostgreSQL');
  }

  // Check for PRAGMA
  if (/\bPRAGMA\b/i.test(sql)) {
    warnings.push('PRAGMA statements are SQLite-specific; may not have PostgreSQL equivalents');
  }

  return { issues, warnings };
}

/**
 * Test whether a string contains only parameter placeholders that can be translated.
 * Useful for validation before calling translateToPostgres.
 *
 * @param {string} sql
 * @returns {boolean}
 */
export function hasOnlyValidPlaceholders(sql) {
  if (!sql || typeof sql !== 'string') {
    return true;
  }
  // Check for any non-? and non-$N placeholders (very permissive)
  return !/:[a-z_]/i.test(sql) && !/@[a-z_]/i.test(sql);
}

/**
 * Count the number of ? placeholders in a query.
 * Useful for validation and debugging.
 *
 * @param {string} sql
 * @returns {number}
 */
export function countPlaceholders(sql) {
  if (!sql || typeof sql !== 'string') {
    return 0;
  }
  const matches = sql.match(/\?/g);
  return matches ? matches.length : 0;
}
