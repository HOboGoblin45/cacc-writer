/**
 * server/api/hazardRoutes.js
 * Flood zone analysis + natural hazard reporting + ROV endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, CommonSchemas } from '../middleware/validateRequest.js';
import { analyzeFloodZone, naturalHazardReport } from '../data/floodZoneAnalyzer.js';
import { analyzeRov, generateRovLetter } from '../ai/reconsiderationOfValue.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const floodAnalysisSchema = z.object({
  address: z.string().min(1),
}).passthrough();

const hazardReportSchema = z.object({
  address: z.string().min(1),
}).passthrough();

const rovAnalyzeSchema = z.object({
  id: z.string().min(1),
});

const rovDataSchema = z.object({}).passthrough();

// POST /flood-analysis — analyze flood zone
router.post('/flood-analysis', authMiddleware, validateBody(floodAnalysisSchema), (req, res) => {
  const result = analyzeFloodZone(req.validated.address, req.validated);
  res.json({ ok: true, ...result });
});

// POST /hazard-report — natural hazard disclosure
router.post('/hazard-report', authMiddleware, validateBody(hazardReportSchema), (req, res) => {
  const result = naturalHazardReport(req.validated.address, req.validated);
  res.json({ ok: true, ...result });
});

// POST /cases/:id/rov/analyze — analyze ROV request
router.post('/cases/:id/rov/analyze', authMiddleware, validateParams(rovAnalyzeSchema), validateBody(rovDataSchema), async (req, res) => {
  try {
    const result = await analyzeRov(req.validatedParams.id, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/rov/letter — generate ROV response letter
router.post('/cases/:id/rov/letter', authMiddleware, validateParams(rovAnalyzeSchema), validateBody(rovDataSchema), async (req, res) => {
  try {
    const result = await generateRovLetter(req.validatedParams.id, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
