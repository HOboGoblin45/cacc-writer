/**
 * server/utils/responseEnvelope.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Standardized API response envelope.
 *
 * Every JSON response from the API should follow this shape:
 *
 *   Success: { ok: true, data: {...}, meta?: {...} }
 *   Error:   { ok: false, error: { type, message, details? }, requestId? }
 *
 * This module provides helpers to construct consistent responses and an
 * Express middleware that patches res.json to auto-wrap plain objects.
 */

/**
 * Build a success response envelope.
 *
 * @param {*} data — the response payload
 * @param {object} [meta] — optional metadata (pagination, timing, etc.)
 * @returns {{ ok: true, data: *, meta?: object }}
 */
export function success(data, meta) {
  const envelope = { ok: true, data };
  if (meta && Object.keys(meta).length > 0) {
    envelope.meta = meta;
  }
  return envelope;
}

/**
 * Build an error response envelope.
 *
 * @param {string} type — machine-readable error code (e.g. 'validation_error')
 * @param {string} message — human-readable message
 * @param {object} [extras] — additional fields (details, requestId, etc.)
 * @returns {{ ok: false, error: { type: string, message: string, ... } }}
 */
export function failure(type, message, extras = {}) {
  const { requestId, ...rest } = extras;
  const envelope = {
    ok: false,
    error: { type, message, ...rest },
  };
  if (requestId) {
    envelope.requestId = requestId;
  }
  return envelope;
}

/**
 * Send a success response.
 *
 * @param {import('express').Response} res
 * @param {*} data
 * @param {object} [meta]
 * @param {number} [status=200]
 */
export function sendSuccess(res, data, meta, status = 200) {
  res.status(status).json(success(data, meta));
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} type
 * @param {string} message
 * @param {object} [extras]
 */
export function sendError(res, status, type, message, extras = {}) {
  if (!extras.requestId && res.req?.id) {
    extras.requestId = res.req.id;
  }
  res.status(status).json(failure(type, message, extras));
}

/**
 * Common error responses as convenience methods.
 */
export const errors = {
  badRequest: (res, message = 'Bad request', extras) =>
    sendError(res, 400, 'bad_request', message, extras),

  unauthorized: (res, message = 'Authentication required', extras) =>
    sendError(res, 401, 'unauthorized', message, extras),

  forbidden: (res, message = 'Access denied', extras) =>
    sendError(res, 403, 'forbidden', message, extras),

  notFound: (res, message = 'Resource not found', extras) =>
    sendError(res, 404, 'not_found', message, extras),

  conflict: (res, message = 'Resource conflict', extras) =>
    sendError(res, 409, 'conflict', message, extras),

  rateLimit: (res, message = 'Rate limit exceeded', extras) =>
    sendError(res, 429, 'rate_limit_exceeded', message, extras),

  internal: (res, message = 'Internal server error', extras) =>
    sendError(res, 500, 'internal_error', message, extras),

  serviceUnavailable: (res, message = 'Service temporarily unavailable', extras) =>
    sendError(res, 503, 'service_unavailable', message, extras),
};

export default { success, failure, sendSuccess, sendError, errors };
