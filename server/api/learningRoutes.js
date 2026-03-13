/**
 * server/api/learningRoutes.js
 * -------------------------------
 * Phase 11 — Learning System API Routes
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST   /cases/:caseId/archive              — archive a completed assignment
 *   GET    /cases/:caseId/archive               — retrieve archive for a case
 *   GET    /learning/patterns                   — list all learned patterns
 *   GET    /learning/similar-assignments        — find similar prior assignments
 *   GET    /cases/:caseId/learning/suggestions  — get learning-enhanced suggestions
 *   POST   /learning/patterns/:patternId/apply  — record pattern application
 *   POST   /learning/applications/:id/outcome   — record application outcome
 *   POST   /learning/learn/:archiveId           — extract patterns from an archive
 */

import { Router } from 'express';
import log from '../logger.js';

import {
  archiveCompletedAssignment,
  getArchiveByCaseId,
} from '../learning/assignmentArchiveService.js';

import {
  learnFromArchive,
  getRelevantPatterns,
  listPatterns,
  recordPatternApplication,
  recordApplicationOutcome,
} from '../learning/patternLearningService.js';

import {
  findSimilarAssignments,
} from '../learning/priorAssignmentRetrieval.js';

import {
  getLearningEnhancedSuggestions,
} from '../learning/learningBoostProvider.js';

import {
  linkGenerationToPatterns,
  onSectionApproved,
  onSectionRejected,
  getPatternSuccessRate,
  getBatchPatternSuccessRates,
  closeFeedbackLoop,
} from '../learning/feedbackLoopService.js';

import { z } from 'zod';
import { parsePayload } from '../utils/routeUtils.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const archiveSchema = z.object({
  autoLearn: z.boolean().optional(),
}).passthrough();

const applyPatternSchema = z.object({
  caseId: z.string().min(1).max(80),
  appliedContext: z.string().max(4000).optional(),
}).passthrough();

const applicationOutcomeSchema = z.object({
  outcome: z.enum(['accepted', 'rejected', 'ignored']),
}).passthrough();

const feedbackLinkSchema = z.object({
  sectionId: z.string().min(1).max(80),
  formType: z.string().min(1).max(40),
  generatedSectionId: z.string().max(80).optional(),
  propertyType: z.string().max(60).optional(),
  marketArea: z.string().max(200).optional(),
}).passthrough();

const batchSuccessRatesSchema = z.object({
  patternIds: z.array(z.string().max(80)).min(1),
}).passthrough();

const router = Router();

// ── POST /cases/:caseId/archive ──────────────────────────────────────────────
// Archive a completed assignment, capturing its full final state.
router.post('/cases/:caseId/archive', (req, res) => {
  try {
    const { caseId } = req.params;
    const result = archiveCompletedAssignment(caseId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    // Optionally auto-learn patterns from the archive
    let learningResult = null;
    if (req.body?.autoLearn !== false) {
      try {
        learningResult = learnFromArchive(result.id);
      } catch (err) {
        log.warn('learning:auto-learn-failed', { archiveId: result.id, error: err.message });
      }
    }

    // Close all pending feedback loops for this case
    let feedbackResult = null;
    try {
      feedbackResult = closeFeedbackLoop(caseId);
    } catch (err) {
      log.warn('learning:feedback-loop-close-failed', { caseId, error: err.message });
    }

    res.json({
      ok: true,
      archive: result,
      learning: learningResult,
      feedbackLoop: feedbackResult,
    });
  } catch (err) {
    log.error('api:archive-assignment', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/archive ───────────────────────────────────────────────
// Retrieve the archive for a specific case.
router.get('/cases/:caseId/archive', (req, res) => {
  try {
    const { caseId } = req.params;
    const archive = getArchiveByCaseId(caseId);

    if (!archive) {
      return res.status(404).json({ ok: false, error: `No archive found for case ${caseId}` });
    }

    res.json({ ok: true, archive });
  } catch (err) {
    log.error('api:get-archive', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /learning/patterns ───────────────────────────────────────────────────
// List all learned patterns with optional filters.
router.get('/learning/patterns', (req, res) => {
  try {
    const filters = {
      patternType: req.query.patternType || undefined,
      archiveId: req.query.archiveId || undefined,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    };

    const patterns = listPatterns(filters);
    res.json({ ok: true, patterns, count: patterns.length });
  } catch (err) {
    log.error('api:list-patterns', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /learning/similar-assignments ────────────────────────────────────────
// Find prior assignments similar to a given context.
router.get('/learning/similar-assignments', (req, res) => {
  try {
    const context = {
      propertyType: req.query.propertyType || undefined,
      marketArea: req.query.marketArea || undefined,
      formType: req.query.formType || undefined,
      estimatedValue: req.query.estimatedValue
        ? parseFloat(req.query.estimatedValue)
        : undefined,
      priceRangeLow: req.query.priceRangeLow
        ? parseFloat(req.query.priceRangeLow)
        : undefined,
      priceRangeHigh: req.query.priceRangeHigh
        ? parseFloat(req.query.priceRangeHigh)
        : undefined,
      maxResults: req.query.maxResults
        ? parseInt(req.query.maxResults, 10)
        : 5,
    };

    const result = findSimilarAssignments(context);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:similar-assignments', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/learning/suggestions ──────────────────────────────────
// Get learning-enhanced suggestions for a case.
router.get('/cases/:caseId/learning/suggestions', (req, res) => {
  try {
    const { caseId } = req.params;
    const context = {
      formType: req.query.formType || undefined,
      propertyType: req.query.propertyType || undefined,
      marketArea: req.query.marketArea || undefined,
    };

    const suggestions = getLearningEnhancedSuggestions(caseId, context);
    res.json({ ok: true, suggestions, count: suggestions.length });
  } catch (err) {
    log.error('api:learning-suggestions', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /learning/learn/:archiveId ──────────────────────────────────────────
// Extract patterns from an existing archive.
router.post('/learning/learn/:archiveId', (req, res) => {
  try {
    const { archiveId } = req.params;
    const result = learnFromArchive(archiveId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:learn-from-archive', { archiveId: req.params.archiveId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /learning/patterns/:patternId/apply ─────────────────────────────────
// Record that a pattern was applied in a new assignment.
router.post('/learning/patterns/:patternId/apply', (req, res) => {
  try {
    const { patternId } = req.params;
    const body = parsePayload(applyPatternSchema, req.body || {}, res);
    if (!body) return;

    const result = recordPatternApplication({
      patternId,
      caseId: body.caseId,
      appliedContext: body.appliedContext || 'manual application',
    });

    res.json({ ok: true, applicationId: result.id });
  } catch (err) {
    log.error('api:apply-pattern', { patternId: req.params.patternId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /learning/applications/:id/outcome ──────────────────────────────────
// Record the outcome of a pattern application.
router.post('/learning/applications/:id/outcome', (req, res) => {
  try {
    const { id } = req.params;
    const body = parsePayload(applicationOutcomeSchema, req.body || {}, res);
    if (!body) return;

    recordApplicationOutcome(id, body.outcome);
    res.json({ ok: true, applicationId: id, outcome: body.outcome });
  } catch (err) {
    log.error('api:application-outcome', { id: req.params.id, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/feedback-loop/link ───────────────────────────────────
// Link a generation to relevant learned patterns.
router.post('/cases/:caseId/feedback-loop/link', (req, res) => {
  try {
    const { caseId } = req.params;
    const body = parsePayload(feedbackLinkSchema, req.body || {}, res);
    if (!body) return;

    const result = linkGenerationToPatterns({
      caseId,
      sectionId: body.sectionId,
      generatedSectionId: body.generatedSectionId,
      formType: body.formType,
      propertyType: body.propertyType,
      marketArea: body.marketArea,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:feedback-loop-link', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/feedback-loop/close ──────────────────────────────────
// Manually close all pending feedback loops for a case.
router.post('/cases/:caseId/feedback-loop/close', (req, res) => {
  try {
    const { caseId } = req.params;
    const result = closeFeedbackLoop(caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:feedback-loop-close', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /learning/patterns/:patternId/success-rate ───────────────────────────
// Get the success rate for a specific pattern.
router.get('/learning/patterns/:patternId/success-rate', (req, res) => {
  try {
    const { patternId } = req.params;
    const result = getPatternSuccessRate(patternId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:pattern-success-rate', { patternId: req.params.patternId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /learning/patterns/success-rates ────────────────────────────────────
// Get success rates for multiple patterns (batch).
router.post('/learning/patterns/success-rates', (req, res) => {
  try {
    const body = parsePayload(batchSuccessRatesSchema, req.body || {}, res);
    if (!body) return;

    const result = getBatchPatternSuccessRates(body.patternIds);
    res.json({ ok: true, rates: result });
  } catch (err) {
    log.error('api:batch-success-rates', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
