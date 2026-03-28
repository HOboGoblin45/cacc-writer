/**
 * server/db/DualWriteManager.js
 * =============================
 * Runtime dual-write support for zero-downtime PostgreSQL migration.
 *
 * During the cutover period, the application can operate in different modes:
 *   - 'sqlite-only' (default): Writes and reads from SQLite only
 *   - 'dual-write': Writes to both SQLite and PostgreSQL, reads from SQLite
 *   - 'pg-primary': Writes to both, reads from PostgreSQL (verification)
 *   - 'pg-only': Writes and reads from PostgreSQL only
 *
 * Control via environment variable: DB_WRITE_MODE
 *
 * Usage:
 *   import { DualWriteManager } from './DualWriteManager.js';
 *   const manager = new DualWriteManager(sqliteAdapter, pgAdapter);
 *
 *   // Write to both, read from primary
 *   await manager.run('INSERT INTO cases ...', [params]);
 *   const rows = await manager.all('SELECT * FROM cases');
 *
 * Environment:
 *   DB_WRITE_MODE=sqlite-only    (default) - SQLite primary
 *   DB_WRITE_MODE=dual-write     - Both write, SQLite read
 *   DB_WRITE_MODE=pg-primary     - Both write, PG read
 *   DB_WRITE_MODE=pg-only        - PG primary
 */

import log from '../logger.js';

export class DualWriteManager {
  /**
   * Create a new dual-write manager.
   *
   * @param {DatabaseAdapter} sqliteAdapter - SQLite adapter
   * @param {DatabaseAdapter} pgAdapter - PostgreSQL adapter
   */
  constructor(sqliteAdapter, pgAdapter) {
    this.sqlite = sqliteAdapter;
    this.pg = pgAdapter;
  }

  /**
   * Get the current write mode from environment.
   *
   * @returns {string} One of: 'sqlite-only', 'dual-write', 'pg-primary', 'pg-only'
   */
  getWriteMode() {
    const mode = process.env.DB_WRITE_MODE || 'sqlite-only';
    return ['sqlite-only', 'dual-write', 'pg-primary', 'pg-only'].includes(mode)
      ? mode
      : 'sqlite-only';
  }

  /**
   * Execute an INSERT/UPDATE/DELETE statement.
   * Routes to primary DB, optionally mirrors to secondary.
   *
   * @async
   * @param {string} sql - SQL statement
   * @param {Array<any>} [params=[]] - Query parameters
   * @returns {Promise<Object>} Result object { changes, lastInsertRowid }
   */
  async run(sql, params = []) {
    const mode = this.getWriteMode();

    if (mode === 'sqlite-only') {
      return this.sqlite.run(sql, params);
    }

    if (mode === 'pg-only') {
      return this.pg.run(sql, params);
    }

    // Dual-write or pg-primary: primary first, then secondary
    const primary = mode === 'pg-primary' ? this.pg : this.sqlite;
    const secondary = mode === 'pg-primary' ? this.sqlite : this.pg;

    const result = await primary.run(sql, params);

    // Write to secondary asynchronously, don't block on errors
    this._writeSecondaryAsync(secondary, sql, params);

    return result;
  }

  /**
   * Execute a SELECT and return all matching rows.
   * Routes to primary based on mode.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Query parameters
   * @returns {Promise<Array<Object>>} Result rows
   */
  async all(sql, params = []) {
    const mode = this.getWriteMode();

    // pg-primary and pg-only read from PG; others read from SQLite
    if (mode === 'pg-primary' || mode === 'pg-only') {
      return this.pg.all(sql, params);
    }

    return this.sqlite.all(sql, params);
  }

  /**
   * Execute a SELECT and return the first matching row.
   * Routes to primary based on mode.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Query parameters
   * @returns {Promise<Object|undefined>} First result row or undefined
   */
  async get(sql, params = []) {
    const mode = this.getWriteMode();

    // pg-primary and pg-only read from PG; others read from SQLite
    if (mode === 'pg-primary' || mode === 'pg-only') {
      return this.pg.get(sql, params);
    }

    return this.sqlite.get(sql, params);
  }

  /**
   * Execute a transaction.
   * In dual-write mode, only the primary database is transactional.
   *
   * @async
   * @param {Function} fn - Transaction callback
   * @returns {Promise<any>} Return value of fn
   */
  async transaction(fn) {
    const mode = this.getWriteMode();
    const primary = mode === 'pg-primary' ? this.pg : this.sqlite;

    return primary.transaction(fn);
  }

  /**
   * Write to secondary database asynchronously.
   * Errors are logged but don't block primary write.
   *
   * @private
   * @async
   * @param {DatabaseAdapter} secondary
   * @param {string} sql
   * @param {Array<any>} params
   */
  async _writeSecondaryAsync(secondary, sql, params) {
    try {
      await secondary.run(sql, params);
    } catch (err) {
      const mode = this.getWriteMode();
      const secondaryDb = mode === 'pg-primary' ? 'SQLite' : 'PostgreSQL';
      log.warn('migration:dual-write-secondary-error', {
        secondaryDb,
        sql: sql.substring(0, 100),
        error: err.message,
      });
    }
  }

  /**
   * Verify consistency between SQLite and PostgreSQL for a table.
   * Returns mismatch info if counts don't match.
   *
   * @async
   * @param {string} tableName
   * @param {string} [schema='cacc']
   * @returns {Promise<Object>} { consistent: boolean, sqliteCount: number, pgCount: number }
   */
  async verifyTableSync(tableName, schema = 'cacc') {
    try {
      const sqliteResult = await this.sqlite.get(
        `SELECT COUNT(*) as n FROM ${tableName}`
      );
      const pgResult = await this.pg.get(
        `SELECT COUNT(*) as n FROM ${schema}.${tableName}`
      );

      const sqliteCount = sqliteResult?.n ?? 0;
      const pgCount = pgResult?.n ?? 0;

      return {
        consistent: sqliteCount === pgCount,
        sqliteCount,
        pgCount,
        table: tableName,
      };
    } catch (err) {
      log.warn('migration:verify-table-sync-error', {
        table: tableName,
        error: err.message,
      });
      return {
        consistent: false,
        sqliteCount: 0,
        pgCount: 0,
        table: tableName,
        error: err.message,
      };
    }
  }

  /**
   * Get current write mode status for diagnostics.
   *
   * @returns {Object}
   */
  getStatus() {
    const mode = this.getWriteMode();
    return {
      mode,
      primaryDb:
        mode === 'pg-only' || mode === 'pg-primary' ? 'PostgreSQL' : 'SQLite',
      secondaryDb:
        mode === 'dual-write' || mode === 'pg-primary' ? 'Both' : 'None',
      readSource:
        mode === 'pg-primary' || mode === 'pg-only'
          ? 'PostgreSQL'
          : 'SQLite',
    };
  }
}
