/**
 * server/utils/middleware.js
 * ---------------------------
 * Shared Express middleware for route modules.
 *
 * Exports:
 *   upload    — multer instance (memory storage, 50 MB limit)
 *   ensureAI  — middleware that rejects requests when OpenAI client is unavailable
 */

import multer from 'multer';
import { client } from '../openaiClient.js';

// ── File upload middleware ────────────────────────────────────────────────────

/**
 * upload
 * Multer instance configured for in-memory storage.
 * Used by routes that accept PDF or document uploads.
 *
 * Limits:
 *   fileSize: 50 MB — sufficient for multi-page appraisal PDFs
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
});

// ── AI availability guard ─────────────────────────────────────────────────────

/**
 * ensureAI(req, res, next)
 * Middleware that returns 503 if the OpenAI client is not initialized.
 * Apply to any route that calls callAI() or uses the OpenAI client directly.
 *
 * @param {import('express').Request}  _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function ensureAI(_req, res, next) {
  if (!client) {
    return res.status(503).json({
      ok:    false,
      error: 'OpenAI client is not initialized. Set OPENAI_API_KEY in .env',
    });
  }
  next();
}
