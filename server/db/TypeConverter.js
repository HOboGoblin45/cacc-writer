/**
 * server/db/TypeConverter.js
 * =========================
 * SQLite → PostgreSQL type conversion utilities.
 *
 * Handles conversion of SQLite data types to PostgreSQL equivalents:
 *   - Booleans: 0/1 → true/false
 *   - Timestamps: Text ISO strings → TIMESTAMPTZ
 *   - JSON: Text strings → Parsed JSON objects
 *   - Numbers: Handle precision differences
 *
 * Usage:
 *   import { convertRow, buildInsertSQL, buildBatchInsertSQL } from './TypeConverter.js';
 *   const converted = convertRow(row, tableSchema);
 *   const sql = buildInsertSQL('cases', ['id', 'name']);
 *   const batchSql = buildBatchInsertSQL('cases', ['id', 'name'], 100);
 */

/**
 * Convert a single SQLite row to PostgreSQL types.
 * Modifies booleans (0/1 → true/false), timestamps (string → ISO), JSON (string → parsed).
 *
 * @param {Object} row - SQLite row data
 * @param {Array<Object>} columns - Column schema array with { name, pgType } objects
 * @returns {Object} Converted row (shallow copy)
 */
export function convertRow(row, columns) {
  const converted = { ...row };

  for (const col of columns) {
    if (converted[col.name] === undefined || converted[col.name] === null) {
      continue;
    }

    const pgType = col.pgType || '';
    const value = converted[col.name];

    // Boolean conversion: SQLite uses 0/1, PG uses true/false
    if (pgType.includes('BOOLEAN')) {
      converted[col.name] = Boolean(value);
    }
    // Timestamp conversion: SQLite stores as TEXT/UNIX, PG as TIMESTAMPTZ
    else if (pgType.includes('TIMESTAMPTZ') || pgType.includes('TIMESTAMP')) {
      if (typeof value === 'string') {
        // Ensure ISO format
        try {
          converted[col.name] = new Date(value).toISOString();
        } catch {
          converted[col.name] = value; // Keep as-is if parse fails
        }
      } else if (typeof value === 'number') {
        // Unix timestamp
        converted[col.name] = new Date(value * 1000).toISOString();
      }
    }
    // JSON conversion: SQLite stores as TEXT, PG as JSONB
    else if (pgType.includes('JSONB') || pgType.includes('JSON')) {
      if (typeof value === 'string') {
        try {
          converted[col.name] = JSON.parse(value);
        } catch {
          converted[col.name] = value; // Keep as string if not valid JSON
        }
      }
    }
  }

  return converted;
}

/**
 * Build a parameterized INSERT statement for PostgreSQL.
 *
 * @param {string} tableName - Target table name
 * @param {Array<string>} columns - Column names to insert
 * @param {string} [schema='cacc'] - PostgreSQL schema name
 * @returns {object} { sql: string, placeholders: string }
 *
 * @example
 * buildInsertSQL('cases', ['id', 'name'])
 * // Returns: { sql: 'INSERT INTO cacc.cases (id, name) VALUES ($1, $2)', placeholders: '$1, $2' }
 */
export function buildInsertSQL(tableName, columns, schema = 'cacc') {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const columnList = columns.join(', ');
  const sql = `INSERT INTO ${schema}.${tableName} (${columnList}) VALUES (${placeholders})`;

  return { sql, placeholders };
}

/**
 * Build a batch INSERT statement for PostgreSQL that inserts multiple rows.
 *
 * @param {string} tableName - Target table name
 * @param {Array<string>} columns - Column names to insert
 * @param {number} batchSize - Number of rows per batch
 * @param {string} [schema='cacc'] - PostgreSQL schema name
 * @returns {object} { sql: string, placeholderPattern: string, rowsPerBatch: number }
 *
 * @example
 * buildBatchInsertSQL('cases', ['id', 'name'], 100)
 * // Returns: {
 * //   sql: 'INSERT INTO cacc.cases (id, name) VALUES ($1, $2), ($3, $4), ...up to 100 rows...',
 * //   placeholderPattern: '($1, $2)',
 * //   rowsPerBatch: 100
 * // }
 */
export function buildBatchInsertSQL(
  tableName,
  columns,
  batchSize,
  schema = 'cacc'
) {
  const columnList = columns.join(', ');
  const colCount = columns.length;

  // Build value placeholders for one row: ($1, $2, $3)
  const placeholderPattern = `($${[...Array(colCount)].map((_, i) => i + 1).join(', $')})`;

  // Build N rows worth of placeholders
  const allPlaceholders = [];
  for (let i = 0; i < batchSize; i++) {
    const offset = i * colCount;
    const rowPlaceholders = [...Array(colCount)]
      .map((_, j) => `$${offset + j + 1}`)
      .join(', ');
    allPlaceholders.push(`(${rowPlaceholders})`);
  }

  const sql = `INSERT INTO ${schema}.${tableName} (${columnList}) VALUES ${allPlaceholders.join(', ')}`;

  return {
    sql,
    placeholderPattern,
    rowsPerBatch: batchSize,
  };
}

/**
 * Build the WHERE clause condition for finding a row by primary key.
 *
 * @param {Object} table - Table info with { name, primaryKeyColumn }
 * @param {string} [schema='cacc'] - PostgreSQL schema name
 * @returns {string} WHERE clause, e.g., "WHERE id = $1"
 */
export function buildPrimaryKeyWhereClause(table, schema = 'cacc') {
  const pkCol = table.primaryKeyColumn || 'id';
  return `WHERE ${pkCol} = $1`;
}

/**
 * Get the parameter index for a column in a parameterized query.
 * Useful for building complex UPDATE or DELETE statements.
 *
 * @param {Array<string>} columns - All column names in the original query
 * @param {string} columnName - The column to find the parameter for
 * @returns {number} Parameter index (1-indexed), or -1 if not found
 */
export function getParameterIndex(columns, columnName) {
  const idx = columns.indexOf(columnName);
  return idx >= 0 ? idx + 1 : -1;
}
