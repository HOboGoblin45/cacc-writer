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
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
import { sendErrorResponse } from '../utils/errorResponse.js';
// ══════════════════════════════════════════════════════════════════════════════
// Validation Schemas
// ══════════════════════════════════════════════════════════════════════════════

// Param schemas
const caseIdParam = z.object({ caseId: z.string().min(1) });
const inspectionIdParam = z.object({ inspectionId: z.string().min(1) });
const caseIdInspectionIdParam = z.object({
  caseId: z.string().min(1),
  inspectionId: z.string().min(1),
});
const photoIdParam = z.object({ photoId: z.string().min(1) });
const caseIdPhotoIdParam = z.object({
  caseId: z.string().min(1),
  photoId: z.string().min(1),
});
const measurementIdParam = z.object({ measurementId: z.string().min(1) });
const caseIdMeasurementIdParam = z.object({
  caseId: z.string().min(1),
  measurementId: z.string().min(1),
});
const conditionIdParam = z.object({ conditionId: z.string().min(1) });
const caseIdConditionIdParam = z.object({
  caseId: z.string().min(1),
  conditionId: z.string().min(1),
});
const filenameParam = z.object({
  caseId: z.string().min(1),
  filename: z.string().min(1),
});

// Query schemas
const listPhotosQuery = z.object({
  category: z.string().optional(),
}).passthrough();

const listMeasurementsQuery = z.object({
  level: z.string().optional(),
  area_type: z.string().optional(),
}).passthrough();

// Body schemas
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

const inspectionNotesSchema = z.object({
  notes: z.string().max(8000).optional(),
  condition: z.string().max(20).optional(),
  quality: z.string().max(20).optional(),
  observations: z.array(z.string().max(200)).optional(),
}).passthrough();

const measurementsSchema = z.object({
  rooms: z.array(z.object({
    name: z.string().max(100).optional(),
    length: z.number().optional(),
    width: z.number().optional(),
  })).optional(),
}).passthrough();

const photoUploadSchema = z.object({
  category: z.string().max(60).optional(),
}).passthrough();

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// Inspections
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections — create inspection
router.post(
  '/cases/:caseId/inspections',
  validateParams(caseIdParam),
  validateBody(createInspectionSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const body = req.validated;
      const result = createInspection(caseId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      log.error('api:create-inspection', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections — list inspections
router.get(
  '/cases/:caseId/inspections',
  validateParams(caseIdParam),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const inspections = listInspections(caseId);
      res.json({ ok: true, inspections });
    } catch (err) {
      log.error('api:list-inspections', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId — get inspection detail
router.get(
  '/cases/:caseId/inspections/:inspectionId',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const inspection = getInspection(inspectionId);

      if (!inspection) {
        return res.status(404).json({ ok: false, error: 'Inspection not found' });
      }

      res.json({ ok: true, inspection });
    } catch (err) {
      log.error('api:get-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// PUT /cases/:caseId/inspections/:inspectionId — update inspection
router.put(
  '/cases/:caseId/inspections/:inspectionId',
  validateParams(caseIdInspectionIdParam),
  validateBody(updateInspectionSchema),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = updateInspection(inspectionId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:update-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// POST /cases/:caseId/inspections/:inspectionId/start — start inspection
router.post(
  '/cases/:caseId/inspections/:inspectionId/start',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const result = startInspection(inspectionId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:start-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// POST /cases/:caseId/inspections/:inspectionId/complete — complete inspection
router.post(
  '/cases/:caseId/inspections/:inspectionId/complete',
  validateParams(caseIdInspectionIdParam),
  validateBody(completeInspectionSchema),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = completeInspection(inspectionId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:complete-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// POST /cases/:caseId/inspections/:inspectionId/cancel — cancel inspection
router.post(
  '/cases/:caseId/inspections/:inspectionId/cancel',
  validateParams(caseIdInspectionIdParam),
  validateBody(z.object({ reason: z.string().optional() }).passthrough()),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const result = cancelInspection(inspectionId, req.validated?.reason);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:cancel-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// POST /cases/:caseId/inspections/:inspectionId/reschedule — reschedule inspection
router.post(
  '/cases/:caseId/inspections/:inspectionId/reschedule',
  validateParams(caseIdInspectionIdParam),
  validateBody(rescheduleSchema),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = rescheduleInspection(inspectionId, body.newDate, body.newTime);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:reschedule-inspection', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/summary — full inspection summary
router.get(
  '/cases/:caseId/inspections/:inspectionId/summary',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const summary = getInspectionSummary(inspectionId);

      if (!summary) {
        return res.status(404).json({ ok: false, error: 'Inspection not found' });
      }

      res.json({ ok: true, summary });
    } catch (err) {
      log.error('api:inspection-summary', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// Photos
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/photos — add photo
router.post(
  '/cases/:caseId/inspections/:inspectionId/photos',
  validateParams(caseIdInspectionIdParam),
  validateBody(addPhotoSchema),
  (req, res) => {
    try {
      const { caseId, inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = addPhoto(inspectionId, caseId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      log.error('api:add-photo', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/photos — list photos
router.get(
  '/cases/:caseId/inspections/:inspectionId/photos',
  validateParams(caseIdInspectionIdParam),
  validateQuery(listPhotosQuery),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const category = req.validatedQuery?.category || undefined;
      const photos = listPhotos(inspectionId, { category });
      res.json({ ok: true, photos });
    } catch (err) {
      log.error('api:list-photos', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/photos — all case photos
router.get(
  '/cases/:caseId/photos',
  validateParams(caseIdParam),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const photos = listPhotosByCase(caseId);
      res.json({ ok: true, photos });
    } catch (err) {
      log.error('api:list-case-photos', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// PUT /cases/:caseId/photos/:photoId — update photo
router.put(
  '/cases/:caseId/photos/:photoId',
  validateParams(caseIdPhotoIdParam),
  validateBody(updatePhotoSchema),
  (req, res) => {
    try {
      const { photoId } = req.validatedParams;
      const body = req.validated;
      const result = updatePhoto(photoId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:update-photo', { photoId: req.params.photoId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// DELETE /cases/:caseId/photos/:photoId — delete photo
router.delete(
  '/cases/:caseId/photos/:photoId',
  validateParams(caseIdPhotoIdParam),
  (req, res) => {
    try {
      const { photoId } = req.validatedParams;
      const result = deletePhoto(photoId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:delete-photo', { photoId: req.params.photoId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// POST /cases/:caseId/inspections/:inspectionId/photos/reorder — reorder photos
router.post(
  '/cases/:caseId/inspections/:inspectionId/photos/reorder',
  validateParams(caseIdInspectionIdParam),
  validateBody(reorderPhotosSchema),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = reorderPhotos(inspectionId, body.category, body.orderedIds);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:reorder-photos', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// Measurements
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/measurements — add measurement
router.post(
  '/cases/:caseId/inspections/:inspectionId/measurements',
  validateParams(caseIdInspectionIdParam),
  validateBody(addMeasurementSchema),
  (req, res) => {
    try {
      const { caseId, inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = addMeasurement(inspectionId, caseId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      log.error('api:add-measurement', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/measurements — list measurements
router.get(
  '/cases/:caseId/inspections/:inspectionId/measurements',
  validateParams(caseIdInspectionIdParam),
  validateQuery(listMeasurementsQuery),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const level = req.validatedQuery?.level || undefined;
      const area_type = req.validatedQuery?.area_type || undefined;
      const measurements = listMeasurements(inspectionId, { level, area_type });
      res.json({ ok: true, measurements });
    } catch (err) {
      log.error('api:list-measurements', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/measurements/gla — calculate GLA
router.get(
  '/cases/:caseId/inspections/:inspectionId/measurements/gla',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const result = calculateGLA(inspectionId);
      res.json({ ok: true, ...result });
    } catch (err) {
      log.error('api:calculate-gla', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// PUT /cases/:caseId/measurements/:measurementId — update measurement
router.put(
  '/cases/:caseId/measurements/:measurementId',
  validateParams(caseIdMeasurementIdParam),
  validateBody(updateMeasurementSchema),
  (req, res) => {
    try {
      const { measurementId } = req.validatedParams;
      const body = req.validated;
      const result = updateMeasurement(measurementId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:update-measurement', { measurementId: req.params.measurementId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// DELETE /cases/:caseId/measurements/:measurementId — delete measurement
router.delete(
  '/cases/:caseId/measurements/:measurementId',
  validateParams(caseIdMeasurementIdParam),
  (req, res) => {
    try {
      const { measurementId } = req.validatedParams;
      const result = deleteMeasurement(measurementId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:delete-measurement', { measurementId: req.params.measurementId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// Conditions
// ══════════════════════════════════════════════════════════════════════════════

// POST /cases/:caseId/inspections/:inspectionId/conditions — add condition
router.post(
  '/cases/:caseId/inspections/:inspectionId/conditions',
  validateParams(caseIdInspectionIdParam),
  validateBody(addConditionSchema),
  (req, res) => {
    try {
      const { caseId, inspectionId } = req.validatedParams;
      const body = req.validated;
      const result = addCondition(inspectionId, caseId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      log.error('api:add-condition', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/conditions — list conditions
router.get(
  '/cases/:caseId/inspections/:inspectionId/conditions',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const conditions = listConditions(inspectionId);
      res.json({ ok: true, conditions });
    } catch (err) {
      log.error('api:list-conditions', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// GET /cases/:caseId/inspections/:inspectionId/conditions/summary — condition summary
router.get(
  '/cases/:caseId/inspections/:inspectionId/conditions/summary',
  validateParams(caseIdInspectionIdParam),
  (req, res) => {
    try {
      const { inspectionId } = req.validatedParams;
      const summary = getConditionSummary(inspectionId);

      if (summary.error) {
        return res.status(400).json({ ok: false, error: summary.error });
      }

      res.json({ ok: true, summary });
    } catch (err) {
      log.error('api:condition-summary', { inspectionId: req.params.inspectionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// PUT /cases/:caseId/conditions/:conditionId — update condition
router.put(
  '/cases/:caseId/conditions/:conditionId',
  validateParams(caseIdConditionIdParam),
  validateBody(updateConditionSchema),
  (req, res) => {
    try {
      const { conditionId } = req.validatedParams;
      const body = req.validated;
      const result = updateCondition(conditionId, body);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:update-condition', { conditionId: req.params.conditionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// DELETE /cases/:caseId/conditions/:conditionId — delete condition
router.delete(
  '/cases/:caseId/conditions/:conditionId',
  validateParams(caseIdConditionIdParam),
  (req, res) => {
    try {
      const { conditionId } = req.validatedParams;
      const result = deleteCondition(conditionId);

      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error('api:delete-condition', { conditionId: req.params.conditionId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile PWA Inspection Routes
// Simple endpoints used by inspection.html (no inspectionId required)
// ═══════════════════════════════════════════════════════════════════════════════

import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { CASES_DIR, resolveCaseDir } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Disk-based multer for photo uploads
const photoUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const caseId = req.params.caseId;
      const caseDir = resolveCaseDir(caseId);
      if (!caseDir) return cb(new Error('Invalid case ID'));
      const photosDir = path.join(caseDir, 'photos');
      try {
        fs.mkdirSync(photosDir, { recursive: true });
        cb(null, photosDir);
      } catch (err) {
        cb(err);
      }
    },
    filename(_req, file, cb) {
      const ext  = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * POST /api/cases/:caseId/photos/upload
 * Accept multipart image upload from mobile inspection PWA.
 * Saves to cases/:caseId/photos/, stores metadata in photos/manifest.json.
 */
router.post(
  '/cases/:caseId/photos/upload',
  validateParams(caseIdParam),
  validateBody(photoUploadSchema),
  photoUpload.single('photo'),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const caseDir = resolveCaseDir(caseId);
      if (!caseDir) return res.status(404).json({ ok: false, error: 'Case not found' });
      if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

      const category  = String(req.body?.category || 'additional').slice(0, 60);
      const photoId   = 'mpwa_' + randomUUID().slice(0, 12);
      const filename  = req.file.filename;
      const thumbUrl  = `/api/cases/${caseId}/photos/file/${filename}`;

      // Persist metadata to manifest
      const manifestPath = path.join(caseDir, 'photos', 'manifest.json');
      const manifest     = readJSON(manifestPath, { photos: [] });
      manifest.photos.push({
        photoId,
        category,
        filename,
        thumbUrl,
        timestamp: new Date().toISOString(),
        size: req.file.size,
      });
      writeJSON(manifestPath, manifest);

      log.info('mobile-photo-upload', { caseId, photoId, category, filename });
      res.status(201).json({ ok: true, photoId, thumbnailUrl: thumbUrl });
    } catch (err) {
      log.error('mobile-photo-upload-error', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

/**
 * GET /api/cases/:caseId/photos/file/:filename
 * Serve a stored inspection photo.
 */
router.get(
  '/cases/:caseId/photos/file/:filename',
  validateParams(filenameParam),
  (req, res) => {
    try {
      const { caseId, filename } = req.validatedParams;
      // Prevent path traversal
      if (!/^[\w.\-]+$/.test(filename)) return res.status(400).json({ ok: false, error: 'Invalid filename' });
      const caseDir  = resolveCaseDir(caseId);
      if (!caseDir) return res.status(404).json({ ok: false, error: 'Case not found' });
      const filePath = path.join(caseDir, 'photos', filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
      res.sendFile(filePath);
    } catch (err) {
      return sendErrorResponse(res, err);
    }
  }
);

/**
 * POST /api/cases/:caseId/inspection-notes
 * Save mobile inspection notes and ratings into case facts.
 * Body: { notes, condition, quality, observations: [] }
 */
router.post(
  '/cases/:caseId/inspection-notes',
  validateParams(caseIdParam),
  validateBody(inspectionNotesSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const caseDir    = resolveCaseDir(caseId);
      if (!caseDir) return res.status(404).json({ ok: false, error: 'Case not found' });

      const { notes = '', condition = '', quality = '', observations = [] } = req.validated || {};

      const factsPath = path.join(caseDir, 'facts.json');
      const facts     = readJSON(factsPath, {});

      // Merge inspection notes into facts
      facts.inspectionNotes     = String(notes).slice(0, 8000);
      facts.subjectCondition    = condition ? String(condition).slice(0, 20)  : facts.subjectCondition;
      facts.overallQuality      = quality   ? String(quality).slice(0, 20)   : facts.overallQuality;
      facts.inspectionObservations = Array.isArray(observations)
        ? observations.map(function(o) { return String(o).slice(0, 200); }).slice(0, 50)
        : facts.inspectionObservations;
      facts.inspectionNotesAt   = new Date().toISOString();

      writeJSON(factsPath, facts);

      log.info('mobile-inspection-notes', { caseId, condition, quality });
      res.json({ ok: true });
    } catch (err) {
      log.error('mobile-inspection-notes-error', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

/**
 * POST /api/cases/:caseId/measurements
 * Save room measurements from mobile PWA.
 * Body: { rooms: [{ name, length, width }] }
 * Calculates total GLA and saves to case facts.
 */
router.post(
  '/cases/:caseId/measurements',
  validateParams(caseIdParam),
  validateBody(measurementsSchema),
  (req, res) => {
    try {
      const { caseId } = req.validatedParams;
      const caseDir    = resolveCaseDir(caseId);
      if (!caseDir) return res.status(404).json({ ok: false, error: 'Case not found' });

      const { rooms = [] } = req.validated || {};
      if (!Array.isArray(rooms)) return res.status(400).json({ ok: false, error: 'rooms must be an array' });

      const validated = rooms.map(function(r) {
        return {
          name:   String(r.name   || '').slice(0, 100),
          length: parseFloat(r.length) || 0,
          width:  parseFloat(r.width)  || 0,
          area:   (parseFloat(r.length) || 0) * (parseFloat(r.width) || 0),
        };
      }).filter(function(r) { return r.length > 0 && r.width > 0; });

      const gla = validated.reduce(function(sum, r) { return sum + r.area; }, 0);

      const factsPath = path.join(caseDir, 'facts.json');
      const facts     = readJSON(factsPath, {});
      facts.rooms             = validated;
      facts.grossLivingArea   = Math.round(gla);
      facts.measurementsAt    = new Date().toISOString();
      writeJSON(factsPath, facts);

      log.info('mobile-measurements', { caseId, roomCount: validated.length, gla: Math.round(gla) });
      res.json({ ok: true, gla: Math.round(gla), rooms: validated });
    } catch (err) {
      log.error('mobile-measurements-error', { caseId: req.params.caseId, error: err.message });
      return sendErrorResponse(res, err);
    }
  }
);

export default router;
