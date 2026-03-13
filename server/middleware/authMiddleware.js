/**
 * server/middleware/authMiddleware.js
 * ------------------------------------
 * Authentication/authorization middleware scaffold.
 *
 * Current mode: single-user (no enforcement).
 * When AUTH_ENABLED=true is set, requires a valid API key via
 * X-API-Key header or Authorization: Bearer <key>.
 *
 * Keys are managed through the security routes / users table.
 */

import log from '../logger.js';

const AUTH_ENABLED = ['1', 'true', 'yes'].includes(
  String(process.env.CACC_AUTH_ENABLED || '').trim().toLowerCase()
);

const BYPASS_PATHS = new Set([
  '/api/health',
  '/api/workflow/health',
  '/api/health/ready',
]);

function extractToken(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) return apiKey;

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();

  return null;
}

/**
 * Authentication middleware.
 * When AUTH_ENABLED is false (default), all requests pass through.
 * When AUTH_ENABLED is true, validates the API key against the users table.
 */
export function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (BYPASS_PATHS.has(req.path)) return next();

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Authentication required. Provide X-API-Key header or Authorization: Bearer <key>.',
    });
  }

  // For now, validate against a simple env-based key
  // Future: validate against users table with hashed keys
  const validKey = process.env.CACC_API_KEY;
  if (!validKey) {
    log.warn('auth:no-key-configured', { path: req.path });
    return next(); // No key configured = pass through
  }

  if (token !== validKey) {
    return res.status(403).json({
      ok: false,
      code: 'AUTH_INVALID',
      error: 'Invalid API key.',
    });
  }

  req.authenticatedUser = { role: 'admin', source: 'api_key' };
  next();
}

/**
 * Role check middleware factory.
 * Only meaningful when auth is enabled.
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (!AUTH_ENABLED) return next();
    if (!req.authenticatedUser) {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Not authenticated' });
    }
    // For now, all authenticated users have admin role
    next();
  };
}

export default { requireAuth, requireRole };
