/**
 * server/db/AsyncQueryRunner.js
 * ============================
 * Async query wrapper for database operations.
 *
 * AsyncQueryRunner provides a consistent async interface for database operations.
 * It works with both the old sync better-sqlite3 DB objects and new async adapters,
 * transparently handling both during the migration phase.
 *
 * During migration, this class detects whether it's wrapping a sync database
 * or an async adapter and handles both transparently.
 *
 * Usage:
 *   import { createAsyncRunner } from './AsyncQueryRunner.js';
 *
 *   // With sync better-sqlite3 database
 *   const runner = createAsyncRunner(getDb());
 *   const rows = await runner.all('SELECT * FROM cases WHERE status = ?', ['active']);
 *
 *   // With async adapter (PostgreSQL, future SQLite async)
 *   const runner = createAsyncRunner(adapter);
 *   const rows = await runner.all('SELECT * FROM cases WHERE status = ?', ['active']);
 *
 * @class AsyncQueryRunner
 */

import log from '../logger.js';

export class AsyncQueryRunner {
  /**
   * Create a new AsyncQueryRunner.
   * @param {Object} dbOrAdapter - Either a better-sqlite3 database object or a DatabaseAdapter
   */
  constructor(dbOrAdapter) {
    this._source = dbOrAdapter;
    // Detect if this is an adapter (has getDialect method) or a sync database
    this._isAdapter = typeof dbOrAdapter?.getDialect === 'function';
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   * Returns metadata about the operation: { changes, lastInsertRowid }
   *
   * @async
   * @param {string} sql - SQL query (INSERT, UPDATE, or DELETE)
   * @param {Array<any>} [params=[]] - Bind parameters
   * @returns {Promise<{changes: number, lastInsertRowid: number|bigint|null}>}
   * @throws {Error} If query fails
   */
  async run(sql, params = []) {
    if (this._isAdapter) {
      return this._source.run(sql, params);
    }
    // Sync better-sqlite3 path
    try {
      const stmt = this._source.prepare(sql);
      const info = stmt.run(...params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid ?? null,
      };
    } catch (err) {
      log.error('AsyncQueryRunner:run', {
        sql: sql.substring(0, 100),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Execute a query that returns a single row.
   * Returns null if no matching row is found.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Bind parameters
   * @returns {Promise<Object|null|undefined>}
   * @throws {Error} If query fails
   */
  async get(sql, params = []) {
    if (this._isAdapter) {
      return this._source.get(sql, params);
    }
    try {
      return this._source.prepare(sql).get(...params);
    } catch (err) {
      log.error('AsyncQueryRunner:get', {
        sql: sql.substring(0, 100),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Execute a query that returns multiple rows.
   * Returns an empty array if no matches are found.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Bind parameters
   * @returns {Promise<Array<Object>>}
   * @throws {Error} If query fails
   */
  async all(sql, params = []) {
    if (this._isAdapter) {
      return this._source.all(sql, params);
    }
    try {
      return this._source.prepare(sql).all(...params);
    } catch (err) {
      log.error('AsyncQueryRunner:all', {
        sql: sql.substring(0, 100),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Execute raw SQL statement(s) (DDL: CREATE, ALTER, DROP, etc.).
   * Unlike run(), this executes multiple statements and does not return result metadata.
   * Use for schema changes, not for CRUD operations.
   *
   * @async
   * @param {string} sql - SQL statement(s)
   * @returns {Promise<void>}
   * @throws {Error} If execution fails
   */
  async exec(sql) {
    if (this._isAdapter) {
      return this._source.exec(sql);
    }
    try {
      return this._source.exec(sql);
    } catch (err) {
      log.error('AsyncQueryRunner:exec', {
        sql: sql.substring(0, 100),
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Execute a function within a transaction.
   * Automatically handles BEGIN, COMMIT, and ROLLBACK.
   * If fn throws, the transaction is rolled back; otherwise committed.
   *
   * @async
   * @param {Function} fn - Callback to execute. Can be async or sync.
   * @returns {Promise<any>} Return value of fn
   * @throws {Error} If fn throws or transaction management fails
   */
  async transaction(fn) {
    if (this._isAdapter) {
      return this._source.transaction(fn);
    }
    // Sync better-sqlite3 transaction
    try {
      const txFn = this._source.transaction(fn);
      return txFn();
    } catch (err) {
      log.error('AsyncQueryRunner:transaction', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Get the SQL dialect identifier for the underlying source.
   * Returns either 'sqlite' or 'postgresql'.
   *
   * @returns {string}
   */
  getDialect() {
    if (this._isAdapter) {
      return this._source.getDialect();
    }
    return 'sqlite';
  }

  /**
   * Check if this runner is wrapping an async adapter.
   * Useful for conditional logic in migration code.
   *
   * @returns {boolean}
   */
  isAsync() {
    return this._isAdapter;
  }
}

/**
 * Factory function to create an AsyncQueryRunner.
 *
 * @param {Object} dbOrAdapter - Either a better-sqlite3 database object or a DatabaseAdapter
 * @returns {AsyncQueryRunner}
 */
export function createAsyncRunner(dbOrAdapter) {
  return new AsyncQueryRunner(dbOrAdapter);
}
