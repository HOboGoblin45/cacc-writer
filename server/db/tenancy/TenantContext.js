/**
 * server/db/tenancy/TenantContext.js
 * -----------------------------------
 * Thread-local tenant context using AsyncLocalStorage.
 * Enables automatic tenant scoping of all database queries.
 *
 * Usage:
 *   import { runWithTenant, getCurrentTenantId } from './TenantContext.js';
 *
 *   // Set tenant context for a request
 *   runWithTenant(userId, () => {
 *     // All queries within this scope are scoped to userId
 *     const rows = await db.all('SELECT * FROM cases');
 *   });
 *
 *   // In middleware:
 *   export function tenantMiddleware(req, res, next) {
 *     const userId = req.user.id;
 *     runWithTenant(userId, () => {
 *       next();
 *     });
 *   }
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import log from '../../logger.js';

const tenantStorage = new AsyncLocalStorage();

/**
 * Run a function within a tenant context.
 * All database queries within the callback will be scoped to this tenant.
 *
 * @param {string} tenantId - The tenant/user ID
 * @param {Function} fn - Callback to execute within tenant context
 * @returns {any} Return value of fn
 *
 * @example
 *   runWithTenant('user-123', () => {
 *     const cases = await db.all('SELECT * FROM cases');
 *     // RLS policies ensure only user-123's cases are returned
 *   });
 */
export function runWithTenant(tenantId, fn) {
  if (!tenantId) {
    throw new Error('runWithTenant: tenantId is required');
  }
  return tenantStorage.run({ tenantId }, fn);
}

/**
 * Get the current tenant ID from the async context.
 * Throws if no tenant context is active.
 *
 * @returns {string} The current tenant ID
 * @throws {Error} If no tenant context is set
 *
 * @example
 *   const tenantId = getCurrentTenantId();
 *   console.log(tenantId); // 'user-123'
 */
export function getCurrentTenantId() {
  const store = tenantStorage.getStore();
  if (!store?.tenantId) {
    const err = new Error(
      'No tenant context — query rejected. ' +
      'Ensure tenantMiddleware is applied before data access.'
    );
    log.error('tenant:context-missing', { error: err.message });
    throw err;
  }
  return store.tenantId;
}

/**
 * Check if a tenant context is currently active.
 * Safe to use — does not throw.
 *
 * @returns {boolean} True if a tenant context is set
 *
 * @example
 *   if (hasTenantContext()) {
 *     const tenantId = getCurrentTenantId();
 *   }
 */
export function hasTenantContext() {
  return Boolean(tenantStorage.getStore()?.tenantId);
}

/**
 * Get the current tenant context object (for advanced usage).
 * Returns null if no context is active.
 *
 * @returns {{ tenantId: string } | null}
 */
export function getTenantContext() {
  return tenantStorage.getStore() || null;
}
