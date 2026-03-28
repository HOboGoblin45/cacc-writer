/**
 * server/api/insertionRoutes.js
 * -------------------------------
 * Phase 9: REST endpoints for Destination Automation.
 *
 * Routes:
 *   POST   /api/insertion/prepare          — Prepare an insertion run (preview + create)
 *   POST   /api/insertion/execute/:runId    — Execute a prepared insertion run
 *   POST   /api/insertion/run               — Prepare + execute in one call
 *   GET    /api/insertion/runs/:caseId      — List insertion runs for a case
 *   GET    /api/insertion/run/:runId        — Get insertion run details
 *   GET    /api/insertion/run/:runId/items  — Get items for a run
 *   POST   /api/insertion/run/:runId/cancel — Cancel a running insertion
 *   POST   /api/insertion/retry/:itemId     — Retry a single failed item
 *
 *   GET    /api/insertion/preview/:caseId   — Preview mapping for a case
 *   GET    /api/insertion/mappings/:formType — Get all mappings for a form type
 *
 *   GET    /api/insertion/profiles          — List destination profiles
 *   GET    /api/insertion/profile/:id       — Get a destination profile
 *   PUT    /api/insertion/profile/:id       — Update a destination profile
 *
 *   GET    /api/insertion/field-history/:caseId/:fieldId — Get insertion history for a field
 */

import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import log from '../logger.js';
import {
  getInsertionRun, listInsertionRuns, getInsertionRunItems,
  updateInsertionRun, updateInsertionRunItem, bulkUpdateItemStatus,
  listDestinationProfiles, getDestinationProfile, updateDestinationProfile,
  getItemHistoryForField, getLatestInsertionRun,
} from '../insertion/insertionRepo.js';
import { prepareInsertionRun, executeInsertionRun } from '../insertion/insertionRunEngine.js';
import { resolveAllMappings, buildMappingPreview, inferTargetSoftware } from '../insertion/destinationMapper.js';
import { getDb } from '../db/database.js';
import { buildFormDraftModel, getFormDraftTextMap } from '../insertion/formDraftModel.js';
import { probeDestinationFields, selectProbeFieldIds } from '../insertion/agentProbe.js';

const router = Router();

// ── Zod Validation Schemas ─────────────────────────────────────────────────────

const insertionConfigSchema = z.object({
  dryRun: z.boolean().optional(),
  verifyAfter: z.boolean().optional(),
  skipQcBlockers: z.boolean().optional(),
  forceReinsert: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  defaultFallback: z.string().max(60).optional(),
  fieldIds: z.array(z.string().max(80)).max(200).optional(),
  requireQcRun: z.boolean().optional(),
  requireFreshQcForGeneration: z.boolean().optional(),
  agentTimeoutMs: z.number().int().min(0).optional(),
}).strict();

const prepareInsertionSchema = z.object({
  caseId: z.string().min(1),
  formType: z.string().min(1).max(40),
  targetSoftware: z.string().max(60).optional(),
  generationRunId: z.string().max(120).optional().nullable(),
  config: insertionConfigSchema.optional(),
});

const prepareInsertionBodySchema = prepareInsertionSchema;

const executeInsertionParamsSchema = z.object({
  runId: z.string().min(1),
});

const executeInsertionBodySchema = z.object({}).strict();

const prepareAndExecuteBodySchema = prepareInsertionSchema;

const listRunsParamsSchema = z.object({
  caseId: z.string().min(1),
});

const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(20).optional(),
});

const getRunParamsSchema = z.object({
  runId: z.string().min(1),
});

const getRunItemsParamsSchema = z.object({
  runId: z.string().min(1),
});

const cancelRunParamsSchema = z.object({
  runId: z.string().min(1),
});

const cancelRunBodySchema = z.object({}).strict();

const retryItemParamsSchema = z.object({
  itemId: z.string().min(1),
});

const retryItemBodySchema = z.object({}).strict();

const mappingPreviewParamsSchema = z.object({
  caseId: z.string().min(1),
});

const mappingPreviewQuerySchema = z.object({
  formType: z.string().min(1).max(40).default('1004').optional(),
  targetSoftware: z.string().max(60).optional(),
  generationRunId: z.string().max(120).optional().nullable(),
});

const draftModelParamsSchema = z.object({
  caseId: z.string().min(1),
});

const draftModelQuerySchema = z.object({
  formType: z.string().min(1).max(40).default('1004').optional(),
  targetSoftware: z.string().max(60).optional(),
  generationRunId: z.string().max(120).optional().nullable(),
});

const probeBodySchema = z.object({
  caseId: z.string().min(1).optional().nullable(),
  formType: z.string().min(1).max(40),
  targetSoftware: z.string().max(60).optional(),
  generationRunId: z.string().min(1).optional().nullable(),
  fieldIds: z.array(z.string().max(80)).max(200).optional().nullable(),
});

const mappingsParamsSchema = z.object({
  formType: z.string().min(1).max(40),
});

const mappingsQuerySchema = z.object({
  targetSoftware: z.string().max(60).optional(),
});

const profilesQuerySchema = z.object({
  activeOnly: z.enum(['true', 'false']).default('true').optional(),
});

const profileParamsSchema = z.object({
  id: z.string().min(1),
});

const profileUpdateSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().max(120).optional(),
  config: z.record(z.unknown()).optional(),
}).passthrough();

const fieldHistoryParamsSchema = z.object({
  caseId: z.string().min(1),
  fieldId: z.string().min(1),
});

const fieldHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(5).optional(),
});

// ── Prepare Insertion Run ─────────────────────────────────────────────────────

router.post('/insertion/prepare', validateBody(prepareInsertionBodySchema), (req, res) => {
  try {
    const { caseId, formType, targetSoftware, generationRunId, config } = req.validated;

    const result = prepareInsertionRun({
      caseId,
      formType,
      targetSoftware,
      generationRunId,
      config: config || {},
    });

    res.json({
      run: result.run,
      items: result.items,
      qcGate: result.qcGate,
      profile: result.profile,
      totalFields: result.items.length,
    });
  } catch (err) {
    log.error('insertion:prepare', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Execute Insertion Run ─────────────────────────────────────────────────────

router.post('/insertion/execute/:runId',
  validateParams(executeInsertionParamsSchema),
  validateBody(executeInsertionBodySchema),
  async (req, res) => {
    try {
      const { runId } = req.validatedParams;
      const run = getInsertionRun(runId);

      if (!run) {
        return res.status(404).json({ ok: false, code: 'INSERTION_RUN_NOT_FOUND', error: 'Insertion run not found' });
      }

      if (run.status !== 'queued' && run.status !== 'preparing') {
        return res.status(400).json({
          ok: false,
          error: `Cannot execute run in status '${run.status}' — must be 'queued'`,
        });
      }

      // Execute asynchronously — return immediately with run ID
      // Client polls for status
      res.json({ runId, status: 'started', message: 'Insertion run started' });

      // Execute in background
      executeInsertionRun(runId).catch(err => {
        log.error('insertion:run-failed', { runId, error: err.message });
        updateInsertionRun(runId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          summaryJson: { error: err.message },
        });
      });
    } catch (err) {
      log.error('insertion:execute', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── Prepare + Execute in One Call ─────────────────────────────────────────────

router.post('/insertion/run', validateBody(prepareAndExecuteBodySchema), async (req, res) => {
  try {
    const { caseId, formType, targetSoftware, generationRunId, config } = req.validated;

    const prepared = prepareInsertionRun({
      caseId,
      formType,
      targetSoftware,
      generationRunId,
      config: config || {},
    });

    // If QC gate blocked — check if override is allowed
    if (!prepared.qcGate.passed) {
      const skipQcBlockers = Boolean((config || {}).skipQcBlockers);
      const overrideAllowed = prepared.qcGate.overrideAllowed !== false;
      if (!skipQcBlockers || !overrideAllowed) {
        return res.json({
          run: prepared.run,
          qcGate: prepared.qcGate,
          blocked: true,
          overrideAllowed,
          message: overrideAllowed
            ? 'QC gate blocked insertion — resolve blockers or set skipQcBlockers'
            : 'QC gate blocked insertion — override not allowed for this gate type',
        });
      }
    }

    // Return immediately, execute in background
    res.json({
      runId: prepared.run.id,
      status: 'started',
      totalFields: prepared.items.length,
      qcGate: prepared.qcGate,
    });

    executeInsertionRun(prepared.run.id).catch(err => {
      log.error('insertion:run-failed', { runId: prepared.run.id, error: err.message });
      updateInsertionRun(prepared.run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        summaryJson: { error: err.message },
      });
    });
  } catch (err) {
    log.error('insertion:run', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── List Runs ─────────────────────────────────────────────────────────────────

router.get('/insertion/runs/:caseId',
  validateParams(listRunsParamsSchema),
  validateQuery(listRunsQuerySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const { limit } = req.validatedQuery;
      const runs = listInsertionRuns(caseId, { limit });
      res.json({ runs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Get Run Details ───────────────────────────────────────────────────────────

router.get('/insertion/run/:runId',
  validateParams(getRunParamsSchema),
  (req, res) => {
    try {
      const { runId } = req.validatedParams;
      const run = getInsertionRun(runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      res.json({ run });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Get Run Items ─────────────────────────────────────────────────────────────

router.get('/insertion/run/:runId/items',
  validateParams(getRunItemsParamsSchema),
  (req, res) => {
    try {
      const { runId } = req.validatedParams;
      const items = getInsertionRunItems(runId);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Cancel Run ────────────────────────────────────────────────────────────────

router.post('/insertion/run/:runId/cancel',
  validateParams(cancelRunParamsSchema),
  validateBody(cancelRunBodySchema),
  (req, res) => {
    try {
      const { runId } = req.validatedParams;
      const run = getInsertionRun(runId);
      if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });

      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return res.status(400).json({ error: `Cannot cancel run in status '${run.status}'` });
      }

      // Cancel remaining queued items
      const cancelled = bulkUpdateItemStatus(run.id, 'queued', 'skipped');

      updateInsertionRun(run.id, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });

      res.json({ message: `Run cancelled. ${cancelled} queued items skipped.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Retry Single Item ─────────────────────────────────────────────────────────

router.post('/insertion/retry/:itemId',
  validateParams(retryItemParamsSchema),
  validateBody(retryItemBodySchema),
  async (req, res) => {
    try {
      const { itemId } = req.validatedParams;

      // Check if the item exists in the DB
      const db = getDb();
      let item = null;
      try {
        item = db.prepare('SELECT * FROM insertion_run_items WHERE id = ? LIMIT 1').get(itemId);
      } catch {
        // Table may not have rows yet
      }

      if (!item) {
        return res.status(404).json({ ok: false, code: 'INSERTION_ITEM_NOT_FOUND', error: 'Insertion item not found' });
      }

      // For now, reset the item status to queued and re-execute
      // Full retry logic would re-run processItem
      updateInsertionRunItem(itemId, {
        status: 'queued',
        errorCode: null,
        errorText: null,
        attemptCount: 0,
        verificationStatus: 'pending',
      });
      res.json({ ok: true, message: 'Item reset for retry', itemId });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── Mapping Preview ───────────────────────────────────────────────────────────

router.get('/insertion/preview/:caseId',
  validateParams(mappingPreviewParamsSchema),
  validateQuery(mappingPreviewQuerySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const { formType, targetSoftware, generationRunId } = req.validatedQuery;
      const effectiveTargetSoftware = targetSoftware || inferTargetSoftware(formType);

      const draftModel = buildFormDraftModel({ caseId, formType, generationRunId, targetSoftware: effectiveTargetSoftware });
      const fieldTexts = getFormDraftTextMap({ caseId, formType, generationRunId, targetSoftware: effectiveTargetSoftware });
      const previousStatuses = new Map(
        draftModel.fields
          .filter(field => field.previousInsertionStatus)
          .map(field => [field.fieldId, field.previousInsertionStatus]),
      );

      const preview = buildMappingPreview(formType, effectiveTargetSoftware, fieldTexts, previousStatuses);
      preview.caseId = caseId;

      res.json({ preview, draftModel });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get('/insertion/draft-model/:caseId',
  validateParams(draftModelParamsSchema),
  validateQuery(draftModelQuerySchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const { formType, targetSoftware, generationRunId } = req.validatedQuery;
      const effectiveTargetSoftware = targetSoftware || inferTargetSoftware(formType);

      const draftModel = buildFormDraftModel({ caseId, formType, generationRunId, targetSoftware: effectiveTargetSoftware });
      res.json({ draftModel });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Probe Destination Fields ───────────────────────────────────────────────────

router.post('/insertion/probe',
  validateBody(probeBodySchema),
  async (req, res) => {
    try {
      const { caseId, formType, targetSoftware, generationRunId, fieldIds } = req.validated;

      const effectiveTargetSoftware = targetSoftware || inferTargetSoftware(formType);
      const probeFieldIds = selectProbeFieldIds({
        caseId,
        formType,
        generationRunId,
        targetSoftware: effectiveTargetSoftware,
        fieldIds,
      });

      const probe = await probeDestinationFields({
        formType,
        targetSoftware: effectiveTargetSoftware,
        fieldIds: probeFieldIds,
      });

      res.json({
        ok: true,
        caseId,
        formType,
        targetSoftware: effectiveTargetSoftware,
        probeFieldIds,
        probe,
      });
    } catch (err) {
      log.error('insertion:probe', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Get All Mappings ──────────────────────────────────────────────────────────

router.get('/insertion/mappings/:formType',
  validateParams(mappingsParamsSchema),
  validateQuery(mappingsQuerySchema),
  (req, res) => {
    try {
      const { formType } = req.validatedParams;
      const { targetSoftware } = req.validatedQuery;
      const effectiveTargetSoftware = targetSoftware || inferTargetSoftware(formType);

      const mappings = resolveAllMappings(formType, effectiveTargetSoftware);
      res.json({ mappings, formType, targetSoftware: effectiveTargetSoftware });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Destination Profiles ──────────────────────────────────────────────────────

router.get('/insertion/profiles',
  validateQuery(profilesQuerySchema),
  (req, res) => {
    try {
      const { activeOnly } = req.validatedQuery;
      const isActiveOnly = activeOnly !== 'false';
      const profiles = listDestinationProfiles({ activeOnly: isActiveOnly });
      res.json({ profiles });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get('/insertion/profile/:id',
  validateParams(profileParamsSchema),
  (req, res) => {
    try {
      const { id } = req.validatedParams;
      const profile = getDestinationProfile(id);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.put('/insertion/profile/:id',
  validateParams(profileParamsSchema),
  validateBody(profileUpdateSchema),
  (req, res) => {
    try {
      const { id } = req.validatedParams;
      const body = req.validated;

      updateDestinationProfile(id, body);
      const profile = getDestinationProfile(id);
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── Field History ─────────────────────────────────────────────────────────────

router.get('/insertion/field-history/:caseId/:fieldId',
  validateParams(fieldHistoryParamsSchema),
  validateQuery(fieldHistoryQuerySchema),
  (req, res) => {
    try {
      const { caseId, fieldId } = req.validatedParams;
      const { limit } = req.validatedQuery;
      const history = getItemHistoryForField(caseId, fieldId, limit);
      res.json({ history });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
