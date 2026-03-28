/**
 * server/middleware/requestTimeout.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Request timeout middleware — prevents long-running requests from holding
 * connections open indefinitely.
 *
 * Features:
 *   - Configurable timeout per route or globally
 *   - Sends 504 Gateway Timeout with structured error response
 *   - Logs timeout events with request ID for debugging
 *   - Does NOT abort the actual work (AI generation continues in background)
 *   - Skips SSE/streaming responses
 */

import log from '../logger.js';

/**
 * Request timeout middleware factory.
 *
 * @param {number} timeoutMs — timeout in milliseconds (default 120s)
 * @param {object} [options]
 *   @param {string} [options.message] — custom timeout message
 * @returns {Function} Express middleware
 */
export function requestTimeout(timeoutMs = 120_000, options = {}) {
  const message = options.message || 'Request timed out';

  return (req, res, next) => {
    // Skip for SSE/streaming responses
    if (req.headers.accept === 'text/event-stream') {
      return next();
    }

    let timedOut = false;

    // Save original methods BEFORE patching so the timeout handler can use them
    const _origJson = res.json.bind(res);
    const _origSend = res.send.bind(res);

    const timer = setTimeout(() => {
      timedOut = true;

      log.warn('http:timeout', {
        method: req.method,
        url: req.originalUrl,
        requestId: req.id,
        userId: req.user?.userId,
        timeoutMs,
      });

      if (!res.headersSent) {
        res.status(504);
        _origJson({
          ok: false,
          error: {
            type: 'gateway_timeout',
            message,
            timeoutMs,
          },
          requestId: req.id || null,
        });
      }
    }, timeoutMs);

    // Clean up timer when response finishes
    const cleanup = () => clearTimeout(timer);
    res.on('finish', cleanup);
    res.on('close', cleanup);

    // Patch res.json and res.send to skip if already timed out
    // (prevents the route handler from sending a second response after timeout)
    res.json = function(body) {
      if (timedOut) return res;
      return _origJson(body);
    };

    res.send = function(body) {
      if (timedOut) return res;
      return _origSend(body);
    };

    next();
  };
}

/** Shorthand for AI generation routes (3 minute timeout). */
export const aiTimeout = requestTimeout(180_000, {
  message: 'AI generation timed out. The report may still be generating in the background.',
});

/** Shorthand for standard API routes (30 second timeout). */
export const apiTimeout = requestTimeout(30_000, {
  message: 'Request timed out',
});

export default requestTimeout;
