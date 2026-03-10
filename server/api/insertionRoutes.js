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
import {
  getInsertionRun, listInsertionRuns, getInsertionRunItems,
  updateInsertionRun, updateInsertionRunItem, bulkUpdateItemStatus,
  listDestinationProfiles, getDestinationProfile, updateDestinationProfile,
  getItemHistoryForField, getLatestInsertionRun,
} from '../insertion/insertionRepo.js';
import { prepareInsertionRun, executeInsertionRun } from '../insertion/insertionRunEngine.js';
import { resolveAllMappings, buildMappingPreview, inferTargetSoftware } from '../insertion/destinationMapper.js';
import { getDb } from '../db/database.js';

const router = Router();

// ── Prepare Insertion Run ─────────────────────────────────────────────────────

router.post('/insertion/prepare', (req, res) => {
  try {
    const { caseId, formType, targetSoftware, generationRunId, config } = req.body;

    if (!caseId || !formType) {
      return res.status(400).json({ error: 'caseId and formType are required' });
    }

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
    console.error('[insertion] prepare error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Execute Insertion Run ─────────────────────────────────────────────────────

router.post('/insertion/execute/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    const run = getInsertionRun(runId);

    if (!run) {
      return res.status(404).json({ error: 'Insertion run not found' });
    }

    if (run.status !== 'queued' && run.status !== 'preparing') {
      return res.status(400).json({
        error: `Cannot execute run in status '${run.status}' — must be 'queued'`,
      });
    }

    // Execute asynchronously — return immediately with run ID
    // Client polls for status
    res.json({ runId, status: 'started', message: 'Insertion run started' });

    // Execute in background
    executeInsertionRun(runId).catch(err => {
      console.error(`[insertion] run ${runId} failed:`, err);
      updateInsertionRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        summaryJson: { error: err.message },
      });
    });
  } catch (err) {
    console.error('[insertion] execute error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Prepare + Execute in One Call ─────────────────────────────────────────────

router.post('/insertion/run', async (req, res) => {
  try {
    const { caseId, formType, targetSoftware, generationRunId, config } = req.body;

    if (!caseId || !formType) {
      return res.status(400).json({ error: 'caseId and formType are required' });
    }

    const prepared = prepareInsertionRun({
      caseId,
      formType,
      targetSoftware,
      generationRunId,
      config: config || {},
    });

    // If QC gate blocked and not overridden
    if (!prepared.qcGate.passed && !(config || {}).skipQcBlockers) {
      return res.json({
        run: prepared.run,
        qcGate: prepared.qcGate,
        blocked: true,
        message: 'QC gate blocked insertion — resolve blockers or set skipQcBlockers',
      });
    }

    // Return immediately, execute in background
    res.json({
      runId: prepared.run.id,
      status: 'started',
      totalFields: prepared.items.length,
      qcGate: prepared.qcGate,
    });

    executeInsertionRun(prepared.run.id).catch(err => {
      console.error(`[insertion] run ${prepared.run.id} failed:`, err);
      updateInsertionRun(prepared.run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        summaryJson: { error: err.message },
      });
    });
  } catch (err) {
    console.error('[insertion] run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── List Runs ─────────────────────────────────────────────────────────────────

router.get('/insertion/runs/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const runs = listInsertionRuns(caseId, { limit });
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Run Details ───────────────────────────────────────────────────────────

router.get('/insertion/run/:runId', (req, res) => {
  try {
    const run = getInsertionRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Run Items ─────────────────────────────────────────────────────────────

router.get('/insertion/run/:runId/items', (req, res) => {
  try {
    const items = getInsertionRunItems(req.params.runId);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cancel Run ────────────────────────────────────────────────────────────────

router.post('/insertion/run/:runId/cancel', (req, res) => {
  try {
    const run = getInsertionRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

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
});

// ── Retry Single Item ─────────────────────────────────────────────────────────

router.post('/insertion/retry/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    // For now, reset the item status to queued and re-execute
    // Full retry logic would re-run processItem
    updateInsertionRunItem(itemId, {
      status: 'queued',
      errorCode: null,
      errorText: null,
      attemptCount: 0,
      verificationStatus: 'pending',
    });
    res.json({ message: 'Item reset for retry', itemId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mapping Preview ───────────────────────────────────────────────────────────

router.get('/insertion/preview/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    const formType = req.query.formType || '1004';
    const targetSoftware = req.query.targetSoftware || inferTargetSoftware(formType);

    // Gather field texts
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

    // Get previous insertion statuses
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
    res.status(500).json({ error: err.message });
  }
});

// ── Get All Mappings ──────────────────────────────────────────────────────────

router.get('/insertion/mappings/:formType', (req, res) => {
  try {
    const { formType } = req.params;
    const targetSoftware = req.query.targetSoftware || inferTargetSoftware(formType);
    const mappings = resolveAllMappings(formType, targetSoftware);
    res.json({ mappings, formType, targetSoftware });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Destination Profiles ──────────────────────────────────────────────────────

router.get('/insertion/profiles', (req, res) => {
  try {
    const activeOnly = req.query.activeOnly !== 'false';
    const profiles = listDestinationProfiles({ activeOnly });
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/insertion/profile/:id', (req, res) => {
  try {
    const profile = getDestinationProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/insertion/profile/:id', (req, res) => {
  try {
    updateDestinationProfile(req.params.id, req.body);
    const profile = getDestinationProfile(req.params.id);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Field History ─────────────────────────────────────────────────────────────

router.get('/insertion/field-history/:caseId/:fieldId', (req, res) => {
  try {
    const { caseId, fieldId } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    const history = getItemHistoryForField(caseId, fieldId, limit);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
