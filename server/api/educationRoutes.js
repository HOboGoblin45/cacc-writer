/**
 * server/api/educationRoutes.js
 * Onboarding, help, CE credits, license tracking.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { getOnboardingProgress, completeOnboardingStep, askHelp, addCeCredit, getCeSummary, trackLicense } from '../education/learningCenter.js';

const router = Router();

// Zod schemas
const stepIdSchema = z.object({
  stepId: z.string().min(1, 'stepId is required'),
});

const helpSchema = z.object({
  question: z.string().min(1, 'question is required'),
});

const ceCreditSchema = z.object({
  provider: z.string().min(1),
  credits: z.number().positive(),
  expiryDate: z.string().optional(),
});

const licenseSchema = z.object({
  state: z.string().min(2).max(2),
  number: z.string().min(1),
  expiryDate: z.string(),
});

// Validation middleware
const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ ok: false, errors: result.error.errors });
  }
  req.validated = result.data;
  next();
};

const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    return res.status(400).json({ ok: false, errors: result.error.errors });
  }
  req.validatedParams = result.data;
  next();
};

// Onboarding
router.get('/onboarding', authMiddleware, (req, res) => {
  res.json({ ok: true, ...getOnboardingProgress(req.user.userId) });
});

router.post('/onboarding/:stepId', authMiddleware, validateParams(stepIdSchema), (req, res) => {
  const result = completeOnboardingStep(req.user.userId, req.validatedParams.stepId);
  res.json({ ok: true, ...result });
});

// AI Help
router.post('/help', authMiddleware, validateBody(helpSchema), async (req, res) => {
  try {
    const answer = await askHelp(req.validated.question);
    res.json({ ok: true, answer });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// CE Credits
router.get('/ce/summary', authMiddleware, (req, res) => {
  res.json({ ok: true, ...getCeSummary(req.user.userId) });
});

router.post('/ce/credits', authMiddleware, validateBody(ceCreditSchema), (req, res) => {
  try {
    const result = addCeCredit(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// License tracking
router.post('/license', authMiddleware, validateBody(licenseSchema), (req, res) => {
  try {
    const result = trackLicense(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
