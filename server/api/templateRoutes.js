/**
 * server/api/templateRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Report template CRUD routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import {
  getTemplates, getTemplate, createTemplate, updateTemplate,
  deleteTemplate, applyTemplate, STARTER_TEMPLATES,
} from '../templates/reportTemplates.js';
import { validateBody, validateParams, CommonSchemas } from '../middleware/validateRequest.js';

const router = Router();

/**
 * Validation Schemas
 */
const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sections: z.record(z.any()).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  sections: z.record(z.any()).optional(),
});

const templateIdSchema = z.object({ id: z.string().min(1) });

const applyCaseTemplateSchema = z.object({
  caseId: z.string().min(1),
  templateId: z.string().min(1),
});

// GET /templates — list user's templates
router.get('/templates', authMiddleware, (req, res) => {
  const templates = getTemplates(req.user.userId);
  res.json({ ok: true, templates, starterTemplates: STARTER_TEMPLATES });
});

// POST /templates — create template
router.post('/templates', authMiddleware, validateBody(createTemplateSchema), (req, res) => {
  try {
    const template = createTemplate(req.user.userId, req.validated);
    res.status(201).json({ ok: true, template });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// PUT /templates/:id — update template
router.put('/templates/:id', authMiddleware, validateParams(templateIdSchema), validateBody(updateTemplateSchema), (req, res) => {
  try {
    const template = updateTemplate(req.validatedParams.id, req.user.userId, req.validated);
    res.json({ ok: true, template });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE /templates/:id — delete template
router.delete('/templates/:id', authMiddleware, validateParams(templateIdSchema), (req, res) => {
  try {
    deleteTemplate(req.validatedParams.id, req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/apply-template/:templateId — apply template to case
router.post('/cases/:caseId/apply-template/:templateId', authMiddleware, validateParams(applyCaseTemplateSchema), (req, res) => {
  try {
    const result = applyTemplate(req.validatedParams.templateId, req.validatedParams.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
