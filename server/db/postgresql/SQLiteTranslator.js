/**
 * server/db/postgresql/SQLiteTranslator.js
 * =========================================
 * Utility to programmatically translate SQLite DDL to PostgreSQL DDL.
 * Handles column type conversions, default values, and constraints.
 */

/**
 * Translate SQLite DDL to PostgreSQL DDL.
 * Handles common conversion patterns:
 *   - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
 *   - TEXT → TEXT
 *   - REAL → DOUBLE PRECISION
 *   - INTEGER → INTEGER
 *   - datetime('now') → NOW()
 *   - DEFAULT values
 *   - FOREIGN KEY and other constraints
 *
 * @param {string} sqliteDDL - SQLite CREATE TABLE statement
 * @returns {string} PostgreSQL-compatible DDL
 */
export function translateDDL(sqliteDDL) {
  let ddl = sqliteDDL;

  // Handle AUTOINCREMENT
  ddl = ddl.replace(
    /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
    'SERIAL PRIMARY KEY'
  );

  // Handle REAL → DOUBLE PRECISION
  ddl = ddl.replace(/\bREAL\b/gi, 'DOUBLE PRECISION');

  // Handle datetime('now') → NOW()
  ddl = ddl.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');
  ddl = ddl.replace(/CURRENT_TIMESTAMP/gi, 'CURRENT_TIMESTAMP');

  // Remove SQLite-specific pragmas
  ddl = ddl.replace(/CHECK\s*\([^)]*\)/gi, (match) => {
    // Keep CHECKs but make sure they're PostgreSQL compatible
    return match;
  });

  // Handle TEXT with quotes (keep as is)
  // Handle DEFAULT '' for TEXT columns
  ddl = ddl.replace(/DEFAULT\s+''/gi, "DEFAULT ''");

  // Handle DEFAULT '[]' for JSON
  ddl = ddl.replace(/DEFAULT\s+'(\[\]|{}|true|false)'/gi, (match, p1) => {
    return `DEFAULT '${p1}'`;
  });

  // Handle DEFAULT values without quotes
  ddl = ddl.replace(/DEFAULT\s+(-?\d+(?:\.\d+)?)/gi, (match, p1) => {
    return `DEFAULT ${p1}`;
  });

  // Remove "IF NOT EXISTS" (we'll handle schema creation separately)
  // Keep it for now - PostgreSQL supports it
  // ddl = ddl.replace(/IF\s+NOT\s+EXISTS/gi, '');

  return ddl;
}

/**
 * Extract all CREATE TABLE statements from SQL script.
 * @param {string} sql - SQL script containing multiple CREATE TABLE statements
 * @returns {Array<string>} Array of CREATE TABLE statements
 */
export function extractCreateTableStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const isCreateTable =
      sql.substring(i).toUpperCase().startsWith('CREATE TABLE');

    if (isCreateTable && depth === 0) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
    }

    current += char;

    if (char === '(') depth++;
    if (char === ')') depth--;

    // End of statement
    if (char === ';' && depth === 0) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter(
    (s) => s.toUpperCase().startsWith('CREATE TABLE')
  );
}

/**
 * Parse a CREATE TABLE statement to extract column definitions.
 * @param {string} ddl - CREATE TABLE statement
 * @returns {Object} { tableName, columns: [{name, sqliteType, pgType}], constraints }
 */
export function parseCreateTableDDL(ddl) {
  const tableMatch = ddl.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(/i);
  if (!tableMatch) {
    throw new Error('Invalid CREATE TABLE statement');
  }

  const tableName = tableMatch[1];
  const contentStart = ddl.indexOf('(');
  const contentEnd = ddl.lastIndexOf(')');
  const content = ddl.substring(contentStart + 1, contentEnd);

  const columns = [];
  const constraints = [];

  // Split by comma, but be careful about nested parentheses
  const parts = [];
  let current = '';
  let depth = 0;

  for (const char of content) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  // Parse each part
  for (const part of parts) {
    const upper = part.toUpperCase();

    if (
      upper.startsWith('FOREIGN KEY') ||
      upper.startsWith('PRIMARY KEY') ||
      upper.startsWith('UNIQUE') ||
      upper.startsWith('CHECK')
    ) {
      constraints.push(part);
    } else {
      // Column definition
      const tokens = part.match(/(\w+)\s+(.*)/);
      if (tokens) {
        const name = tokens[1];
        const type = tokens[2];
        columns.push({
          name,
          sqliteType: type,
          pgType: translateDDL(type),
        });
      }
    }
  }

  return {
    tableName,
    columns,
    constraints,
  };
}

/**
 * Validate a PostgreSQL DDL statement.
 * Basic syntax check - returns true if it looks valid.
 * @param {string} ddl - PostgreSQL DDL to validate
 * @returns {boolean}
 */
export function validatePostgresSQL(ddl) {
  if (!ddl || typeof ddl !== 'string') {
    return false;
  }

  const upper = ddl.toUpperCase().trim();

  // Check for required keywords
  if (!upper.startsWith('CREATE TABLE')) {
    return false;
  }

  // Check for matching parentheses
  const openCount = (ddl.match(/\(/g) || []).length;
  const closeCount = (ddl.match(/\)/g) || []).length;

  return openCount === closeCount;
}

export default {
  translateDDL,
  extractCreateTableStatements,
  parseCreateTableDDL,
  validatePostgresSQL,
};
