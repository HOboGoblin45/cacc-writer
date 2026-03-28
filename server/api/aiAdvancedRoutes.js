/**
 * server/api/aiAdvancedRoutes.js
 * Advanced AI routes: rewrite, comp narratives, deep QC.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { rewriteSection, generateVariations, applyRewrite, notesToNarrative, REWRITE_MODES } from '../ai/narrativeRewriter.js';
import { generateCompDiscussion } from '../ai/compNarrativeGenerator.js';
import { deepQcReview } from '../ai/deepQcReviewer.js';

const router = Router();

/**
 * Zod schemas for request validation
 */
const RewriteSectionBody = z.object({
  mode: z.string().optional(),
  style: z.string().optional(),
  tone: z.string().optional(),
});

const CaseAndSectionParams = CommonSchemas.caseId.merge(
  z.object({ sectionId: z.string().min(1) })
);

const VariationsBody = z.object({
  count: z.number().int().min(1).max(10).default(3),
});

const ApplyRewriteBody = z.object({
  text: z.string().min(1),
});

const NotesToNarrativeBody = z.object({
  notes: z.string().min(1),
});

// GET /ai/rewrite-modes — available rewrite modes
router.get('/ai/rewrite-modes', (_req, res) => {
  res.json({ ok: true, modes: Object.entries(REWRITE_MODES).map(([k, v]) => ({ id: k, ...v })) });
});

// POST /cases/:caseId/sections/:sectionId/rewrite — rewrite a section
router.post(
  '/cases/:caseId/sections/:sectionId/rewrite',
  authMiddleware,
  validateParams(CaseAndSectionParams),
  validateBody(RewriteSectionBody),
  async (req, res) => {
    try {
      const result = await rewriteSection(
        req.validatedParams.caseId,
        req.validatedParams.sectionId,
        req.validated
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// POST /cases/:caseId/sections/:sectionId/variations — generate multiple versions
router.post(
  '/cases/:caseId/sections/:sectionId/variations',
  authMiddleware,
  validateParams(CaseAndSectionParams),
  validateBody(VariationsBody),
  async (req, res) => {
    try {
      const result = await generateVariations(
        req.validatedParams.caseId,
        req.validatedParams.sectionId,
        req.validated.count
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// POST /cases/:caseId/sections/:sectionId/apply-rewrite — save rewritten text
router.post(
  '/cases/:caseId/sections/:sectionId/apply-rewrite',
  authMiddleware,
  validateParams(CaseAndSectionParams),
  validateBody(ApplyRewriteBody),
  (req, res) => {
    try {
      const result = applyRewrite(
        req.validatedParams.caseId,
        req.validatedParams.sectionId,
        req.validated.text
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// POST /cases/:caseId/sections/:sectionId/from-notes — voice notes to narrative
router.post(
  '/cases/:caseId/sections/:sectionId/from-notes',
  authMiddleware,
  validateParams(CaseAndSectionParams),
  validateBody(NotesToNarrativeBody),
  async (req, res) => {
    try {
      const result = await notesToNarrative(
        req.validatedParams.caseId,
        req.validatedParams.sectionId,
        req.validated.notes
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// POST /cases/:caseId/comp-discussion — generate comp analysis narratives
router.post(
  '/cases/:caseId/comp-discussion',
  authMiddleware,
  validateParams(CommonSchemas.caseId),
  async (req, res) => {
    try {
      const result = await generateCompDiscussion(req.validatedParams.caseId, req.user.userId);
      if (result.error) return res.status(400).json({ ok: false, error: result.error });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// POST /cases/:caseId/deep-qc — AI deep quality review
router.post(
  '/cases/:caseId/deep-qc',
  authMiddleware,
  validateParams(CommonSchemas.caseId),
  async (req, res) => {
    try {
      const result = await deepQcReview(req.validatedParams.caseId);
      if (result.error) return res.status(400).json({ ok: false, error: result.error });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
