/**
 * server/api/pipelineRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-click full report pipeline API.
 *
 * Routes:
 *   POST /pipeline/run              — run full pipeline (order text or case ID)
 *   POST /pipeline/from-pdf         — upload PDF → full pipeline
 *   GET  /pipeline/stages           — list available pipeline stages
 *   POST /cases/:caseId/enrich      — just run market analysis enrichment
 *   POST /cases/:caseId/smart-parse — parse order text into case facts
 */

import { Router } from 'express';
import { runFullPipeline, STAGES } from '../pipeline/fullReportPipeline.js';
import { parseOrderForm, parseAndCreateCase } from '../intake/smartOrderParser.js';
import { analyzeMarket } from '../intelligence/marketAnalyzer.js';
import { authMiddleware } from '../auth/authService.js';
import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import log from '../logger.js';

const router = Router();

// ── GET /pipeline/stages ─────────────────────────────────────────────────────

router.get('/pipeline/stages', (_req, res) => {
  res.json({ ok: true, stages: STAGES });
});

// ── POST /pipeline/run ───────────────────────────────────────────────────────

router.post('/pipeline/run', authMiddleware, async (req, res) => {
  try {
    const { orderText, caseId, formType, skipStages, exportFormat } = req.body || {};
    const userId = req.user?.userId || 'default';

    const result = await runFullPipeline({
      orderText,
      caseId,
      userId,
      options: { formType, skipStages, exportFormat },
      onProgress: (stage, status, data) => {
        log.info('pipeline:progress', { stage, status });
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('pipeline:api-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /pipeline/from-pdf ──────────────────────────────────────────────────

router.post('/pipeline/from-pdf', authMiddleware, upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    filePath = req.file.path;
    const text = await readUploadedFile(filePath);
    const userId = req.user?.userId || 'default';

    const result = await runFullPipeline({
      orderText: text,
      userId,
      options: {
        formType: req.body?.formType,
        skipStages: req.body?.skipStages ? JSON.parse(req.body.skipStages) : [],
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (filePath) cleanupUploadedFile(filePath);
  }
});

// ── POST /cases/:caseId/enrich ───────────────────────────────────────────────

router.post('/cases/:caseId/enrich', authMiddleware, async (req, res) => {
  try {
    const result = await analyzeMarket(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/smart-parse ──────────────────────────────────────────

router.post('/cases/:caseId/smart-parse', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: 'Order text required' });

    const result = await parseOrderForm(text);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
