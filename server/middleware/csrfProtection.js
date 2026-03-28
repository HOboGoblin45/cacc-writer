/**
 * server/middleware/csrfProtection.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CSRF protection for the SPA authentication flow.
 *
 * Uses the double-submit cookie pattern:
 *   1. Server sets a random CSRF token in a cookie (csrfToken)
 *   2. Client reads the cookie and includes it in X-CSRF-Token header
 *   3. Server validates that the header matches the cookie
 *
 * Why double-submit cookie?
 *   - Stateless (no server-side storage needed)
 *   - Works with SPA architecture (token read from cookie via JS)
 *   - Compatible with JWT auth (no session required)
 *
 * Skip conditions:
 *   - GET, HEAD, OPTIONS requests (safe methods)
 *   - Webhook endpoints (use their own signature verification)
 *   - API key authentication (external integrations)
 */

import { randomBytes } from 'crypto';
import log from '../logger.js';

const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32; // bytes → 64 hex chars

// Routes that should skip CSRF validation
const SKIP_PATHS = new Set([
  '/api/billing/webhook',      // Stripe webhook (has its own signature)
  '/api/auth/login',           // Login doesn't have a CSRF token yet
  '/api/auth/register',        // Registration doesn't have a token yet
  '/api/auth/forgot-password', // Public endpoint
  '/api/auth/reset-password',  // Token-based auth (reset token)
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Generate a new CSRF token.
 * @returns {string} hex-encoded random token
 */
export function generateCsrfToken() {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * CSRF protection middleware.
 *
 * @param {object} [options]
 *   @param {boolean} [options.enabled=true] — set false to disable (dev mode)
 *   @param {Set<string>} [options.skipPaths] — additional paths to skip
 * @returns {Function} Express middleware
 */
export function csrfProtection(options = {}) {
  const enabled = options.enabled !== false;
  const extraSkips = options.skipPaths || new Set();

  return (req, res, next) => {
    if (!enabled) return next();

    // Always set CSRF cookie if not present
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
      const token = generateCsrfToken();
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,  // JS needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });
    }

    // Skip validation for safe methods
    if (SAFE_METHODS.has(req.method)) return next();

    // Skip validation for whitelisted paths
    if (SKIP_PATHS.has(req.path) || extraSkips.has(req.path)) return next();

    // Skip for API key auth (external integrations)
    if (req.headers['x-api-key']) return next();

    // Validate: header must match cookie
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      log.warn('csrf:rejected', {
        method: req.method,
        path: req.path,
        requestId: req.id,
        hasCookie: Boolean(cookieToken),
        hasHeader: Boolean(headerToken),
      });

      return res.status(403).json({
        ok: false,
        error: {
          type: 'csrf_validation_failed',
          message: 'CSRF token validation failed. Please refresh the page and try again.',
        },
        requestId: req.id || null,
      });
    }

    next();
  };
}

/**
 * Endpoint to get a fresh CSRF token.
 * Call this on page load to initialize the CSRF flow.
 *
 * GET /api/auth/csrf-token
 */
export function csrfTokenEndpoint(req, res) {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({ ok: true, csrfToken: token });
}

export default { csrfProtection, csrfTokenEndpoint, generateCsrfToken };
