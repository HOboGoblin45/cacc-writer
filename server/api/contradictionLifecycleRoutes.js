/**
 * server/api/contradictionLifecycleRoutes.js
 * ---------------------------------------------
 * Contradiction Resolution Lifecycle Routes
 *
 * Mounted at: /api (in cacc-writer-server.js)
 *
 * Routes:
 *   GET    /contradictions/:caseId              — list all contradictions with resolution status
 *   GET    /contradictions/:caseId/summary       — resolution summary stats
 *   POST   /contradictions/:caseId/:contradictionId/resolve    — resolve a contradiction
 *   POST   /contradictions/:caseId/:contradictionId/dismiss    — dismiss a contradiction
 *   POST   /contradictions/:caseId/:contradictionId/acknowledge — acknowledge a contradiction
 *   POST   /contradictions/:caseId/:contradictionId/reopen     — reopen a contradiction
 *   GET    /contradictions/:caseId/gate-status   — gate check for final review
 *   GET    /contradictions/:caseId/history        — resolution history timeline
 */

import { Router } from 'express';
import log from '../logger.js';

import { buildContradictionGraph } from '../contradictionGraph/contradictionGraphService.js';
import {
  resolveContradiction,
  dismissContradiction,
  acknowledgeContradiction,
  reopenContradiction,
  mergeResolutionStatus,
  buildResolutionSummary,
} from '../contradictionGraph/contradictionResolutionService.js';
import {
  checkContradictionGate,
  getContradictionHistory,
} from '../contradictionGraph/contradictionGateService.js';

const router = Router();

// ── GET /contradictions/:caseId ─────────────────────────────────────────────
// List all contradictions for a case with resolution status merged in.
router.get('/contradictions/:caseId', (req, res) => {
  try {
    const { caseId } = req.params;
    let graphItems = [];
    try {
      const graph = buildContradictionGraph(caseId);
      graphItems = graph?.items || [];
    } catch (err) {
      log.warn('api:contradictions-list-graph-fail', { caseId, error: err.message });
    }

    const merged = mergeResolutionStatus(caseId, graphItems);
    res.json({ ok: true, contradictions: merged, count: merged.length });
  } catch (err) {
    log.error('api:contradictions-list', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /contradictions/:caseId/summary ─────────────────────────────────────
// Get resolution summary for a case.
router.get('/contradictions/:caseId/summary', (req, res) => {
  try {
    const { caseId } = req.params;
    let graphItems = [];
    try {
      const graph = buildContradictionGraph(caseId);
      graphItems = graph?.items || [];
    } catch (err) {
      log.warn('api:contradictions-summary-graph-fail', { caseId, error: err.message });
    }

    const summary = buildResolutionSummary(caseId, graphItems);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:contradictions-summary', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /contradictions/:caseId/:contradictionId/resolve ────────────────────
router.post('/contradictions/:caseId/:contradictionId/resolve', (req, res) => {
  try {
    const { caseId, contradictionId } = req.params;
    const { resolution_type, resolution_note, resolved_by } = req.body || {};
    const result = resolveContradiction(caseId, contradictionId, {
      actor: resolved_by || 'appraiser',
      note: resolution_note || resolution_type || '',
    });
    res.json({ ok: true, resolution: result });
  } catch (err) {
    log.error('api:contradiction-resolve', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /contradictions/:caseId/:contradictionId/dismiss ────────────────────
router.post('/contradictions/:caseId/:contradictionId/dismiss', (req, res) => {
  try {
    const { caseId, contradictionId } = req.params;
    const { reason, dismissed_by } = req.body || {};
    const result = dismissContradiction(caseId, contradictionId, {
      actor: dismissed_by || 'appraiser',
      reason: reason || '',
    });
    res.json({ ok: true, resolution: result });
  } catch (err) {
    log.error('api:contradiction-dismiss', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /contradictions/:caseId/:contradictionId/acknowledge ────────────────
router.post('/contradictions/:caseId/:contradictionId/acknowledge', (req, res) => {
  try {
    const { caseId, contradictionId } = req.params;
    const { note, acknowledged_by } = req.body || {};
    const result = acknowledgeContradiction(caseId, contradictionId, {
      actor: acknowledged_by || 'appraiser',
      note: note || '',
    });
    res.json({ ok: true, resolution: result });
  } catch (err) {
    log.error('api:contradiction-acknowledge', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /contradictions/:caseId/:contradictionId/reopen ─────────────────────
router.post('/contradictions/:caseId/:contradictionId/reopen', (req, res) => {
  try {
    const { caseId, contradictionId } = req.params;
    const { reason, reopened_by } = req.body || {};
    const result = reopenContradiction(caseId, contradictionId, {
      actor: reopened_by || 'appraiser',
      reason: reason || '',
    });
    res.json({ ok: true, resolution: result });
  } catch (err) {
    log.error('api:contradiction-reopen', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /contradictions/:caseId/gate-status ──────────────────────────────────
// Check whether all contradictions are addressed for final review gating.
router.get('/contradictions/:caseId/gate-status', (req, res) => {
  try {
    const { caseId } = req.params;
    const gateResult = checkContradictionGate(caseId);
    res.json({ ok: true, ...gateResult });
  } catch (err) {
    log.error('api:contradiction-gate-status', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /contradictions/:caseId/history ──────────────────────────────────────
// Get resolution history timeline for all contradictions.
router.get('/contradictions/:caseId/history', (req, res) => {
  try {
    const { caseId } = req.params;
    const history = getContradictionHistory(caseId);
    res.json({ ok: true, history, count: history.length });
  } catch (err) {
    log.error('api:contradiction-history', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
