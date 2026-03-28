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
import { emitCaseEvent } from '../operations/auditLogger.js';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';

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

import {
  getRevisionDiffs,
  getDiffStats,
} from '../learning/revisionDiffService.js';

import {
  recordSuggestionOutcome,
  getSuggestionHistory,
  getSuggestionAcceptanceRate,
  getRankedSuggestions,
} from '../learning/suggestionRankingService.js';

import {
  getInfluenceExplanation,
  getCaseLearningReport,
} from '../learning/learningExplanationService.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

// URL params schemas
const caseIdParamsSchema = z.object({
  caseId: z.string().min(1),
});

const archiveIdParamsSchema = z.object({
  archiveId: z.string().min(1),
});

const patternIdParamsSchema = z.object({
  patternId: z.string().min(1),
});

const applicationIdParamsSchema = z.object({
  id: z.string().min(1),
});

const sectionIdParamsSchema = z.object({
  sectionId: z.string().min(1),
});

// Request body schemas
const archiveBodySchema = z.object({
  autoLearn: z.boolean().optional(),
}).passthrough();

const applyPatternBodySchema = z.object({
  caseId: z.string().min(1).max(80),
  appliedContext: z.string().max(4000).optional(),
}).passthrough();

const applicationOutcomeBodySchema = z.object({
  outcome: z.enum(['accepted', 'rejected', 'ignored']),
}).passthrough();

const feedbackLinkBodySchema = z.object({
  sectionId: z.string().min(1).max(80),
  formType: z.string().min(1).max(40),
  generatedSectionId: z.string().max(80).optional(),
  propertyType: z.string().max(60).optional(),
  marketArea: z.string().max(200).optional(),
}).passthrough();

const batchSuccessRatesBodySchema = z.object({
  patternIds: z.array(z.string().max(80)).min(1),
}).passthrough();

const suggestionOutcomeBodySchema = z.object({
  caseId: z.string().min(1).max(80),
  suggestionId: z.string().optional(),
  sectionId: z.string().min(1).max(80),
}).passthrough();

// Query params schemas
const listPatternsQuerySchema = z.object({
  patternType: z.string().optional(),
  archiveId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const similarAssignmentsQuerySchema = z.object({
  propertyType: z.string().optional(),
  marketArea: z.string().optional(),
  formType: z.string().optional(),
  estimatedValue: z.coerce.number().positive().optional(),
  priceRangeLow: z.coerce.number().positive().optional(),
  priceRangeHigh: z.coerce.number().positive().optional(),
  maxResults: z.coerce.number().int().min(1).max(100).default(5),
});

const learningEnhancedSuggestionsQuerySchema = z.object({
  formType: z.string().optional(),
  propertyType: z.string().optional(),
  marketArea: z.string().optional(),
});

const acceptanceRateQuerySchema = z.object({
  sectionId: z.string().optional(),
  suggestionType: z.string().optional(),
  formType: z.string().optional(),
  propertyType: z.string().optional(),
});

const rankedSuggestionsQuerySchema = z.object({
  formType: z.string().optional(),
  propertyType: z.string().optional(),
});

const influenceQuerySchema = z.object({
  formType: z.string().optional(),
  propertyType: z.string().optional(),
});

const router = Router();

// ── POST /cases/:caseId/archive ──────────────────────────────────────────────
// Archive a completed assignment, capturing its full final state.
router.post(
  '/cases/:caseId/archive',
  validateParams(caseIdParamsSchema),
  validateBody(archiveBodySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const result = archiveCompletedAssignment(caseId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      // Optionally auto-learn patterns from the archive
      let learningResult = null;
      if (req.validated?.autoLearn !== false) {
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

      emitCaseEvent(caseId, 'learning.archived', 'Assignment archived for learning', {
        archiveId: result.id,
        autoLearn: req.validated?.autoLearn !== false,
        patternsCreated: learningResult?.patternsCreated || 0,
      });

      res.json({
        ok: true,
        archive: result,
        learning: learningResult,
        feedbackLoop: feedbackResult,
      });
    } catch (err) {
      log.error('api:archive-assignment', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /cases/:caseId/archive ───────────────────────────────────────────────
// Retrieve the archive for a specific case.
router.get(
  '/cases/:caseId/archive',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const archive = getArchiveByCaseId(caseId);

      if (!archive) {
        return res.status(404).json({ ok: false, error: `No archive found for case ${caseId}` });
      }

      res.json({ ok: true, archive });
    } catch (err) {
      log.error('api:get-archive', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/patterns ───────────────────────────────────────────────────
// List all learned patterns with optional filters.
router.get(
  '/learning/patterns',
  validateQuery(listPatternsQuerySchema),
  (req, res) => {
    try {
      const filters = {
        patternType: req.validatedQuery.patternType || undefined,
        archiveId: req.validatedQuery.archiveId || undefined,
        limit: req.validatedQuery.limit,
        offset: req.validatedQuery.offset,
      };

      const patterns = listPatterns(filters);
      res.json({ ok: true, patterns, count: patterns.length });
    } catch (err) {
      log.error('api:list-patterns', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/similar-assignments ────────────────────────────────────────
// Find prior assignments similar to a given context.
router.get(
  '/learning/similar-assignments',
  validateQuery(similarAssignmentsQuerySchema),
  (req, res) => {
    try {
      const context = {
        propertyType: req.validatedQuery.propertyType || undefined,
        marketArea: req.validatedQuery.marketArea || undefined,
        formType: req.validatedQuery.formType || undefined,
        estimatedValue: req.validatedQuery.estimatedValue || undefined,
        priceRangeLow: req.validatedQuery.priceRangeLow || undefined,
        priceRangeHigh: req.validatedQuery.priceRangeHigh || undefined,
        maxResults: req.validatedQuery.maxResults,
      };

      const result = findSimilarAssignments(context);
      res.json({ ok: true, ...result });
    } catch (err) {
      log.error('api:similar-assignments', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /cases/:caseId/learning/suggestions ──────────────────────────────────
// Get learning-enhanced suggestions for a case.
router.get(
  '/cases/:caseId/learning/suggestions',
  validateParams(caseIdParamsSchema),
  validateQuery(learningEnhancedSuggestionsQuerySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const context = {
        formType: req.validatedQuery.formType || undefined,
        propertyType: req.validatedQuery.propertyType || undefined,
        marketArea: req.validatedQuery.marketArea || undefined,
      };

      const suggestions = getLearningEnhancedSuggestions(caseId, context);
      res.json({ ok: true, suggestions, count: suggestions.length });
    } catch (err) {
      log.error('api:learning-suggestions', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /learning/learn/:archiveId ──────────────────────────────────────────
// Extract patterns from an existing archive.
router.post(
  '/learning/learn/:archiveId',
  validateParams(archiveIdParamsSchema),
  (req, res) => {
    try {
      const { archiveId } = req.validatedParams;
      const result = learnFromArchive(archiveId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true, ...result });
    } catch (err) {
      log.error('api:learn-from-archive', { archiveId: req.validatedParams?.archiveId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /learning/patterns/:patternId/apply ─────────────────────────────────
// Record that a pattern was applied in a new assignment.
router.post(
  '/learning/patterns/:patternId/apply',
  validateParams(patternIdParamsSchema),
  validateBody(applyPatternBodySchema),
  (req, res) => {
    try {
      const { patternId } = req.validatedParams;
      const body = req.validated;

      const result = recordPatternApplication({
        patternId,
        caseId: body.caseId,
        appliedContext: body.appliedContext || 'manual application',
      });

      res.json({ ok: true, applicationId: result.id });
    } catch (err) {
      log.error('api:apply-pattern', { patternId: req.validatedParams?.patternId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /learning/applications/:id/outcome ──────────────────────────────────
// Record the outcome of a pattern application.
router.post(
  '/learning/applications/:id/outcome',
  validateParams(applicationIdParamsSchema),
  validateBody(applicationOutcomeBodySchema),
  (req, res) => {
    try {
      const { id } = req.validatedParams;
      const body = req.validated;

      recordApplicationOutcome(id, body.outcome);
      res.json({ ok: true, applicationId: id, outcome: body.outcome });
    } catch (err) {
      log.error('api:application-outcome', { id: req.validatedParams?.id, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /cases/:caseId/feedback-loop/link ───────────────────────────────────
// Link a generation to relevant learned patterns.
router.post(
  '/cases/:caseId/feedback-loop/link',
  validateParams(caseIdParamsSchema),
  validateBody(feedbackLinkBodySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const body = req.validated;

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
      log.error('api:feedback-loop-link', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /cases/:caseId/feedback-loop/close ──────────────────────────────────
// Manually close all pending feedback loops for a case.
router.post(
  '/cases/:caseId/feedback-loop/close',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const result = closeFeedbackLoop(caseId);
      res.json({ ok: true, ...result });
    } catch (err) {
      log.error('api:feedback-loop-close', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/patterns/:patternId/success-rate ───────────────────────────
// Get the success rate for a specific pattern.
router.get(
  '/learning/patterns/:patternId/success-rate',
  validateParams(patternIdParamsSchema),
  (req, res) => {
    try {
      const { patternId } = req.validatedParams;
      const result = getPatternSuccessRate(patternId);
      res.json({ ok: true, ...result });
    } catch (err) {
      log.error('api:pattern-success-rate', { patternId: req.validatedParams?.patternId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /learning/patterns/success-rates ────────────────────────────────────
// Get success rates for multiple patterns (batch).
router.post(
  '/learning/patterns/success-rates',
  validateBody(batchSuccessRatesBodySchema),
  (req, res) => {
    try {
      const body = req.validated;

      const result = getBatchPatternSuccessRates(body.patternIds);
      res.json({ ok: true, rates: result });
    } catch (err) {
      log.error('api:batch-success-rates', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/revision-diffs/:caseId ─────────────────────────────────────
// Get all revision diffs for a case.
router.get(
  '/learning/revision-diffs/:caseId',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const diffs = getRevisionDiffs(caseId);
      res.json({ ok: true, diffs, count: diffs.length });
    } catch (err) {
      log.error('api:revision-diffs', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/revision-diffs/:caseId/stats ──────────────────────────────
// Get revision diff stats for a case.
router.get(
  '/learning/revision-diffs/:caseId/stats',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const stats = getDiffStats(caseId);
      res.json({ ok: true, stats });
    } catch (err) {
      log.error('api:revision-diff-stats', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── POST /learning/suggestion-outcome ────────────────────────────────────────
// Record a suggestion outcome (accepted/rejected/modified).
router.post(
  '/learning/suggestion-outcome',
  validateBody(suggestionOutcomeBodySchema),
  (req, res) => {
    try {
      const body = req.validated;
      const { caseId, suggestionId, sectionId, ...outcome } = body;

      const result = recordSuggestionOutcome(caseId, suggestionId, { sectionId, ...outcome });
      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, outcome: result });
    } catch (err) {
      log.error('api:suggestion-outcome', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/suggestion-history/:caseId ─────────────────────────────────
// Get all suggestion outcomes for a case.
router.get(
  '/learning/suggestion-history/:caseId',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const history = getSuggestionHistory(caseId);
      res.json({ ok: true, history, count: history.length });
    } catch (err) {
      log.error('api:suggestion-history', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/acceptance-rate ────────────────────────────────────────────
// Get suggestion acceptance rate with optional filters.
router.get(
  '/learning/acceptance-rate',
  validateQuery(acceptanceRateQuerySchema),
  (req, res) => {
    try {
      const filters = {
        sectionId: req.validatedQuery.sectionId || undefined,
        suggestionType: req.validatedQuery.suggestionType || undefined,
        formType: req.validatedQuery.formType || undefined,
        propertyType: req.validatedQuery.propertyType || undefined,
      };
      const rate = getSuggestionAcceptanceRate(filters);
      res.json({ ok: true, ...rate });
    } catch (err) {
      log.error('api:acceptance-rate', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/ranked-suggestions/:sectionId ──────────────────────────────
// Get historically-ranked suggestions for a section.
router.get(
  '/learning/ranked-suggestions/:sectionId',
  validateParams(sectionIdParamsSchema),
  validateQuery(rankedSuggestionsQuerySchema),
  (req, res) => {
    try {
      const { sectionId } = req.validatedParams;
      const formType = req.validatedQuery.formType || undefined;
      const context = {
        propertyType: req.validatedQuery.propertyType || undefined,
      };
      const ranked = getRankedSuggestions(sectionId, formType, context);
      res.json({ ok: true, suggestions: ranked, count: ranked.length });
    } catch (err) {
      log.error('api:ranked-suggestions', { sectionId: req.validatedParams?.sectionId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/influence/:sectionId ───────────────────────────────────────
// Get learned influence explanation for a section.
router.get(
  '/learning/influence/:sectionId',
  validateParams(sectionIdParamsSchema),
  validateQuery(influenceQuerySchema),
  (req, res) => {
    try {
      const { sectionId } = req.validatedParams;
      const formType = req.validatedQuery.formType || undefined;
      const propertyType = req.validatedQuery.propertyType || undefined;
      const explanation = getInfluenceExplanation(sectionId, formType, propertyType);
      res.json({ ok: true, ...explanation });
    } catch (err) {
      log.error('api:influence-explanation', { sectionId: req.validatedParams?.sectionId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── GET /learning/case-report/:caseId ────────────────────────────────────────
// Get full case learning report.
router.get(
  '/learning/case-report/:caseId',
  validateParams(caseIdParamsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const report = getCaseLearningReport(caseId);
      res.json({ ok: true, report });
    } catch (err) {
      log.error('api:case-learning-report', { caseId: req.validatedParams?.caseId, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
