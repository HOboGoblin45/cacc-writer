/**
 * server/api/insertionRoutes.js
 * --------------------------------
 * Phase 9: REST endpoints for Destination Automation.
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import {
  getInsertionRun,
  getInsertionRunItem,
  listInsertionRuns,
  getInsertionRunItems,
  updateInsertionRun,
  updateInsertionRunItem,
  bulkUpdateItemStatus,
  listDestinationProfiles,
  getDestinationProfile,
  updateDestinationProfile,
  getItemHistoryForField,
  getLatestInsertionRun,
} from '../insertion/insertionRepo.js';
import { prepareInsertionRun, executeInsertionRun } from '../insertion/insertionRunEngine.js';
import { resolveAllMappings, buildMappingPreview, inferTargetSoftware } from '../insertion/destinationMapper.js';
import { getDb } from '../db/database.js';

const router = Router();

const insertionConfigSchema = z.object({
  dryRun: z.boolean().optional(),
  verifyAfter: z.boolean().optional(),
  skipQcBlockers: z.boolean().optional(),
  requireQcRun: z.boolean().optional(),
  requireFreshQcForGeneration: z.boolean().optional(),
  forceReinsert: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  defaultFallback: z.enum(['retry', 'clipboard', 'manual_prompt', 'retry_then_clipboard']).optional(),
  fieldIds: z.array(z.string().min(1)).max(200).optional(),
}).catchall(z.unknown());

const prepareInsertionSchema = z.object({
  caseId: z.string().trim().min(1, 'caseId is required'),
  formType: z.string().trim().min(1, 'formType is required'),
  targetSoftware: z.string().trim().min(1).optional(),
  generationRunId: z.string().trim().min(1).optional(),
  config: insertionConfigSchema.optional(),
});

const runInsertionSchema = prepareInsertionSchema;
const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().min(1).max(600).optional(),
  active: z.boolean().optional(),
  supportsReadback: z.boolean().optional(),
  supportsRichText: z.boolean().optional(),
  supportsPartialRetry: z.boolean().optional(),
  supportsAppendMode: z.boolean().optional(),
  requiresFocusTarget: z.boolean().optional(),
  config: z.union([z.string(), z.record(z.unknown())]).optional(),
  configJson: z.union([z.string(), z.record(z.unknown())]).optional(),
}).passthrough().refine(
  payload => Object.keys(payload || {}).length > 0,
  { message: 'At least one profile field is required' },
);

function sendError(res, status, code, error, extra = {}) {
  res.status(status).json({
    ok: false,
    code,
    error,
    ...extra,
  });
  return null;
}

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  return sendError(res, 400, 'INVALID_PAYLOAD', 'Invalid request payload', {
    issues: parsed.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

router.post('/insertion/prepare', (req, res) => {
  try {
    const body = parsePayload(prepareInsertionSchema, req.body || {}, res);
    if (!body) return;
    const { caseId, formType, targetSoftware, generationRunId, config } = body;

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
      blocked: !result.qcGate.passed,
      overrideAllowed: result.qcGate.overrideAllowed !== false,
      profile: result.profile,
      totalFields: result.items.length,
    });
  } catch (err) {
    log.error('insertion:prepare', { error: err.message });
    sendError(res, 500, 'INSERTION_PREPARE_FAILED', err.message);
  }
});

router.post('/insertion/execute/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    const run = getInsertionRun(runId);

    if (!run) {
      return sendError(res, 404, 'INSERTION_RUN_NOT_FOUND', 'Insertion run not found');
    }

    if (run.status !== 'queued' && run.status !== 'preparing') {
      return sendError(
        res,
        400,
        'INSERTION_RUN_INVALID_STATUS',
        `Cannot execute run in status '${run.status}' - must be 'queued' or 'preparing'`,
      );
    }

    res.json({ runId, status: 'started', message: 'Insertion run started' });

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
    sendError(res, 500, 'INSERTION_EXECUTE_FAILED', err.message);
  }
});

router.post('/insertion/run', async (req, res) => {
  try {
    const body = parsePayload(runInsertionSchema, req.body || {}, res);
    if (!body) return;
    const { caseId, formType, targetSoftware, generationRunId, config } = body;

    const prepared = prepareInsertionRun({
      caseId,
      formType,
      targetSoftware,
      generationRunId,
      config: config || {},
    });

    const canBypassQcGate = !!(config || {}).skipQcBlockers && prepared.qcGate.overrideAllowed !== false;

    if (!prepared.qcGate.passed && !canBypassQcGate) {
      return res.json({
        run: prepared.run,
        qcGate: prepared.qcGate,
        blocked: true,
        overrideAllowed: prepared.qcGate.overrideAllowed !== false,
        message: prepared.qcGate.overrideAllowed === false
          ? 'QC gate blocked insertion - run QC for this generation before insertion'
          : 'QC gate blocked insertion - review qcGate details or set skipQcBlockers',
      });
    }

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
    sendError(res, 500, 'INSERTION_EXECUTE_FAILED', err.message);
  }
});

router.get('/insertion/runs/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    const runs = listInsertionRuns(caseId, { limit });
    res.json({ runs });
  } catch (err) {
    sendError(res, 500, 'INSERTION_LIST_RUNS_FAILED', err.message);
  }
});

router.get('/insertion/run/:runId', (req, res) => {
  try {
    const run = getInsertionRun(req.params.runId);
    if (!run) return sendError(res, 404, 'INSERTION_RUN_NOT_FOUND', 'Run not found');
    res.json({ run });
  } catch (err) {
    sendError(res, 500, 'INSERTION_GET_RUN_FAILED', err.message);
  }
});

router.get('/insertion/run/:runId/items', (req, res) => {
  try {
    const items = getInsertionRunItems(req.params.runId);
    res.json({ items });
  } catch (err) {
    sendError(res, 500, 'INSERTION_GET_ITEMS_FAILED', err.message);
  }
});

router.post('/insertion/run/:runId/cancel', (req, res) => {
  try {
    const run = getInsertionRun(req.params.runId);
    if (!run) return sendError(res, 404, 'INSERTION_RUN_NOT_FOUND', 'Run not found');

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return sendError(
        res,
        400,
        'INSERTION_RUN_INVALID_STATUS',
        `Cannot cancel run in status '${run.status}'`,
      );
    }

    const cancelled = bulkUpdateItemStatus(run.id, 'queued', 'skipped');

    updateInsertionRun(run.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    res.json({ message: `Run cancelled. ${cancelled} queued items skipped.` });
  } catch (err) {
    sendError(res, 500, 'INSERTION_CANCEL_FAILED', err.message);
  }
});

router.post('/insertion/retry/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const item = getInsertionRunItem(itemId);
    if (!item) {
      return sendError(res, 404, 'INSERTION_ITEM_NOT_FOUND', 'Insertion run item not found');
    }

    if (item.status !== 'failed' && item.status !== 'skipped') {
      return sendError(
        res,
        400,
        'INSERTION_ITEM_NOT_RETRYABLE',
        `Cannot retry item in status '${item.status}'`,
      );
    }

    updateInsertionRunItem(itemId, {
      status: 'queued',
      errorCode: null,
      errorText: null,
      attemptCount: 0,
      verificationStatus: 'pending',
    });

    res.json({ message: 'Item reset for retry', itemId });
  } catch (err) {
    sendError(res, 500, 'INSERTION_RETRY_FAILED', err.message);
  }
});

router.get('/insertion/preview/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    const formType = req.query.formType || '1004';
    const targetSoftware = req.query.targetSoftware || inferTargetSoftware(formType);

    const db = getDb();
    const fieldTexts = new Map();
    const previousStatuses = new Map();

    const rows = db.prepare(
      `SELECT section_id, draft_text, reviewed_text, final_text, approved
       FROM generated_sections WHERE case_id = ? AND form_type = ?
       ORDER BY created_at DESC`
    ).all(caseId, formType);

    for (const row of rows) {
      if (!fieldTexts.has(row.section_id)) {
        const text = row.final_text || row.reviewed_text || row.draft_text || '';
        if (text.trim()) fieldTexts.set(row.section_id, text);
      }
    }

    const latestRun = getLatestInsertionRun(caseId);
    if (latestRun) {
      const items = getInsertionRunItems(latestRun.id);
      for (const item of items) {
        previousStatuses.set(item.fieldId, item.status);
      }
    }

    const preview = buildMappingPreview(formType, targetSoftware, fieldTexts, previousStatuses);
    preview.caseId = caseId;

    res.json({ preview });
  } catch (err) {
    sendError(res, 500, 'INSERTION_PREVIEW_FAILED', err.message);
  }
});

router.get('/insertion/mappings/:formType', (req, res) => {
  try {
    const { formType } = req.params;
    const targetSoftware = req.query.targetSoftware || inferTargetSoftware(formType);
    const mappings = resolveAllMappings(formType, targetSoftware);
    res.json({ mappings, formType, targetSoftware });
  } catch (err) {
    sendError(res, 500, 'INSERTION_MAPPINGS_FAILED', err.message);
  }
});

router.get('/insertion/profiles', (req, res) => {
  try {
    const activeOnly = req.query.activeOnly !== 'false';
    const profiles = listDestinationProfiles({ activeOnly });
    res.json({ profiles });
  } catch (err) {
    sendError(res, 500, 'INSERTION_LIST_PROFILES_FAILED', err.message);
  }
});

router.get('/insertion/profile/:id', (req, res) => {
  try {
    const profile = getDestinationProfile(req.params.id);
    if (!profile) return sendError(res, 404, 'INSERTION_PROFILE_NOT_FOUND', 'Profile not found');
    res.json({ profile });
  } catch (err) {
    sendError(res, 500, 'INSERTION_GET_PROFILE_FAILED', err.message);
  }
});

router.put('/insertion/profile/:id', (req, res) => {
  try {
    const body = parsePayload(updateProfileSchema, req.body || {}, res);
    if (!body) return;
    const updates = { ...body };
    if (updates.config !== undefined && updates.configJson === undefined) {
      updates.configJson = updates.config;
    }
    delete updates.config;
    updateDestinationProfile(req.params.id, updates);
    const profile = getDestinationProfile(req.params.id);
    if (!profile) return sendError(res, 404, 'INSERTION_PROFILE_NOT_FOUND', 'Profile not found');
    res.json({ profile });
  } catch (err) {
    sendError(res, 500, 'INSERTION_UPDATE_PROFILE_FAILED', err.message);
  }
});

router.get('/insertion/field-history/:caseId/:fieldId', (req, res) => {
  try {
    const { caseId, fieldId } = req.params;
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5;
    const history = getItemHistoryForField(caseId, fieldId, limit);
    res.json({ history });
  } catch (err) {
    sendError(res, 500, 'INSERTION_FIELD_HISTORY_FAILED', err.message);
  }
});

export default router;
