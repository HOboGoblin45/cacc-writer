/**
 * server/utils/routeUtils.js
 * ---------------------------
 * Shared route utilities: schema validation and normalized error responses.
 * Consolidates the parsePayload pattern previously duplicated across 14+ route files.
 */

/**
 * Validate a request payload against a Zod schema.
 * Returns parsed data on success, or sends a 400 response and returns null on failure.
 *
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {*} payload - Request body/query to validate
 * @param {import('express').Response} res - Express response object
 * @returns {*|null} Parsed data or null if validation failed
 */
export function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

/**
 * Send a normalized error response.
 *
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {string} error - Human-readable error message
 * @param {string} [code] - Machine-readable error code
 * @param {Object} [extra] - Additional fields to include in the response
 */
export function sendError(res, status, error, code, extra) {
  const body = { ok: false, error };
  if (code) body.code = code;
  if (extra) Object.assign(body, extra);
  res.status(status).json(body);
}
