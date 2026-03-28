/**
 * server/middleware/authMiddleware.js
 * ------------------------------------
 * Unified authentication middleware (Phase 2 merge).
 *
 * Auth chain (in priority order):
 *   1. JWT token (from Authorization: Bearer header) → full user context
 *   2. API key (from X-API-Key header or ?api_key query) → admin fallback
 *   3. Dev mode bypass (CACC_AUTH_ENABLED=false) → pass-through
 *
 * Populates req.user = { userId, username, role, source } on success.
 * Returns 401 when auth is required but no valid credentials found.
 */

import log from '../logger.js';
import { verifyToken } from '../auth/authService.js';

// ── Configuration ────────────────────────────────────────────────────────────

const AUTH_ENABLED = ['1', 'true', 'yes'].includes(
  String(process.env.CACC_AUTH_ENABLED || '').trim().toLowerCase()
);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Paths that never require auth (health checks, OAuth callbacks, public endpoints)
const BYPASS_PATHS = new Set([
  '/api/health',
  '/api/workflow/health',
  '/api/health/ready',
  '/api/gmail/connect',
  '/api/gmail/callback',
  '/api/mred/callback',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/plans',
  '/api/brain/config',
]);

// Paths that bypass auth if they START with this prefix
const BYPASS_PREFIXES = ['/api/auth/'];

// ── Token Extraction ─────────────────────────────────────────────────────────

function extractToken(req) {
  // Bearer token (JWT or API key)
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return { token: auth.slice(7).trim(), source: 'bearer' };

  // X-API-Key header (legacy)
  const apiKey = req.headers['x-api-key'];
  if (apiKey) return { token: apiKey, source: 'api-key' };

  // Query param (for webhooks)
  if (req.query?.api_key) return { token: req.query.api_key, source: 'query' };

  return null;
}

// ── Main Auth Middleware ─────────────────────────────────────────────────────

/**
 * Unified authentication middleware.
 * Tries JWT first, then API key fallback, then dev-mode bypass.
 */
export function requireAuth(req, res, next) {
  // Always bypass certain paths
  if (BYPASS_PATHS.has(req.path)) return next();
  if (BYPASS_PREFIXES.some(p => req.path.startsWith(p))) return next();

  // In dev mode with auth disabled, pass through with dev user context
  if (!AUTH_ENABLED && !IS_PRODUCTION) {
    req.user = { userId: 'dev-local', username: 'dev', role: 'admin', source: 'dev-bypass' };
    return next();
  }

  // Extract token
  const extracted = extractToken(req);
  if (!extracted) {
    // In non-production with auth disabled, still allow through
    if (!AUTH_ENABLED) {
      req.user = { userId: 'dev-local', username: 'dev', role: 'admin', source: 'dev-bypass' };
      return next();
    }
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Authentication required. Provide Authorization: Bearer <token> header.',
    });
  }

  const { token, source } = extracted;

  // Try JWT verification first
  const decoded = verifyToken(token);
  if (decoded) {
    req.user = {
      userId: decoded.userId || decoded.sub || decoded.id,
      username: decoded.username || decoded.email,
      role: decoded.role || 'appraiser',
      source: 'jwt',
    };
    return next();
  }

  // Fallback: check API key
  const validApiKey = String(process.env.CACC_API_KEY || '').trim();
  if (validApiKey && token === validApiKey) {
    req.user = {
      userId: 'api-key-user',
      username: 'api-key',
      role: 'admin',
      source: 'api-key',
    };
    // Also set legacy field for backward compatibility
    req.authenticatedUser = req.user;
    return next();
  }

  // Token provided but invalid
  return res.status(401).json({
    ok: false,
    code: 'AUTH_INVALID',
    error: 'Invalid or expired token.',
  });
}

/**
 * Role check middleware factory.
 * Usage: router.get('/admin/users', requireRole('admin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!AUTH_ENABLED && !IS_PRODUCTION) return next();
    if (!req.user) {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Not authenticated' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Insufficient permissions' });
    }
    next();
  };
}

export default { requireAuth, requireRole };
