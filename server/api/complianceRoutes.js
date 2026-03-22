/**
 * server/api/complianceRoutes.js
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { checkCompliance, generateWorkfileIndex } from '../compliance/workfileCompliance.js';
import { checkPhotoCompliance, getCasePhotos, addPhoto, autoCategorize } from '../photos/photoManager.js';
import { upload } from '../utils/middleware.js';

const router = Router();

// GET /cases/:caseId/compliance — full USPAP compliance check
router.get('/cases/:caseId/compliance', authMiddleware, (req, res) => {
  try {
    const result = checkCompliance(req.params.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/compliance/workfile — generate workfile index
router.get('/cases/:caseId/compliance/workfile', authMiddleware, (req, res) => {
  try {
    const index = generateWorkfileIndex(req.params.caseId, req.user.userId);
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
router.get('/cases/:caseId/photos/list', authMiddleware, (req, res) => {
  const photos = getCasePhotos(req.params.caseId);
  res.json({ ok: true, photos });
});

// GET /cases/:caseId/photos/compliance — photo compliance check
router.get('/cases/:caseId/photos/compliance', authMiddleware, (req, res) => {
  const result = checkPhotoCompliance(req.params.caseId);
  res.json({ ok: true, ...result });
});

// POST /cases/:caseId/photos — upload photo
router.post('/cases/:caseId/photos', authMiddleware, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No photo uploaded' });

    const category = req.body.category || autoCategorize(req.file.originalname);
    const result = addPhoto(req.params.caseId, req.user.userId, {
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      category,
      label: req.body.label,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
