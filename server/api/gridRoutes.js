/**
 * server/api/gridRoutes.js
 * Adjustment grid + form field mapping endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams } from '../middleware/validateRequest.js';
import { generateAdjustmentGrid, analyzeGrid } from '../ai/adjustmentGridEngine.js';
import { mapToFormFields, getSupportedForms } from '../export/formFieldMapper.js';

const router = Router();

// Schemas
const idSchema = z.object({ id: z.string().min(1) });
const formFieldsSchema = z.object({
  id: z.string().min(1),
  formType: z.string().min(1),
});

// POST /cases/:id/adjustment-grid — generate adjustment grid
router.post('/cases/:id/adjustment-grid', authMiddleware, validateParams(idSchema), (req, res) => {
  try {
    const result = generateAdjustmentGrid(req.validatedParams.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/adjustment-grid/analyze — AI analysis of grid
router.post('/cases/:id/adjustment-grid/analyze', authMiddleware, validateParams(idSchema), async (req, res) => {
  try {
    const result = await analyzeGrid(req.validatedParams.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /forms — list supported form types
router.get('/forms', (_req, res) => {
  res.json({ ok: true, forms: getSupportedForms() });
});

// GET /cases/:id/form-fields/:formType — map case to form fields
router.get('/cases/:id/form-fields/:formType', authMiddleware, validateParams(formFieldsSchema), (req, res) => {
  try {
    const result = mapToFormFields(req.validatedParams.id, req.validatedParams.formType);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
