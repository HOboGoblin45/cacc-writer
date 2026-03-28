/**
 * server/db/tenancy/TenantAwareAdapter.js
 * ----------------------------------------
 * Wraps a database adapter to automatically inject tenant context into queries.
 *
 * For PostgreSQL: Sets session variable 'app.current_tenant_id' before each query.
 * For SQLite: No-op (per-user databases provide isolation automatically).
 *
 * Usage:
 *   import { TenantAwareAdapter } from './TenantAwareAdapter.js';
 *
 *   const baseAdapter = new PostgresAdapter(connectionString);
 *   const adapter = new TenantAwareAdapter(baseAdapter);
 *   await adapter.all('SELECT * FROM cases', []); // tenant_id set automatically
 */

import { getCurrentTenantId } from './TenantContext.js';
import log from '../../logger.js';

export class TenantAwareAdapter {
  /**
   * @param {DatabaseAdapter} baseAdapter - SQLite or PostgreSQL adapter
   */
  constructor(baseAdapter) {
    if (!baseAdapter) {
      throw new Error('TenantAwareAdapter: baseAdapter is required');
    }
    this.baseAdapter = baseAdapter;
  }

  /**
   * Set tenant context in the database session (PostgreSQL only).
   * For PostgreSQL: Executes SET app.current_tenant_id.
   * For SQLite: No-op (isolation via separate files).
   *
   * @private
   * @returns {Promise<void>}
   */
  async _setTenantContext() {
    const tenantId = getCurrentTenantId();

    // Only PostgreSQL supports session variables
    if (this.baseAdapter.getDialect() === 'postgresql') {
      try {
        // Set session variable for RLS policies
        await this.baseAdapter.run(
          "SELECT set_config('app.current_tenant_id', $1, false)",
          [tenantId]
        );
      } catch (err) {
        log.warn('tenant:context-set-failed', {
          dialect: 'postgresql',
          tenantId,
          error: err.message,
        });
        // Continue anyway — query may still work if RLS uses auth context
      }
    }
    // SQLite: per-user database files provide isolation, no need to set context
  }

  /**
   * Execute a SELECT query returning all matching rows.
   * Automatically sets tenant context before execution.
   *
   * @param {string} sql - SQL query
   * @param {any[]} params - Query parameters
   * @returns {Promise<any[]>}
   */
  async all(sql, params = []) {
    await this._setTenantContext();
    return this.baseAdapter.all(sql, params);
  }

  /**
   * Execute a SELECT query returning a single row.
   * Automatically sets tenant context before execution.
   *
   * @param {string} sql - SQL query
   * @param {any[]} params - Query parameters
   * @returns {Promise<any | undefined>}
   */
  async get(sql, params = []) {
    await this._setTenantContext();
    return this.baseAdapter.get(sql, params);
  }

  /**
   * Execute an INSERT / UPDATE / DELETE statement.
   * Automatically sets tenant context before execution.
   *
   * @param {string} sql - SQL query
   * @param {any[]} params - Query parameters
   * @returns {Promise<{ changes: number, lastInsertRowid?: number }>}
   */
  async run(sql, params = []) {
    await this._setTenantContext();
    return this.baseAdapter.run(sql, params);
  }

  /**
   * Execute multiple statements within a single transaction.
   * Tenant context is set once at the start of the transaction.
   *
   * @param {Function} fn - Callback receiving wrapped adapter
   * @returns {Promise<any>}
   */
  async transaction(fn) {
    await this._setTenantContext();
    return this.baseAdapter.transaction(fn);
  }

  /**
   * Execute raw SQL without tenant context (admin operations).
   * Use sparingly — bypasses multi-tenancy.
   *
   * @param {string} sql - SQL query
   * @returns {Promise<void>}
   */
  async exec(sql) {
    return this.baseAdapter.exec(sql);
  }

  /**
   * Check if a table exists.
   *
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    return this.baseAdapter.tableExists(tableName);
  }

  /**
   * Get the database dialect (sqlite or postgresql).
   *
   * @returns {string}
   */
  getDialect() {
    return this.baseAdapter.getDialect();
  }

  /**
   * Initialize the schema (idempotent).
   * Called once at startup.
   *
   * @returns {Promise<void>}
   */
  async initSchema() {
    if (this.baseAdapter.initSchema) {
      return this.baseAdapter.initSchema();
    }
  }

  /**
   * Close the adapter connection.
   * Called on shutdown.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.baseAdapter.close) {
      return this.baseAdapter.close();
    }
  }

  /**
   * Get the underlying base adapter (for advanced use cases).
   *
   * @returns {DatabaseAdapter}
   */
  getBaseAdapter() {
    return this.baseAdapter;
  }
}
