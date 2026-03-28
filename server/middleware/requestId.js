/**
 * server/middleware/requestId.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Request ID + correlation tracking middleware.
 *
 * Assigns a unique ID to each incoming request for:
 *   - Log correlation (trace a request through all layers)
 *   - Error reporting (include in error responses)
 *   - AI call tracking (which request triggered which generation)
 *   - Support debugging ("give me your request ID")
 *
 * The ID is either:
 *   - Forwarded from an upstream proxy (X-Request-ID header)
 *   - Generated as a compact UUID-like string
 *
 * The ID is attached to:
 *   - req.id — for use in route handlers
 *   - res X-Request-ID header — for client-side correlation
 */

import { randomBytes } from 'crypto';

/**
 * Generate a compact request ID.
 * Format: timestamp(hex)-random(hex) = ~20 chars
 * Example: "18f3a2b1c-4f8e9a1b2c3d"
 */
function generateRequestId() {
  const timestamp = Date.now().toString(16);
  const random = randomBytes(6).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Request ID middleware.
 *
 * @param {object} [options]
 *   @param {string} [options.header='x-request-id'] — header to read/write
 *   @param {boolean} [options.trustProxy=true] — trust incoming header from proxy
 * @returns {Function} Express middleware
 */
export function requestIdMiddleware(options = {}) {
  const header = options.header || 'x-request-id';
  const trustProxy = options.trustProxy !== false;

  return (req, res, next) => {
    // Use upstream ID if present and trusted, otherwise generate
    const existingId = trustProxy ? req.headers[header] : null;
    const id = (existingId && typeof existingId === 'string' && existingId.length < 128)
      ? existingId
      : generateRequestId();

    // Attach to request
    req.id = id;

    // Echo back in response
    res.setHeader('X-Request-ID', id);

    next();
  };
}

export default requestIdMiddleware;
