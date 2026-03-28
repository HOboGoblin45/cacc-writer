/**
 * server/db/adapters/DatabaseAdapter.js
 * =====================================
 * Abstract database adapter interface.
 *
 * This class defines the contract that all database adapters (SQLite, PostgreSQL) must implement.
 * It uses the template method pattern: concrete implementations override methods, and each
 * method signature is documented with expected behavior.
 *
 * All methods are async to support both synchronous (SQLite) and asynchronous (PostgreSQL) drivers.
 * SQLite implementations wrap synchronous calls in async functions for interface compatibility.
 *
 * Usage:
 *   import { createAdapter } from './adapters/index.js';
 *   const adapter = createAdapter({ driver: 'sqlite' });
 *   await adapter.connect({ filename: './data/cacc.db' });
 *   const rows = await adapter.all('SELECT * FROM cases WHERE status = ?', ['active']);
 *   await adapter.disconnect();
 *
 * @class DatabaseAdapter
 */
export class DatabaseAdapter {
  /**
   * Connect to the database.
   * For SQLite: opens the file at config.filename (creates if missing).
   * For PostgreSQL: creates a connection pool.
   *
   * @async
   * @param {Object} config - Connection configuration
   * @param {string} [config.filename] - SQLite file path (for SQLite adapter)
   * @param {string} [config.host] - PostgreSQL hostname (for PostgreSQL adapter)
   * @param {number} [config.port] - PostgreSQL port (for PostgreSQL adapter)
   * @param {string} [config.database] - Database name (for PostgreSQL adapter)
   * @param {string} [config.user] - PostgreSQL username (for PostgreSQL adapter)
   * @param {string} [config.password] - PostgreSQL password (for PostgreSQL adapter)
   * @param {number} [config.max] - Max pool connections (for PostgreSQL adapter)
   * @param {boolean|Object} [config.ssl] - SSL configuration (for PostgreSQL adapter)
   * @returns {Promise<void>}
   * @throws {Error} If connection fails
   */
  async connect(config) {
    throw new Error('Not implemented: connect(config)');
  }

  /**
   * Disconnect from the database.
   * For SQLite: closes the file handle.
   * For PostgreSQL: drains the connection pool.
   *
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If disconnection fails
   */
  async disconnect() {
    throw new Error('Not implemented: disconnect()');
  }

  /**
   * Check if the adapter is connected.
   *
   * @async
   * @returns {Promise<boolean>}
   */
  async isConnected() {
    throw new Error('Not implemented: isConnected()');
  }

  /**
   * Execute a query that returns multiple rows (SELECT).
   *
   * Parameter binding uses different placeholders by dialect:
   *   - SQLite: ? for positional parameters or $name/:name/@name for named
   *   - PostgreSQL: $1, $2, $3... for positional (required)
   *
   * Use positional ? placeholders in your code and let the adapter translate to $1, $2, etc.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Bind parameters for ? placeholders
   * @returns {Promise<Array<Object>>} Array of result rows (empty array if no matches)
   * @throws {Error} If query fails
   *
   * @example
   *   const users = await adapter.all(
   *     'SELECT id, name FROM users WHERE status = ?',
   *     ['active']
   *   );
   */
  async all(sql, params = []) {
    throw new Error('Not implemented: all(sql, params)');
  }

  /**
   * Execute a query that returns a single row (SELECT).
   * Returns null if no matching row is found.
   *
   * @async
   * @param {string} sql - SQL query
   * @param {Array<any>} [params=[]] - Bind parameters for ? placeholders
   * @returns {Promise<Object|null>} Single result row or null
   * @throws {Error} If query fails
   *
   * @example
   *   const user = await adapter.get(
   *     'SELECT * FROM users WHERE id = ?',
   *     [userId]
   *   );
   */
  async get(sql, params = []) {
    throw new Error('Not implemented: get(sql, params)');
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE statement.
   * Returns metadata about the operation.
   *
   * @async
   * @param {string} sql - SQL query (INSERT, UPDATE, or DELETE)
   * @param {Array<any>} [params=[]] - Bind parameters for ? placeholders
   * @returns {Promise<{changes: number, lastInsertRowid: number|bigint|null}>}
   *   - changes: number of rows affected
   *   - lastInsertRowid: ID of last inserted row (null for UPDATE/DELETE or if auto-increment not used)
   * @throws {Error} If query fails
   *
   * @example
   *   const result = await adapter.run(
   *     'INSERT INTO users (name, email) VALUES (?, ?)',
   *     ['Alice', 'alice@example.com']
   *   );
   *   console.log(result.changes, result.lastInsertRowid); // 1, 123
   */
  async run(sql, params = []) {
    throw new Error('Not implemented: run(sql, params)');
  }

  /**
   * Begin a transaction.
   * Subsequent queries run in this transaction until commit() or rollback() is called.
   *
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If transaction cannot begin
   */
  async beginTransaction() {
    throw new Error('Not implemented: beginTransaction()');
  }

  /**
   * Commit the current transaction.
   * All queries since beginTransaction() are persisted.
   *
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If commit fails or no transaction is active
   */
  async commit() {
    throw new Error('Not implemented: commit()');
  }

  /**
   * Rollback the current transaction.
   * All queries since beginTransaction() are discarded.
   *
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If rollback fails or no transaction is active
   */
  async rollback() {
    throw new Error('Not implemented: rollback()');
  }

  /**
   * Execute a function within a transaction.
   * Automatically handles BEGIN, COMMIT, and ROLLBACK.
   * If fn throws, the transaction is rolled back; otherwise committed.
   *
   * @async
   * @param {Function} fn - Callback to execute; can be async or sync. Receives no arguments.
   * @returns {Promise<any>} Return value of fn
   * @throws {Error} If fn throws or transaction management fails
   *
   * @example
   *   const result = await adapter.transaction(async () => {
   *     await adapter.run('INSERT INTO accounts SET balance = balance - ?', [100]);
   *     await adapter.run('INSERT INTO accounts SET balance = balance + ?', [100]);
   *     return 'success';
   *   });
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
   * Execute raw SQL statements (DDL: CREATE, ALTER, DROP, etc.).
   * Unlike run(), this executes multiple statements and does not return result metadata.
   * Use for schema changes, not for CRUD operations.
   *
   * @async
   * @param {string} sql - SQL statement(s)
   * @returns {Promise<void>}
   * @throws {Error} If execution fails
   *
   * @example
   *   await adapter.exec(`
   *     CREATE TABLE IF NOT EXISTS users (
   *       id INTEGER PRIMARY KEY,
   *       name TEXT NOT NULL
   *     );
   *   `);
   */
  async exec(sql) {
    throw new Error('Not implemented: exec(sql)');
  }

  /**
   * Check if a table exists in the database.
   *
   * @async
   * @param {string} tableName - Name of the table to check
   * @returns {Promise<boolean>}
   * @throws {Error} If query fails
   */
  async tableExists(tableName) {
    throw new Error('Not implemented: tableExists(tableName)');
  }

  /**
   * Execute a PRAGMA statement (SQLite-specific command).
   * For non-SQLite adapters, this is typically a no-op with a warning logged.
   *
   * @async
   * @param {string} key - Pragma key (e.g., 'journal_mode', 'foreign_keys')
   * @param {string|number} [value] - Value to set (optional)
   * @returns {Promise<any>} Pragma result or null
   *
   * @example
   *   await adapter.pragma('foreign_keys', 'ON');
   *   const mode = await adapter.pragma('journal_mode');  // Returns current value
   */
  async pragma(key, value) {
    throw new Error('Not implemented: pragma(key, value)');
  }

  /**
   * Return the SQL dialect identifier for this adapter.
   *
   * @returns {string} Either 'sqlite' or 'postgresql'
   */
  getDialect() {
    throw new Error('Not implemented: getDialect()');
  }
}
