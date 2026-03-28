/**
 * server/api/sectionGovernanceRoutes.js
 * ----------------------------------------
 * Express Router for section governance endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   GET    /governance/sections/:caseId                    — all section governance metadata
 *   GET    /governance/sections/:caseId/:sectionId         — single section governance detail
 *   POST   /governance/sections/:caseId/:sectionId/invalidate — mark section stale
 *   POST   /governance/sections/:caseId/invalidate-downstream — cascade invalidation
 *   GET    /governance/freshness/:caseId                   — freshness summary
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { validateBody, validateParams } from '../middleware/validateRequest.js';
import {
  getSectionGovernanceMetadata,
  getSingleSectionGovernance,
  getSectionDependencyGraph,
  markSectionStale,
  invalidateDownstream,
  getFreshnessSummary,
} from '../sectionFactory/sectionGovernanceService.js';

const router = Router();

// ── Zod Validation Schemas ────────────────────────────────────────────────────
const caseIdSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
});

const caseIdSectionIdSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
  sectionId: z.string().min(1, 'sectionId is required'),
});

const invalidateSectionBodySchema = z.object({
  reason: z.string().optional(),
});

const invalidateDownstreamBodySchema = z.object({
  sectionId: z.string().min(1, 'sectionId is required in body'),
  formType: z.string().default('1004'),
});

// ── GET /governance/sections/:caseId ──────────────────────────────────────────
router.get('/governance/sections/:caseId', validateParams(caseIdSchema), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const sections = getSectionGovernanceMetadata(caseId);
    const graph = getSectionDependencyGraph(caseId);
    res.json({
      ok: true,
      caseId,
      sections,
      dependencyGraph: graph,
      count: sections.length,
    });
  } catch (err) {
    log.error('api:governance-sections', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /governance/sections/:caseId/:sectionId ───────────────────────────────
router.get('/governance/sections/:caseId/:sectionId', validateParams(caseIdSectionIdSchema), (req, res) => {
  try {
    const { caseId, sectionId } = req.validatedParams;
    const section = getSingleSectionGovernance(caseId, sectionId);
    if (!section) {
      return res.status(404).json({
        ok: false,
        error: `No governance data found for case="${caseId}" section="${sectionId}"`,
      });
    }
    res.json({ ok: true, section });
  } catch (err) {
    log.error('api:governance-section-detail', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /governance/sections/:caseId/:sectionId/invalidate ───────────────────
router.post('/governance/sections/:caseId/:sectionId/invalidate', validateParams(caseIdSectionIdSchema), validateBody(invalidateSectionBodySchema), (req, res) => {
  try {
    const { caseId, sectionId } = req.validatedParams;
    const reason = req.validated?.reason || 'manual_invalidation';
    const result = markSectionStale(caseId, sectionId, reason);
    res.json({ ok: result.ok, caseId, sectionId, reason, updated: result.updated });
  } catch (err) {
    log.error('api:governance-invalidate', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /governance/sections/:caseId/invalidate-downstream ───────────────────
router.post('/governance/sections/:caseId/invalidate-downstream', validateParams(caseIdSchema), validateBody(invalidateDownstreamBodySchema), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const { sectionId: changedSectionId, formType } = req.validated;
    const result = invalidateDownstream(caseId, changedSectionId, formType);
    res.json({
      ok: result.ok,
      caseId,
      changedSectionId,
      invalidated: result.invalidated,
      count: result.invalidated.length,
    });
  } catch (err) {
    log.error('api:governance-invalidate-downstream', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /governance/freshness/:caseId ─────────────────────────────────────────
router.get('/governance/freshness/:caseId', validateParams(caseIdSchema), (req, res) => {
  try {
    const { caseId } = req.validatedParams;
    const summary = getFreshnessSummary(caseId);
    res.json({ ok: true, ...summary });
  } catch (err) {
    log.error('api:governance-freshness', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
