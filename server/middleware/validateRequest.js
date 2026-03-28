/**
 * server/middleware/validateRequest.js
 * ---------------------------------------------------------------------------
 * Shared Zod validation middleware factory.
 *
 * Usage:
 *   import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
 *   import { z } from 'zod';
 *
 *   const schema = z.object({ name: z.string().min(1) });
 *   router.post('/thing', validateBody(schema), handler);
 */

import { z } from 'zod';

/**
 * Validate req.body against a Zod schema.
 * Returns 400 with structured errors on failure.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: 'Validation failed',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validated = result.data;
    next();
  };
}

/**
 * Validate req.params against a Zod schema.
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid URL parameters',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validatedParams = result.data;
    next();
  };
}

/**
 * Validate req.query against a Zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid query parameters',
        details: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

/**
 * Common reusable Zod schemas for shared patterns.
 */
export const CommonSchemas = {
  /** Standard case ID parameter */
  caseId: z.object({ caseId: z.string().min(1) }),

  /** Pagination query params */
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),

  /** Standard ID parameter */
  id: z.object({ id: z.string().min(1) }),
};
