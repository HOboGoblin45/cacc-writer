/**
 * server/db/tenancy/tenantMiddleware.js
 * ------------------------------------
 * Express middleware that sets the tenant context from the authenticated user.
 *
 * Must be applied AFTER authentication middleware (requireAuth).
 * Automatically runs all subsequent handlers within a tenant context.
 *
 * Usage in Express:
 *   import { requireAuth } from './middleware/authMiddleware.js';
 *   import { tenantMiddleware } from './db/tenancy/tenantMiddleware.js';
 *
 *   app.use(requireAuth);
 *   app.use(tenantMiddleware);
 *   // All routes now have tenant context
 */

import { runWithTenant, hasTenantContext } from './TenantContext.js';
import log from '../../logger.js';

/**
 * Express middleware to set tenant context from authenticated user.
 *
 * Extracts userId from req.user (set by requireAuth middleware) and
 * wraps the request handler in a tenant context.
 *
 * For unauthenticated requests (public routes), skips context setup.
 *
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.NextFunction} next
 */
export function tenantMiddleware(req, res, next) {
  // Get userId from authenticated request
  const userId = req.user?.userId;

  // Skip context for unauthenticated requests (public routes)
  if (!userId) {
    return next();
  }

  // Verify userId is a string
  if (typeof userId !== 'string' || userId.length === 0) {
    log.warn('tenant:invalid-userid', {
      path: req.path,
      userId,
      userType: typeof userId,
    });
    return next();
  }

  try {
    // Run the next middleware/handler within tenant context
    runWithTenant(userId, () => {
      next();
    });
  } catch (err) {
    log.error('tenant:middleware-error', {
      path: req.path,
      userId,
      error: err.message,
    });
    // Continue anyway — don't block the request
    next();
  }
}

/**
 * Middleware that enforces tenant context (optional stricter mode).
 * Use this to ensure all handlers have a tenant context.
 *
 * Useful for protecting sensitive routes:
 *   app.use('/api/secure', requireTenantContext);
 *
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.NextFunction} next
 */
export function requireTenantContext(req, res, next) {
  if (!hasTenantContext()) {
    log.warn('tenant:context-required-missing', { path: req.path });
    return res.status(401).json({
      ok: false,
      error: 'Tenant context required — user not authenticated or context not set',
    });
  }
  next();
}

/**
 * Get the current tenant/user ID from the request.
 * Safe wrapper around getCurrentTenantId for use in route handlers.
 *
 * @param {express.Request} req
 * @returns {string | null} User ID if context is set, null otherwise
 *
 * @example
 *   router.get('/cases', (req, res) => {
 *     const userId = getTenantIdFromRequest(req);
 *     if (!userId) return res.status(401).json({ error: 'Not authenticated' });
 *     // userId is set and ready for queries
 *   });
 */
export function getTenantIdFromRequest(req) {
  return req.user?.userId || null;
}
