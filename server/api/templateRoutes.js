/**
 * server/api/templateRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Report template CRUD routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  getTemplates, getTemplate, createTemplate, updateTemplate,
  deleteTemplate, applyTemplate, STARTER_TEMPLATES,
} from '../templates/reportTemplates.js';

const router = Router();

// GET /templates — list user's templates
router.get('/templates', authMiddleware, (req, res) => {
  const templates = getTemplates(req.user.userId);
  res.json({ ok: true, templates, starterTemplates: STARTER_TEMPLATES });
});

// POST /templates — create template
router.post('/templates', authMiddleware, (req, res) => {
  try {
    const template = createTemplate(req.user.userId, req.body);
    res.status(201).json({ ok: true, template });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// PUT /templates/:id — update template
router.put('/templates/:id', authMiddleware, (req, res) => {
  try {
    const template = updateTemplate(req.params.id, req.user.userId, req.body);
    res.json({ ok: true, template });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE /templates/:id — delete template
router.delete('/templates/:id', authMiddleware, (req, res) => {
  try {
    deleteTemplate(req.params.id, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/apply-template/:templateId — apply template to case
router.post('/cases/:caseId/apply-template/:templateId', authMiddleware, (req, res) => {
  try {
    const result = applyTemplate(req.params.templateId, req.params.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
