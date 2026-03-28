/**
 * server/api/revisionRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Revision management routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import {
  createRevisionRequest, generateStipulationResponses,
  resolveStipulation, getRevisionHistory, generateRevisionSummary,
} from '../revisions/revisionTracker.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const caseIdParamsSchema = z.object({
  caseId: z.string().min(1, 'Case ID required'),
});

const revisionIdParamsSchema = z.object({
  caseId: z.string().min(1, 'Case ID required'),
  revisionId: z.string().min(1, 'Revision ID required'),
});

const revisionIdAliasParamsSchema = z.object({
  caseId: z.string().min(1, 'Case ID required'),
  revId: z.string().min(1, 'Revision ID required'),
});

const stipulationParamsSchema = z.object({
  stipId: z.string().min(1, 'Stipulation ID required'),
});

const revisionBodySchema = z.object({}).passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Validation Middleware
// ─────────────────────────────────────────────────────────────────────────────

const validateCaseIdParams = (req, res, next) => {
  try {
    req.validatedParams = caseIdParamsSchema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Params validation failed: ${err.message}` });
  }
};

const validateRevisionIdParams = (req, res, next) => {
  try {
    req.validatedParams = revisionIdParamsSchema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Params validation failed: ${err.message}` });
  }
};

const validateRevisionIdAliasParams = (req, res, next) => {
  try {
    req.validatedParams = revisionIdAliasParamsSchema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Params validation failed: ${err.message}` });
  }
};

const validateStipulationParams = (req, res, next) => {
  try {
    req.validatedParams = stipulationParamsSchema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Params validation failed: ${err.message}` });
  }
};

const validateRevisionBody = (req, res, next) => {
  try {
    req.validatedBody = revisionBodySchema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: `Body validation failed: ${err.message}` });
  }
};

const router = Router();

// GET /cases/:caseId/revisions — revision history
router.get('/cases/:caseId/revisions', authMiddleware, validateCaseIdParams, (req, res) => {
  const history = getRevisionHistory(req.validatedParams.caseId);
  res.json({ ok: true, revisions: history });
});

// POST /cases/:caseId/revisions — create revision request
router.post('/cases/:caseId/revisions', authMiddleware, validateCaseIdParams, validateRevisionBody, (req, res) => {
  try {
    const result = createRevisionRequest(req.validatedParams.caseId, req.validatedBody);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/revisions/:revisionId/ai-respond — AI generate responses
router.post('/cases/:caseId/revisions/:revisionId/ai-respond', authMiddleware, validateRevisionIdParams, async (req, res) => {
  try {
    const result = await generateStipulationResponses(req.validatedParams.caseId, req.validatedParams.revisionId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/revisions/:revId/respond — alias for ai-respond (underwriter condition response)
router.post('/cases/:caseId/revisions/:revId/respond', authMiddleware, validateRevisionIdAliasParams, async (req, res) => {
  try {
    const result = await generateStipulationResponses(req.validatedParams.caseId, req.validatedParams.revId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /stipulations/:stipId/resolve — mark stipulation as resolved
router.patch('/stipulations/:stipId/resolve', authMiddleware, validateStipulationParams, validateRevisionBody, (req, res) => {
  try {
    const result = resolveStipulation(req.validatedParams.stipId, req.validatedBody);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/revisions/summary — revision summary for UCDP
router.get('/cases/:caseId/revisions/summary', authMiddleware, validateCaseIdParams, (req, res) => {
  const summary = generateRevisionSummary(req.validatedParams.caseId);
  res.json({ ok: true, summary });
});

export default router;
