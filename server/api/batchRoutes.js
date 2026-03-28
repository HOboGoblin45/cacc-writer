/**
 * server/api/batchRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Batch operations: one-click full report generation, comp analysis.
 *
 * Routes:
 *   POST /cases/:caseId/batch/generate     — generate all sections at once
 *   GET  /cases/:caseId/batch/sections     — list available sections for form type
 *   POST /cases/:caseId/comps/analyze      — AI comp analysis + adjustment suggestions
 *   GET  /cases/:caseId/comps/ranking      — get comp similarity rankings
 */

import { Router } from 'express';
import { z } from 'zod';
import { batchGenerate, getSectionsForForm } from '../generation/batchGenerator.js';
import { analyzeComps, scoreCompSimilarity, suggestAdjustments } from '../comparables/compAnalyzer.js';
import { dbGet } from '../db/database.js';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import log from '../logger.js';

const router = Router();

// ── Zod Validation Schemas ────────────────────────────────────────────────────

/** POST /cases/:caseId/batch/generate body */
const batchGenerateBodySchema = z.object({
  formType: z.string().optional(),
  skipExisting: z.boolean().optional(),
});

/** Path params with caseId */
const caseIdParamsSchema = CommonSchemas.caseId;

/** Query params for batch/sections */
const batchSectionsQuerySchema = z.object({
  formType: z.string().optional(),
});

// Active batch jobs (for SSE progress)
const activeJobs = new Map();

// ── POST /cases/:caseId/batch/generate ───────────────────────────────────────

router.post(
  '/cases/:caseId/batch/generate',
  authMiddleware,
  validateParams(caseIdParamsSchema),
  validateBody(batchGenerateBodySchema),
  async (req, res) => {
    const caseId = req.validatedParams.caseId;
    const { formType, skipExisting } = req.validated || {};
    const userId = req.user?.userId || 'default';

  // Check if already running
  if (activeJobs.has(caseId)) {
    return res.status(409).json({ ok: false, error: 'Batch generation already running for this case' });
  }

  try {
    // Start batch (non-blocking response)
    const jobId = `batch_${caseId}_${Date.now()}`;
    activeJobs.set(caseId, { jobId, status: 'running', startedAt: new Date().toISOString() });

    // Run batch generation
    const result = await batchGenerate(caseId, {
      userId,
      formType,
      skipExisting: skipExisting !== false,
      onProgress: (sectionId, status, data) => {
        const job = activeJobs.get(caseId);
        if (job) {
          job.lastUpdate = { sectionId, status, data, at: new Date().toISOString() };
          if (status === 'complete' || status === 'failed') {
            job.status = status === 'complete' ? 'running' : 'running'; // still running until all done
          }
        }
        if (sectionId === '_batch' && status === 'complete') {
          activeJobs.delete(caseId);
        }
      },
    });

    activeJobs.delete(caseId);
    res.json({ ok: true, ...result });

  } catch (err) {
    activeJobs.delete(caseId);
    log.error('batch:api-error', { caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/batch/sections ────────────────────────────────────────

router.get(
  '/cases/:caseId/batch/sections',
  validateParams(caseIdParamsSchema),
  validateQuery(batchSectionsQuerySchema),
  (req, res) => {
    const caseId = req.validatedParams.caseId;
    const queryData = req.validatedQuery || {};
    const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
    const formType = queryData.formType || caseRecord?.form_type || '1004';
    const sections = getSectionsForForm(formType);
    res.json({ ok: true, formType, sections });
  }
);

// ── POST /cases/:caseId/comps/analyze ────────────────────────────────────────

router.post(
  '/cases/:caseId/comps/analyze',
  authMiddleware,
  validateParams(caseIdParamsSchema),
  async (req, res) => {
    try {
      const caseId = req.validatedParams.caseId;
      const result = await analyzeComps(caseId);
      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      const caseId = req.validatedParams.caseId;
      log.error('comp-analysis:api-error', { caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /cases/:caseId/comps/ranking ─────────────────────────────────────────

router.get(
  '/cases/:caseId/comps/ranking',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const caseId = req.validatedParams.caseId;
      // Lightweight version — just scores, no AI calls
      const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
      const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
      const subject = { ...facts.subject, ...facts.improvements, ...facts.site };

      let comps = [];
      try {
        const { dbAll } = require('../db/database.js');
        comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1', [caseId]);
      } catch { /* ok */ }

      const ranked = comps.map(comp => {
        const data = JSON.parse(comp.candidate_json || '{}');
        return {
          id: comp.id,
          address: data.address || comp.source_key,
          ...scoreCompSimilarity(subject, data),
        };
      }).sort((a, b) => b.totalScore - a.totalScore);

      res.json({ ok: true, comps: ranked });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
