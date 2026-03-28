/**
 * server/utils/middleware.js
 * ---------------------------
 * Shared Express middleware for route modules.
 *
 * Exports:
 *   upload    — multer instance (memory storage, 50 MB limit)
 *   ensureAI  — middleware that rejects requests when OpenAI client is unavailable
 */

import fs from 'fs';
import path from 'path';
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
const UPLOAD_TEMP_DIR = path.join(process.cwd(), 'temp', 'uploads');

function ensureUploadTempDir() {
  fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
  return UPLOAD_TEMP_DIR;
}

export const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        cb(null, ensureUploadTempDir());
      } catch (err) {
        cb(err);
      }
    },
    filename(_req, file, cb) {
      const ext = path.extname(String(file?.originalname || '')).toLowerCase();
      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `${token}${ext}`);
    },
  }),
  limits:  { fileSize: 100 * 1024 * 1024 },
});

export async function readUploadedFile(file, encoding = null) {
  if (!file?.path) {
    return encoding ? '' : Buffer.alloc(0);
  }
  if (encoding) {
    return fs.promises.readFile(file.path, { encoding });
  }
  return fs.promises.readFile(file.path);
}

export async function cleanupUploadedFile(file) {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn('upload temp cleanup failed:', err?.message || err);
    }
  }
}

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
