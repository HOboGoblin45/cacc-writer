/**
 * server/middleware/errorHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Global Express error handler — catches all unhandled errors from route
 * handlers and returns structured JSON responses.
 *
 * Features:
 *   - Maps known error types to proper HTTP status codes
 *   - Sanitizes error details in production (no stack traces leaked)
 *   - Includes request ID for correlation (from requestId middleware)
 *   - Logs structured error context for debugging
 *   - Handles circuit breaker OPEN errors with Retry-After header
 */

import log from '../logger.js';

/**
 * Map of known error codes/names to HTTP status codes.
 */
const ERROR_STATUS_MAP = {
  // Validation / client errors
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,

  // Circuit breaker
  CIRCUIT_OPEN: 503,
  CIRCUIT_HALF_OPEN: 503,

  // Server errors
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

/**
 * Determine the HTTP status code for an error.
 */
function resolveStatus(err) {
  // Explicit status on the error object
  if (err.status && typeof err.status === 'number') return err.status;
  if (err.statusCode && typeof err.statusCode === 'number') return err.statusCode;

  // Known error codes
  if (err.code && ERROR_STATUS_MAP[err.code]) return ERROR_STATUS_MAP[err.code];

  // Zod validation errors
  if (err.name === 'ZodError') return 400;

  // JSON parse errors
  if (err.type === 'entity.parse.failed') return 400;

  // Default
  return 500;
}

/**
 * Build a user-friendly error type string.
 */
function resolveType(err, status) {
  if (err.code && ERROR_STATUS_MAP[err.code]) return err.code.toLowerCase();
  if (err.name === 'ZodError') return 'validation_error';
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  return 'internal_error';
}

/**
 * Global error handler middleware.
 *
 * Must be registered AFTER all routes:
 *   app.use(errorHandler());
 *
 * @param {object} [options]
 *   @param {boolean} [options.includeStack=false] — include stack in response (dev only)
 * @returns {Function} Express error middleware (err, req, res, next)
 */
export function errorHandler(options = {}) {
  const includeStack = options.includeStack ?? (process.env.NODE_ENV !== 'production');

  // Express requires exactly 4 params to identify this as error middleware
  return (err, req, res, _next) => {
    const status = resolveStatus(err);
    const type = resolveType(err, status);
    const requestId = req.id || req.headers?.['x-request-id'] || null;

    // Build response body
    const body = {
      ok: false,
      error: {
        type,
        message: status < 500
          ? (err.message || 'An error occurred')
          : (process.env.NODE_ENV === 'production'
              ? 'Internal server error'
              : (err.message || 'Internal server error')),
        ...(err.code === 'CIRCUIT_OPEN' && { resetIn: err.resetIn }),
        ...(err.name === 'ZodError' && { details: err.errors }),
        ...(includeStack && err.stack && status >= 500 && { stack: err.stack }),
      },
      requestId,
    };

    // Set Retry-After for rate limits and circuit breaker
    if (status === 429 && err.resetIn) {
      res.setHeader('Retry-After', err.resetIn);
    }
    if (err.code === 'CIRCUIT_OPEN' && err.resetIn) {
      res.setHeader('Retry-After', err.resetIn);
    }

    // Log the error
    const logPayload = {
      status,
      type,
      message: err.message,
      requestId,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.userId,
      ip: req.ip,
    };

    if (status >= 500) {
      log.error('http:error', { ...logPayload, stack: err.stack });
    } else if (status === 429) {
      log.warn('http:rate-limited', logPayload);
    } else {
      log.warn('http:client-error', logPayload);
    }

    // Send response (guard against headers already sent)
    if (!res.headersSent) {
      res.status(status).json(body);
    }
  };
}

/**
 * Async route wrapper — catches promise rejections and forwards to error handler.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 *
 * @param {Function} fn — async route handler
 * @returns {Function} wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      // If fn returns a promise, catch rejections
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Create an error with a specific HTTP status code.
 *
 * @param {number} status
 * @param {string} message
 * @param {string} [code]
 * @returns {Error}
 */
export function createHttpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

export default { errorHandler, asyncHandler, createHttpError };
