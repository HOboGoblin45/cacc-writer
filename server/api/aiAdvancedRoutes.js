/**
 * server/api/aiAdvancedRoutes.js
 * Advanced AI routes: rewrite, comp narratives, deep QC.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { rewriteSection, generateVariations, applyRewrite, notesToNarrative, REWRITE_MODES } from '../ai/narrativeRewriter.js';
import { generateCompDiscussion } from '../ai/compNarrativeGenerator.js';
import { deepQcReview } from '../ai/deepQcReviewer.js';

const router = Router();

// GET /ai/rewrite-modes — available rewrite modes
router.get('/ai/rewrite-modes', (_req, res) => {
  res.json({ ok: true, modes: Object.entries(REWRITE_MODES).map(([k, v]) => ({ id: k, ...v })) });
});

// POST /cases/:caseId/sections/:sectionId/rewrite — rewrite a section
router.post('/cases/:caseId/sections/:sectionId/rewrite', authMiddleware, async (req, res) => {
  try {
    const result = await rewriteSection(req.params.caseId, req.params.sectionId, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/sections/:sectionId/variations — generate multiple versions
router.post('/cases/:caseId/sections/:sectionId/variations', authMiddleware, async (req, res) => {
  try {
    const result = await generateVariations(req.params.caseId, req.params.sectionId, req.body.count);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/sections/:sectionId/apply-rewrite — save rewritten text
router.post('/cases/:caseId/sections/:sectionId/apply-rewrite', authMiddleware, (req, res) => {
  try {
    const result = applyRewrite(req.params.caseId, req.params.sectionId, req.body.text);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/sections/:sectionId/from-notes — voice notes to narrative
router.post('/cases/:caseId/sections/:sectionId/from-notes', authMiddleware, async (req, res) => {
  try {
    const result = await notesToNarrative(req.params.caseId, req.params.sectionId, req.body.notes);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/comp-discussion — generate comp analysis narratives
router.post('/cases/:caseId/comp-discussion', authMiddleware, async (req, res) => {
  try {
    const result = await generateCompDiscussion(req.params.caseId, req.user.userId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/deep-qc — AI deep quality review
router.post('/cases/:caseId/deep-qc', authMiddleware, async (req, res) => {
  try {
    const result = await deepQcReview(req.params.caseId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
