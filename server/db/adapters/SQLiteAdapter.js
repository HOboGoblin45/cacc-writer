/**
 * server/db/adapters/SQLiteAdapter.js
 * ===================================
 * SQLite adapter wrapping better-sqlite3.
 *
 * This adapter wraps the synchronous better-sqlite3 library in the async
 * DatabaseAdapter interface. All method calls return Promises that resolve
 * synchronously, making them compatible with code expecting async operations.
 *
 * Features:
 *   - Synchronous I/O (no event loop stalls)
 *   - WAL mode, foreign keys, connection pooling via pragmas
 *   - Transaction support via better-sqlite3's db.transaction()
 *   - Prepared statements for SQL injection protection
 *   - Named parameter support ($name, :name, @name)
 *
 * Usage:
 *   import { SQLiteAdapter } from './adapters/SQLiteAdapter.js';
 *   const adapter = new SQLiteAdapter();
 *   await adapter.connect({ filename: './data/cacc.db' });
 *   const rows = await adapter.all('SELECT * FROM cases');
 *   await adapter.disconnect();
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import log from '../../logger.js';
import { DatabaseAdapter } from './DatabaseAdapter.js';

/**
 * @class SQLiteAdapter
 * @extends DatabaseAdapter
 */
export class SQLiteAdapter extends DatabaseAdapter {
  /**
   * Create a new SQLite adapter instance.
   * Does not connect immediately; call connect() to open the database.
   */
  constructor() {
    super();
    this._db = null;
  }

  /**
   * Connect to the SQLite database.
   * Creates the database file if it doesn't exist.
   * Initializes connection pragmas for performance and safety.
   *
   * @async
   * @param {Object} config
   * @param {string} [config.filename] - Path to SQLite database file (required)
   * @returns {Promise<void>}
   */
  async connect(config = {}) {
    const filename = config.filename || './data/cacc.db';

    // Ensure directory exists
    const dbDir = path.dirname(path.resolve(filename));
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Open connection
    this._db = new BetterSqlite3(path.resolve(filename));

    // Set performance + safety pragmas
    try {
      this._db.pragma('journal_mode = WAL');        // Write-Ahead Logging
      this._db.pragma('foreign_keys = ON');         // Enforce FK constraints
      this._db.pragma('synchronous = NORMAL');      // Balance safety vs speed
      this._db.pragma('cache_size = -8000');        // 8MB page cache
      this._db.pragma('temp_store = MEMORY');       // Temp tables in memory
    } catch (err) {
      log.warn('Failed to set SQLite pragmas', { error: err.message });
    }

    log.info('SQLite adapter connected', { filename: path.resolve(filename) });
  }

  /**
   * Disconnect from the SQLite database.
   * Closes the file handle and releases resources.
   *
   * @async
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._db) {
      try {
        this._db.close();
      } catch (err) {
        log.warn('Error closing SQLite connection', { error: err.message });
      }
      this._db = null;
    }
    log.info('SQLite adapter disconnected');
  }

  /**
   * Check if connected to the database.
   *
   * @async
   * @returns {Promise<boolean>}
   */
  async isConnected() {
    return this._db !== null;
  }

  /**
   * Execute a query that returns multiple rows.
   * All rows are returned as plain objects.
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<Array<Object>>}
   */
  async all(sql, params = []) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    return this._db.prepare(sql).all(...params);
  }

  /**
   * Execute a query that returns a single row.
   * Returns undefined (not null) if no match is found. Callers should normalize to null if needed.
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<Object|undefined>}
   */
  async get(sql, params = []) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    return this._db.prepare(sql).get(...params);
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   * Returns an object with 'changes' (rows affected) and 'lastInsertRowid' (if applicable).
   *
   * SQLite better-sqlite3 returns a RunResult with:
   *   - changes: number of rows modified
   *   - lastInsertRowid: ROWID of last inserted row (if auto-increment used)
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<{changes: number, lastInsertRowid: number|bigint}>}
   */
  async run(sql, params = []) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    const result = this._db.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid ?? null,
    };
  }

  /**
   * Begin a transaction.
   *
   * @async
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    this._db.exec('BEGIN TRANSACTION');
  }

  /**
   * Commit the current transaction.
   *
   * @async
   * @returns {Promise<void>}
   */
  async commit() {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    this._db.exec('COMMIT');
  }

  /**
   * Rollback the current transaction.
   *
   * @async
   * @returns {Promise<void>}
   */
  async rollback() {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    this._db.exec('ROLLBACK');
  }

  /**
   * Execute a function within a transaction using better-sqlite3's native transaction support.
   * This is more efficient than manual BEGIN/COMMIT/ROLLBACK because better-sqlite3
   * creates a transaction function that cannot be nested and has stricter guarantees.
   *
   * @async
   * @param {Function} fn - Callback (sync or async, but typically sync for SQLite)
   * @returns {Promise<any>}
   */
  async transaction(fn) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    const txFn = this._db.transaction(fn);
    return txFn();
  }

  /**
   * Execute raw SQL statement(s).
   * Use for DDL (CREATE TABLE, ALTER TABLE, etc.).
   *
   * @async
   * @param {string} sql
   * @returns {Promise<void>}
   */
  async exec(sql) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    this._db.exec(sql);
  }

  /**
   * Check if a table exists.
   * Queries the SQLite system catalog.
   *
   * @async
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    const row = this._db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!row;
  }

  /**
   * Execute a PRAGMA statement.
   * Common pragmas: 'journal_mode', 'foreign_keys', 'synchronous', etc.
   *
   * @async
   * @param {string} key - Pragma key
   * @param {string|number} [value] - Value to set (optional)
   * @returns {Promise<any>}
   */
  async pragma(key, value) {
    if (!this._db) {
      throw new Error('SQLiteAdapter: not connected');
    }
    if (value !== undefined) {
      return this._db.pragma(`${key} = ${value}`);
    }
    return this._db.pragma(key);
  }

  /**
   * Return the dialect identifier.
   *
   * @returns {string}
   */
  getDialect() {
    return 'sqlite';
  }
}
