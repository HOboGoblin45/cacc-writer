/**
 * server/api/aiRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered routes: photo analysis, document processing, Gemini features.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { analyzeAndUpdatePhoto, analyzeCasePhotos } from '../ai/photoAnalyzer.js';
import { extractOrderFromPdf, extractCompFromPdf, extractTaxRecord, processAnyDocument } from '../ai/documentProcessor.js';
import { isGeminiConfigured, probeGemini } from '../ai/geminiProvider.js';
import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { validateParams, validateBody } from '../middleware/validateRequest.js';

const router = Router();

// ── Zod schemas ──────────────────────────────────────────────────────────────
const photoIdParam = z.object({ photoId: z.string().min(1, 'photoId is required') });
const caseIdParam = z.object({ caseId: z.string().min(1, 'caseId is required') });
const processDocBody = z.object({
  type: z.enum(['order', 'mls', 'tax', 'survey', 'engagement', 'hoa', 'inspection', 'appraisal', 'general']).default('general'),
}).default({});

// GET /ai/status — check AI providers status
router.get('/ai/status', async (_req, res) => {
  const gemini = await probeGemini().catch(e => ({ configured: false, error: e.message }));
  res.json({
    ok: true,
    gemini,
    features: {
      photoAnalysis: gemini.ready,
      documentProcessing: gemini.ready,
      structuredOutput: gemini.ready,
      multimodal: gemini.ready,
    },
    note: gemini.ready
      ? 'Gemini AI is active — photo analysis, PDF processing, and structured output available'
      : 'Set GEMINI_API_KEY in .env to enable photo AI, document processing, and multimodal features',
  });
});

// POST /ai/photos/:photoId/analyze — analyze a single photo
router.post('/ai/photos/:photoId/analyze', authMiddleware, validateParams(photoIdParam), async (req, res) => {
  try {
    const result = await analyzeAndUpdatePhoto(req.validatedParams.photoId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/ai/analyze-photos — analyze ALL case photos
router.post('/cases/:caseId/ai/analyze-photos', authMiddleware, validateParams(caseIdParam), async (req, res) => {
  try {
    const result = await analyzeCasePhotos(req.validatedParams.caseId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /ai/extract-order — upload PDF order form → structured data
router.post('/ai/extract-order', authMiddleware, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });
    filePath = req.file.path;
    const result = await extractOrderFromPdf(filePath);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (filePath) try { cleanupUploadedFile(filePath); } catch { /* ok */ }
  }
});

// POST /ai/extract-comp — upload MLS sheet → comp data
router.post('/ai/extract-comp', authMiddleware, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });
    filePath = req.file.path;
    const result = await extractCompFromPdf(filePath);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (filePath) try { cleanupUploadedFile(filePath); } catch { /* ok */ }
  }
});

// POST /ai/extract-tax — upload tax record → structured data
router.post('/ai/extract-tax', authMiddleware, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });
    filePath = req.file.path;
    const result = await extractTaxRecord(filePath);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (filePath) try { cleanupUploadedFile(filePath); } catch { /* ok */ }
  }
});

// POST /ai/process-document — general document processing
router.post('/ai/process-document', authMiddleware, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });
    filePath = req.file.path;
    const docType = req.validated?.type || req.body?.type || 'general';
    const result = await processAnyDocument(filePath, docType);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (filePath) try { cleanupUploadedFile(filePath); } catch { /* ok */ }
  }
});

export default router;
