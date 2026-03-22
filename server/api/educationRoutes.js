/**
 * server/api/educationRoutes.js
 * Onboarding, help, CE credits, license tracking.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getOnboardingProgress, completeOnboardingStep, askHelp, addCeCredit, getCeSummary, trackLicense } from '../education/learningCenter.js';

const router = Router();

// Onboarding
router.get('/onboarding', authMiddleware, (req, res) => {
  res.json({ ok: true, ...getOnboardingProgress(req.user.userId) });
});

router.post('/onboarding/:stepId', authMiddleware, (req, res) => {
  const result = completeOnboardingStep(req.user.userId, req.params.stepId);
  res.json({ ok: true, ...result });
});

// AI Help
router.post('/help', authMiddleware, async (req, res) => {
  try {
    const answer = await askHelp(req.body.question || '');
    res.json({ ok: true, answer });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// CE Credits
router.get('/ce/summary', authMiddleware, (req, res) => {
  res.json({ ok: true, ...getCeSummary(req.user.userId) });
});

router.post('/ce/credits', authMiddleware, (req, res) => {
  try {
    const result = addCeCredit(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// License tracking
router.post('/license', authMiddleware, (req, res) => {
  try {
    const result = trackLicense(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
