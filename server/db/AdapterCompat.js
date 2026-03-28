/**
 * server/db/AdapterCompat.js
 * =========================
 * Compatibility shim for gradual migration from better-sqlite3 to DatabaseAdapter.
 *
 * Creates a better-sqlite3-compatible wrapper around a DatabaseAdapter.
 * This allows existing synchronous repository code to work with the new adapter
 * without immediate conversion of all 173+ files.
 *
 * How it works:
 *   - For SQLite adapters, we expose the internal _db object for direct sync access
 *   - This preserves the existing sync patterns during migration
 *   - New code should use the adapter directly with async/await
 *
 * Usage:
 *   import { createSyncCompat } from './AdapterCompat.js';
 *   import { SQLiteAdapter } from './adapters/SQLiteAdapter.js';
 *
 *   const adapter = new SQLiteAdapter();
 *   await adapter.connect({ filename: './data/cacc.db' });
 *
 *   // Old code pattern — still works:
 *   const db = createSyncCompat(adapter);
 *   db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
 *
 *   // New code pattern — use directly:
 *   const row = await adapter.get('SELECT * FROM cases WHERE id = ?', [caseId]);
 *
 * @module AdapterCompat
 */

import log from '../logger.js';

/**
 * Create a better-sqlite3-compatible wrapper around a DatabaseAdapter.
 * Only works with SQLite adapters that expose the internal _db object.
 *
 * For SQLite: returns the wrapped sync API
 * For PostgreSQL: throws an error (async required)
 *
 * @param {DatabaseAdapter} adapter - The adapter to wrap
 * @returns {object} A better-sqlite3-compatible wrapper
 * @throws {Error} If adapter is not a SQLiteAdapter with internal _db
 *
 * @example
 *   const syncDb = createSyncCompat(adapter);
 *   const result = syncDb.prepare('INSERT INTO ...').run(...);
 *   const row = syncDb.prepare('SELECT ...').get(...);
 */
export function createSyncCompat(adapter) {
  if (!adapter) {
    throw new Error('Adapter is required');
  }

  // Check if this is a SQLiteAdapter with internal sync access
  if (!adapter._db) {
    const dialect = adapter.getDialect?.() || 'unknown';
    throw new Error(
      `Sync compat only works with SQLite adapter. Got: ${dialect}. ` +
      `Use async adapter methods directly: await adapter.run(), await adapter.get(), etc.`
    );
  }

  /**
   * Statement wrapper for prepare().run().get().all() pattern
   * Delegates to the internal sync better-sqlite3 db object
   */
  class CompatStatement {
    constructor(sql, db) {
      this.sql = sql;
      this.db = db;
    }

    run(...params) {
      return this.db.prepare(this.sql).run(...params);
    }

    get(...params) {
      return this.db.prepare(this.sql).get(...params);
    }

    all(...params) {
      return this.db.prepare(this.sql).all(...params);
    }
  }

  return {
    /**
     * Prepare a statement (compatibility with better-sqlite3)
     * @param {string} sql
     * @returns {CompatStatement}
     */
    prepare(sql) {
      return new CompatStatement(sql, adapter._db);
    },

    /**
     * Execute raw SQL statements (DDL)
     * @param {string} sql
     */
    exec(sql) {
      return adapter._db.exec(sql);
    },

    /**
     * Run a function within a transaction
     * @param {Function} fn
     * @returns {any}
     */
    transaction(fn) {
      const txFn = adapter._db.transaction(fn);
      return txFn();
    },

    /**
     * Execute a PRAGMA statement
     * @param {string} key
     * @param {any} [value]
     * @returns {any}
     */
    pragma(key, value) {
      if (value !== undefined) {
        return adapter._db.pragma(`${key} = ${value}`);
      }
      return adapter._db.pragma(key);
    },

    /**
     * Get the underlying better-sqlite3 database object
     * Use only when compat is insufficient
     * @returns {import('better-sqlite3').Database}
     */
    _getInternalDb() {
      return adapter._db;
    },
  };
}

export default { createSyncCompat };
