/**
 * server/api/complianceRoutes.js
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { checkCompliance, generateWorkfileIndex } from '../compliance/workfileCompliance.js';
import { checkPhotoCompliance, getCasePhotos, addPhoto, autoCategorize } from '../photos/photoManager.js';
import { upload } from '../utils/middleware.js';

// Zod schemas
const caseIdSchema = z.object({
  caseId: z.string().min(1, 'caseId is required'),
});

const photoBodySchema = z.object({
  category: z.string().optional(),
  label: z.string().optional(),
});

// Validation middleware
const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const router = Router();

// GET /cases/:caseId/compliance — full USPAP compliance check
router.get('/cases/:caseId/compliance', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  try {
    const result = checkCompliance(req.validatedParams.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/compliance/workfile — generate workfile index
router.get('/cases/:caseId/compliance/workfile', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  try {
    const index = generateWorkfileIndex(req.validatedParams.caseId, req.user.userId);
    if (req.query.format === 'text') {
      res.type('text/plain').send(index);
    } else {
      res.json({ ok: true, index });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/photos — list all photos
router.get('/cases/:caseId/photos/list', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  const photos = getCasePhotos(req.validatedParams.caseId);
  res.json({ ok: true, photos });
});

// GET /cases/:caseId/photos/compliance — photo compliance check
router.get('/cases/:caseId/photos/compliance', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  const result = checkPhotoCompliance(req.validatedParams.caseId);
  res.json({ ok: true, ...result });
});

// POST /cases/:caseId/photos — upload photo
router.post('/cases/:caseId/photos', authMiddleware, validateParams(caseIdSchema), upload.single('photo'), validateBody(photoBodySchema), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No photo uploaded' });

    const category = req.validated.category || autoCategorize(req.file.originalname);
    const result = addPhoto(req.validatedParams.caseId, req.user.userId, {
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      category,
      label: req.validated.label,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
