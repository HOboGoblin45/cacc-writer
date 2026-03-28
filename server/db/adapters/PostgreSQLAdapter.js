/**
 * server/db/adapters/PostgreSQLAdapter.js
 * ======================================
 * PostgreSQL adapter wrapping node-postgres (pg).
 *
 * This adapter wraps the async pg (node-postgres) library in the DatabaseAdapter interface.
 * Features:
 *   - Connection pooling (configurable pool size)
 *   - Async/await support
 *   - Prepared statements
 *   - Transaction support via client
 *   - Automatic placeholder translation (? → $1, $2, ...)
 *   - SSL/TLS support
 *
 * Installation (optional, graceful fallback if not installed):
 *   npm install pg
 *
 * Usage:
 *   import { PostgreSQLAdapter } from './adapters/PostgreSQLAdapter.js';
 *   const adapter = new PostgreSQLAdapter();
 *   await adapter.connect({
 *     host: 'localhost',
 *     port: 5432,
 *     database: 'cacc_writer',
 *     user: 'postgres',
 *     password: 'secret'
 *   });
 *   const rows = await adapter.all('SELECT * FROM cases WHERE status = ?', ['active']);
 *   await adapter.disconnect();
 *
 * Configuration via environment variables:
 *   - DB_HOST (default: localhost)
 *   - DB_PORT (default: 5432)
 *   - DB_NAME (default: cacc_writer)
 *   - DB_USER (default: postgres)
 *   - DB_PASSWORD
 *   - DB_POOL_MAX (default: 20)
 */

import log from '../../logger.js';
import { DatabaseAdapter } from './DatabaseAdapter.js';
import { translateToPostgres } from './QueryTranslator.js';

// Import pg gracefully; adapter will fail at runtime if not installed
let Pool;
try {
  const pgModule = await import('pg');
  Pool = pgModule.Pool;
} catch (err) {
  // pg not installed; error will be thrown when trying to use this adapter
  log.warn('pg module not installed; PostgreSQLAdapter will fail at runtime');
  Pool = null;
}

/**
 * @class PostgreSQLAdapter
 * @extends DatabaseAdapter
 */
export class PostgreSQLAdapter extends DatabaseAdapter {
  /**
   * Create a new PostgreSQL adapter instance.
   * Does not connect immediately; call connect() to initialize the pool.
   */
  constructor() {
    super();
    this._pool = null;
    this._client = null; // Used for transactions
  }

  /**
   * Connect to PostgreSQL.
   * Creates a connection pool for efficient connection management.
   *
   * @async
   * @param {Object} config
   * @param {string} [config.host] - PostgreSQL host (default: localhost)
   * @param {number} [config.port] - PostgreSQL port (default: 5432)
   * @param {string} [config.database] - Database name (default: cacc_writer)
   * @param {string} [config.user] - Username (default: postgres)
   * @param {string} [config.password] - Password (optional)
   * @param {number} [config.max] - Max pool size (default: 20)
   * @param {boolean|Object} [config.ssl] - SSL config (default: false for localhost, true otherwise)
   * @returns {Promise<void>}
   * @throws {Error} If pg is not installed or connection fails
   */
  async connect(config = {}) {
    if (!Pool) {
      throw new Error(
        'PostgreSQL adapter requires "pg" module. Install with: npm install pg'
      );
    }

    // Read from config or environment
    const poolConfig = {
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT || '5432', 10),
      database: config.database || process.env.DB_NAME || 'cacc_writer',
      user: config.user || process.env.DB_USER || 'postgres',
      password: config.password || process.env.DB_PASSWORD || undefined,
      max: config.max || parseInt(process.env.DB_POOL_MAX || '20', 10),
      ssl: config.ssl !== false, // Default to SSL unless explicitly disabled
    };

    // Disable SSL for localhost by default
    if (poolConfig.host === 'localhost' || poolConfig.host === '127.0.0.1') {
      poolConfig.ssl = config.ssl ?? false;
    }

    // Remove undefined password
    if (!poolConfig.password) {
      delete poolConfig.password;
    }

    this._pool = new Pool(poolConfig);

    // Test connection
    try {
      const client = await this._pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      log.info('PostgreSQL adapter connected', {
        host: poolConfig.host,
        port: poolConfig.port,
        database: poolConfig.database,
        poolMax: poolConfig.max,
      });
    } catch (err) {
      this._pool = null;
      throw new Error(`PostgreSQL connection failed: ${err.message}`);
    }
  }

  /**
   * Disconnect from PostgreSQL.
   * Drains the pool and closes all connections.
   *
   * @async
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._client) {
      this._client.release();
      this._client = null;
    }
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
    log.info('PostgreSQL adapter disconnected');
  }

  /**
   * Check if connected to the database.
   *
   * @async
   * @returns {Promise<boolean>}
   */
  async isConnected() {
    if (!this._pool) return false;
    try {
      const client = await this._pool.connect();
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a query that returns multiple rows.
   * Automatically translates ? placeholders to $1, $2, etc.
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<Array<Object>>}
   */
  async all(sql, params = []) {
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    const translatedSql = this._translatePlaceholders(sql);
    const client = await this._pool.connect();
    try {
      const result = await client.query(translatedSql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query that returns a single row.
   * Returns null if no match is found (for compatibility with get() contract).
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<Object|null>}
   */
  async get(sql, params = []) {
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    const translatedSql = this._translatePlaceholders(sql);
    const client = await this._pool.connect();
    try {
      const result = await client.query(translatedSql, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   * Returns an object with 'changes' (rows affected) and 'lastInsertRowid'.
   *
   * lastInsertRowid is populated only for INSERT statements with RETURNING id.
   * For manual extraction of inserted IDs, use RETURNING clause:
   *   INSERT INTO users (name) VALUES (?) RETURNING id
   *
   * @async
   * @param {string} sql
   * @param {Array<any>} [params=[]]
   * @returns {Promise<{changes: number, lastInsertRowid: number|null}>}
   */
  async run(sql, params = []) {
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    const translatedSql = this._translatePlaceholders(sql);
    const client = await this._pool.connect();
    try {
      const result = await client.query(translatedSql, params);
      return {
        changes: result.rowCount || 0,
        lastInsertRowid: result.rows?.[0]?.id || null,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Begin a transaction.
   * Acquires a client from the pool for this transaction.
   *
   * @async
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    if (this._client) {
      throw new Error('PostgreSQLAdapter: transaction already in progress');
    }
    this._client = await this._pool.connect();
    await this._client.query('BEGIN');
  }

  /**
   * Commit the current transaction.
   * Releases the client back to the pool.
   *
   * @async
   * @returns {Promise<void>}
   */
  async commit() {
    if (!this._client) {
      throw new Error('PostgreSQLAdapter: no transaction in progress');
    }
    try {
      await this._client.query('COMMIT');
    } finally {
      this._client.release();
      this._client = null;
    }
  }

  /**
   * Rollback the current transaction.
   * Releases the client back to the pool.
   *
   * @async
   * @returns {Promise<void>}
   */
  async rollback() {
    if (!this._client) {
      throw new Error('PostgreSQLAdapter: no transaction in progress');
    }
    try {
      await this._client.query('ROLLBACK');
    } finally {
      this._client.release();
      this._client = null;
    }
  }

  /**
   * Execute a function within a transaction.
   * Handles BEGIN, COMMIT, ROLLBACK automatically.
   * Queries within fn must use the adapter's methods (run, all, get).
   *
   * @async
   * @param {Function} fn
   * @returns {Promise<any>}
   */
  async transaction(fn) {
    await this.beginTransaction();
    try {
      const result = await fn();
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    }
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
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    const client = await this._pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  /**
   * Check if a table exists.
   * Queries PostgreSQL information_schema.
   *
   * @async
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    if (!this._pool) {
      throw new Error('PostgreSQLAdapter: not connected');
    }
    const client = await this._pool.connect();
    try {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        )`,
        [tableName]
      );
      return result.rows[0].exists;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a PRAGMA statement.
   * PostgreSQL doesn't have PRAGMA, so this logs a warning and returns null.
   *
   * @async
   * @param {string} key
   * @param {string|number} [value]
   * @returns {Promise<null>}
   */
  async pragma(key, value) {
    log.warn('PRAGMA not supported on PostgreSQL', { key, value });
    return null;
  }

  /**
   * Return the dialect identifier.
   *
   * @returns {string}
   */
  getDialect() {
    return 'postgresql';
  }

  /**
   * Translate SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
   * This is an internal helper that uses QueryTranslator.
   *
   * @private
   * @param {string} sql
   * @returns {string}
   */
  _translatePlaceholders(sql) {
    if (!sql || typeof sql !== 'string') {
      return sql;
    }
    // Count ? and replace with $1, $2, ...
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }
}
