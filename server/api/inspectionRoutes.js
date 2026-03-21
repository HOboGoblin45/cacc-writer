/**
 * server/api/inspectionRoutes.js
 * ---------------------------------
 * Phase 13 — Inspection Workflow REST Endpoints
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST   /cases/:caseId/inspections                              — create inspection
 *   GET    /cases/:caseId/inspections                              — list inspections
 *   GET    /cases/:caseId/inspections/:inspectionId                — get inspection detail
 *   PUT    /cases/:caseId/inspections/:inspectionId                — update inspection
 *   POST   /cases/:caseId/inspections/:inspectionId/start          — start inspection
 *   POST   /cases/:caseId/inspections/:inspectionId/complete       — complete inspection
 *   POST   /cases/:caseId/inspections/:inspectionId/cancel         — cancel inspection
 *   POST   /cases/:caseId/inspections/:inspectionId/reschedule     — reschedule inspection
 *   GET    /cases/:caseId/inspections/:inspectionId/summary        — full inspection summary
 *
 *   POST   /cases/:caseId/inspections/:inspectionId/photos         — add photo
 *   GET    /cases/:caseId/inspections/:inspectionId/photos         — list photos
 *   GET    /cases/:caseId/photos                                   — all case photos
 *   PUT    /cases/:caseId/photos/:photoId                          — update photo
 *   DELETE /cases/:caseId/photos/:photoId                          — delete photo
 *   POST   /cases/:caseId/inspections/:inspectionId/photos/reorder — reorder photos
 *
 *   POST   /cases/:caseId/inspections/:inspectionId/measurements       — add measurement
 *   GET    /cases/:caseId/inspections/:inspectionId/measurements       — list measurements
 *   GET    /cases/:caseId/inspections/:inspectionId/measurements/gla   — calculate GLA
 *   PUT    /cases/:caseId/measurements/:measurementId                  — update measurement
 *   DELETE /cases/:caseId/measurements/:measurementId                  — delete measurement
 *
 *   POST   /cases/:caseId/inspections/:inspectionId/conditions         — add condition
 *   GET    /cases/:caseId/inspections/:inspectionId/conditions         — list conditions
 *   GET    /cases/:caseId/inspections/:inspectionId/conditions/summary — condition summary
 *   PUT    /cases/:caseId/conditions/:conditionId                      — update condition
 *   DELETE /cases/:caseId/conditions/:conditionId                      — delete condition
 */

import { Router } from 'express';
import log from '../logger.js';

import {
  createInspection,
  getInspection,
  listInspections,
  updateInspection,
  startInspection,
  completeInspection,
  cancelInspection,
  rescheduleInspection,
  getInspectionSummary,
} from '../inspection/inspectionService.js';

import {
  addPhoto,
  getPhoto,
  listPhotos,
  listPhotosByCase,
  updatePhoto,
  deletePhoto,
  reorderPhotos,
  setPrimaryPhoto,
  getPhotosByCategory,
  getPhotoManifest,
} from '../inspection/photoService.js';

import {
  addMeasurement,
  getMeasurement,
  listMeasurements,
  updateMeasurement,
  deleteMeasurement,
  calculateGLA,
  calculateTotalArea,
  getLevelBreakdown,
  exportMeasurements,
} from '../inspection/measurementService.js';

import {
  addCondition,
  getCondition,
  listConditions,
  updateCondition,
  deleteCondition,
  getConditionSummary,
  getRepairList,
  getOverallConditionRating,
  linkPhotosToCondition,
  exportConditions,
} from '../inspection/conditionService.js';

import { z } from 'zod';
import { parsePayload } from '../utils/routeUtils.js';

import { sendErrorResponse } from '../utils/errorResponse.js';
const createInspectionSchema = z.object({
  inspectionDate: z.string().max(30).optional(),
  inspectionTime: z.string().max(20).optional(),
  inspectorName: z.string().max(200).optional(),
  inspectionType: z.string().max(60).optional(),
  notes: z.string().max(4000).optional(),
}).passthrough();

const updateInspectionSchema = z.object({}).passthrough();

const completeInspectionSchema = z.object({
  completionNotes: z.string().max(4000).optional(),
}).passthrough();

const rescheduleSchema = z.object({
  newDate: z.string().max(30),
  newTime: z.string().max(20).optional(),
}).passthrough();

const addPhotoSchema = z.object({
  filename: z.string().max(255).optional(),
  category: z.string().max(60).optional(),
  caption: z.string().max(500).optional(),
  data: z.string().optional(),
}).passthrough();

const updatePhotoSchema = z.object({}).passthrough();

const reorderPhotosSchema = z.object({
  category: z.string().max(60).optional(),
  orderedIds: z.array(z.string().max(80)),
}).passthrough();

const addMeasurementSchema = z.object({
  level: z.string().max(60).optional(),
  area_type: z.string().max(60).optional(),
  length: z.number().optional(),
  width: z.number().optional(),
  area: z.number().optional(),
}).passthrough();

const updateMeasurementSchema = z.object({}).passthrough();

const addConditionSchema = z.object({
  category: z.string().max(100).optional(),
  component: z.string().max(200).optional(),
  rating: z.string().max(40).optional(),
  description: z.string().max(2000).optional(),
}).passthrough();

const updateConditionSchema = z.object({}).passthrough();

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// Inspections
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections — create inspection
router.post('/cases/:caseId/inspections', (req, res) => {
  try {
    const { caseId } = req.params;
    const body = parsePayload(createInspectionSchema, req.body || {}, res);
    if (!body) return;
    const result = createInspection(caseId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:create-inspection', { caseId: req.params.caseId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections — list inspections
router.get('/cases/:caseId/inspections', (req, res) => {
  try {
    const { caseId } = req.params;
    const inspections = listInspections(caseId);
    res.json({ ok: true, inspections });
  } catch (err) {
    log.error('api:list-inspections', { caseId: req.params.caseId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId — get inspection detail
router.get('/cases/:caseId/inspections/:inspectionId', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const inspection = getInspection(inspectionId);

    if (!inspection) {
      return res.status(404).json({ ok: false, error: 'Inspection not found' });
    }

    res.json({ ok: true, inspection });
  } catch (err) {
    log.error('api:get-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /cases/:caseId/inspections/:inspectionId — update inspection
router.put('/cases/:caseId/inspections/:inspectionId', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const body = parsePayload(updateInspectionSchema, req.body || {}, res);
    if (!body) return;
    const result = updateInspection(inspectionId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:update-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/inspections/:inspectionId/start — start inspection
router.post('/cases/:caseId/inspections/:inspectionId/start', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const result = startInspection(inspectionId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:start-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/inspections/:inspectionId/complete — complete inspection
router.post('/cases/:caseId/inspections/:inspectionId/complete', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const body = parsePayload(completeInspectionSchema, req.body || {}, res);
    if (!body) return;
    const result = completeInspection(inspectionId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:complete-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/inspections/:inspectionId/cancel — cancel inspection
router.post('/cases/:caseId/inspections/:inspectionId/cancel', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const result = cancelInspection(inspectionId, req.body?.reason);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:cancel-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/inspections/:inspectionId/reschedule — reschedule inspection
router.post('/cases/:caseId/inspections/:inspectionId/reschedule', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const body = parsePayload(rescheduleSchema, req.body || {}, res);
    if (!body) return;
    const result = rescheduleInspection(inspectionId, body.newDate, body.newTime);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:reschedule-inspection', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/summary — full inspection summary
router.get('/cases/:caseId/inspections/:inspectionId/summary', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const summary = getInspectionSummary(inspectionId);

    if (!summary) {
      return res.status(404).json({ ok: false, error: 'Inspection not found' });
    }

    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:inspection-summary', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Photos
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/photos — add photo
router.post('/cases/:caseId/inspections/:inspectionId/photos', (req, res) => {
  try {
    const { caseId, inspectionId } = req.params;
    const body = parsePayload(addPhotoSchema, req.body || {}, res);
    if (!body) return;
    const result = addPhoto(inspectionId, caseId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:add-photo', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/photos — list photos
router.get('/cases/:caseId/inspections/:inspectionId/photos', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const category = req.query.category || undefined;
    const photos = listPhotos(inspectionId, { category });
    res.json({ ok: true, photos });
  } catch (err) {
    log.error('api:list-photos', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/photos — all case photos
router.get('/cases/:caseId/photos', (req, res) => {
  try {
    const { caseId } = req.params;
    const photos = listPhotosByCase(caseId);
    res.json({ ok: true, photos });
  } catch (err) {
    log.error('api:list-case-photos', { caseId: req.params.caseId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /cases/:caseId/photos/:photoId — update photo
router.put('/cases/:caseId/photos/:photoId', (req, res) => {
  try {
    const { photoId } = req.params;
    const body = parsePayload(updatePhotoSchema, req.body || {}, res);
    if (!body) return;
    const result = updatePhoto(photoId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:update-photo', { photoId: req.params.photoId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// DELETE /cases/:caseId/photos/:photoId — delete photo
router.delete('/cases/:caseId/photos/:photoId', (req, res) => {
  try {
    const { photoId } = req.params;
    const result = deletePhoto(photoId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:delete-photo', { photoId: req.params.photoId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// POST /cases/:caseId/inspections/:inspectionId/photos/reorder — reorder photos
router.post('/cases/:caseId/inspections/:inspectionId/photos/reorder', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const body = parsePayload(reorderPhotosSchema, req.body || {}, res);
    if (!body) return;
    const result = reorderPhotos(inspectionId, body.category, body.orderedIds);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:reorder-photos', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Measurements
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/measurements — add measurement
router.post('/cases/:caseId/inspections/:inspectionId/measurements', (req, res) => {
  try {
    const { caseId, inspectionId } = req.params;
    const body = parsePayload(addMeasurementSchema, req.body || {}, res);
    if (!body) return;
    const result = addMeasurement(inspectionId, caseId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:add-measurement', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/measurements — list measurements
router.get('/cases/:caseId/inspections/:inspectionId/measurements', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const level = req.query.level || undefined;
    const area_type = req.query.area_type || undefined;
    const measurements = listMeasurements(inspectionId, { level, area_type });
    res.json({ ok: true, measurements });
  } catch (err) {
    log.error('api:list-measurements', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/measurements/gla — calculate GLA
router.get('/cases/:caseId/inspections/:inspectionId/measurements/gla', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const result = calculateGLA(inspectionId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:calculate-gla', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /cases/:caseId/measurements/:measurementId — update measurement
router.put('/cases/:caseId/measurements/:measurementId', (req, res) => {
  try {
    const { measurementId } = req.params;
    const body = parsePayload(updateMeasurementSchema, req.body || {}, res);
    if (!body) return;
    const result = updateMeasurement(measurementId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:update-measurement', { measurementId: req.params.measurementId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// DELETE /cases/:caseId/measurements/:measurementId — delete measurement
router.delete('/cases/:caseId/measurements/:measurementId', (req, res) => {
  try {
    const { measurementId } = req.params;
    const result = deleteMeasurement(measurementId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:delete-measurement', { measurementId: req.params.measurementId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Conditions
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/conditions — add condition
router.post('/cases/:caseId/inspections/:inspectionId/conditions', (req, res) => {
  try {
    const { caseId, inspectionId } = req.params;
    const body = parsePayload(addConditionSchema, req.body || {}, res);
    if (!body) return;
    const result = addCondition(inspectionId, caseId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    log.error('api:add-condition', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/conditions — list conditions
router.get('/cases/:caseId/inspections/:inspectionId/conditions', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const conditions = listConditions(inspectionId);
    res.json({ ok: true, conditions });
  } catch (err) {
    log.error('api:list-conditions', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// GET /cases/:caseId/inspections/:inspectionId/conditions/summary — condition summary
router.get('/cases/:caseId/inspections/:inspectionId/conditions/summary', (req, res) => {
  try {
    const { inspectionId } = req.params;
    const summary = getConditionSummary(inspectionId);

    if (summary.error) {
      return res.status(400).json({ ok: false, error: summary.error });
    }

    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:condition-summary', { inspectionId: req.params.inspectionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// PUT /cases/:caseId/conditions/:conditionId — update condition
router.put('/cases/:caseId/conditions/:conditionId', (req, res) => {
  try {
    const { conditionId } = req.params;
    const body = parsePayload(updateConditionSchema, req.body || {}, res);
    if (!body) return;
    const result = updateCondition(conditionId, body);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:update-condition', { conditionId: req.params.conditionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

// DELETE /cases/:caseId/conditions/:conditionId — delete condition
router.delete('/cases/:caseId/conditions/:conditionId', (req, res) => {
  try {
    const { conditionId } = req.params;
    const result = deleteCondition(conditionId);

    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('api:delete-condition', { conditionId: req.params.conditionId, error: err.message });
    return sendErrorResponse(res, err);
  }
});

export default router;
