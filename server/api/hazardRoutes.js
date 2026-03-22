/**
 * server/api/hazardRoutes.js
 * Flood zone analysis + natural hazard reporting + ROV endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { analyzeFloodZone, naturalHazardReport } from '../data/floodZoneAnalyzer.js';
import { analyzeRov, generateRovLetter } from '../ai/reconsiderationOfValue.js';

const router = Router();

// POST /flood-analysis — analyze flood zone
router.post('/flood-analysis', authMiddleware, (req, res) => {
  const result = analyzeFloodZone(req.body.address, req.body);
  res.json({ ok: true, ...result });
});

// POST /hazard-report — natural hazard disclosure
router.post('/hazard-report', authMiddleware, (req, res) => {
  const result = naturalHazardReport(req.body.address, req.body);
  res.json({ ok: true, ...result });
});

// POST /cases/:id/rov/analyze — analyze ROV request
router.post('/cases/:id/rov/analyze', authMiddleware, async (req, res) => {
  try {
    const result = await analyzeRov(req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/rov/letter — generate ROV response letter
router.post('/cases/:id/rov/letter', authMiddleware, async (req, res) => {
  try {
    const result = await generateRovLetter(req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
