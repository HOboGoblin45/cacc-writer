/**
 * server/db/tenancy/UserDbBridge.js
 * ---------------------------------
 * Backward-compatibility bridge for migrating from per-user SQLite to multi-tenancy.
 *
 * Maps the old pattern:
 *   const db = getUserDb(userId);
 *   db.prepare(sql).run(...);
 *
 * To the new tenant-aware pattern:
 *   const db = await getDb();
 *   await db.run(sql, ...);
 *
 * Allows gradual migration — old code keeps working while new code uses async adapters.
 *
 * Usage:
 *   import { createUserDbBridge } from './UserDbBridge.js';
 *
 *   // During migration phase
 *   const db = createUserDbBridge(tenantAwareAdapter);
 *   db.prepare(sql).run(...); // Still works, but uses new adapter
 */

import { getCurrentTenantId, hasTenantContext } from './TenantContext.js';
import log from '../../logger.js';

/**
 * Statement wrapper for compatibility with better-sqlite3 prepare() API.
 *
 * @private
 */
class BridgeStatement {
  /**
   * @param {string} sql - SQL query string
   * @param {DatabaseAdapter} adapter - Tenant-aware adapter
   */
  constructor(sql, adapter) {
    this.sql = sql;
    this.adapter = adapter;
  }

  /**
   * Run an INSERT/UPDATE/DELETE synchronously (fake).
   * Internally uses async adapter.
   *
   * NOTE: This is synchronous-looking but actually returns a promise.
   * For true compatibility, the caller should handle as async.
   *
   * @param {...any} params
   * @returns {{ changes: number, lastInsertRowid: number }}
   */
  run(...params) {
    // TODO: In production, this should be async-wrapped by the calling code
    // For now, log a warning
    if (!process.env.SUPPRESS_SYNC_DB_WARNING) {
      log.warn('tenant:bridge-sync-call', {
        sql: this.sql.substring(0, 50),
        paramCount: params.length,
      });
    }

    // Fallback: attempt synchronous call if adapter supports it
    if (this.adapter.baseAdapter?.prepare) {
      return this.adapter.baseAdapter.prepare(this.sql).run(...params);
    }

    throw new Error(
      'Bridge: run() requires async adapter. ' +
      'Use await db.run(sql, params) instead.'
    );
  }

  /**
   * Run a SELECT returning first row synchronously.
   * For compatibility with prepare().get().
   *
   * @param {...any} params
   * @returns {any | undefined}
   */
  get(...params) {
    if (this.adapter.baseAdapter?.prepare) {
      return this.adapter.baseAdapter.prepare(this.sql).get(...params);
    }

    throw new Error(
      'Bridge: get() requires async adapter. ' +
      'Use await db.get(sql, params) instead.'
    );
  }

  /**
   * Run a SELECT returning all rows synchronously.
   * For compatibility with prepare().all().
   *
   * @param {...any} params
   * @returns {any[]}
   */
  all(...params) {
    if (this.adapter.baseAdapter?.prepare) {
      return this.adapter.baseAdapter.prepare(this.sql).all(...params);
    }

    throw new Error(
      'Bridge: all() requires async adapter. ' +
      'Use await db.all(sql, params) instead.'
    );
  }
}

/**
 * Create a bridge adapter that wraps a tenant-aware adapter.
 * Provides better-sqlite3-compatible API for gradual migration.
 *
 * @param {TenantAwareAdapter} tenantAwareAdapter
 * @returns {object} Bridge object with prepare(), exec(), transaction(), etc.
 *
 * @example
 *   const adapter = new TenantAwareAdapter(postgresAdapter);
 *   const db = createUserDbBridge(adapter);
 *
 *   // Old-style code (still works during migration)
 *   const stmt = db.prepare('SELECT * FROM cases WHERE id = ?');
 *   const row = stmt.get(caseId);
 *
 *   // But should migrate to async:
 *   const row = await adapter.get('SELECT * FROM cases WHERE id = $1', [caseId]);
 */
export function createUserDbBridge(tenantAwareAdapter) {
  return {
    /**
     * Prepare a statement (compatibility with better-sqlite3).
     * Returns a statement wrapper.
     *
     * @param {string} sql
     * @returns {BridgeStatement}
     */
    prepare(sql) {
      return new BridgeStatement(sql, tenantAwareAdapter);
    },

    /**
     * Execute raw SQL (compatibility with better-sqlite3).
     * Bypasses tenant context — use sparingly.
     *
     * @param {string} sql
     */
    exec(sql) {
      return tenantAwareAdapter.exec(sql);
    },

    /**
     * Run a function within a transaction.
     *
     * @param {Function} fn
     * @returns {Promise<any>}
     */
    transaction(fn) {
      return tenantAwareAdapter.transaction(fn);
    },

    /**
     * Pragma (SQLite-specific, no-op for PostgreSQL).
     *
     * @param {string} key
     * @param {any} value
     */
    pragma(key, value) {
      if (value !== undefined) {
        log.debug('tenant:bridge-pragma-ignored', { key, value });
      }
      // No-op for PostgreSQL
    },

    /**
     * Access the underlying tenant-aware adapter for async operations.
     *
     * @returns {TenantAwareAdapter}
     */
    getAdapter() {
      return tenantAwareAdapter;
    },
  };
}

/**
 * Drop-in replacement for getUserDb() during migration.
 * Wraps tenant-aware adapter with compatibility bridge.
 *
 * NOTE: The returned object should be used with async/await in new code.
 *
 * @param {string} userId - User/tenant ID (currently unused, context comes from AsyncLocalStorage)
 * @param {TenantAwareAdapter} tenantAwareAdapter
 * @returns {object} Bridge object
 *
 * @deprecated
 * This is a migration shim. New code should use:
 *   const db = await getDb();
 *   await db.run(sql, params);
 */
export function getUserDbCompat(userId, tenantAwareAdapter) {
  if (!hasTenantContext()) {
    log.warn('tenant:compat-no-context', { userId });
  }

  return createUserDbBridge(tenantAwareAdapter);
}
