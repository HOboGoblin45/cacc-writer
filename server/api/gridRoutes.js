/**
 * server/api/gridRoutes.js
 * Adjustment grid + form field mapping endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { generateAdjustmentGrid, analyzeGrid } from '../ai/adjustmentGridEngine.js';
import { mapToFormFields, getSupportedForms } from '../export/formFieldMapper.js';

const router = Router();

// POST /cases/:id/adjustment-grid — generate adjustment grid
router.post('/cases/:id/adjustment-grid', authMiddleware, (req, res) => {
  try {
    const result = generateAdjustmentGrid(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/adjustment-grid/analyze — AI analysis of grid
router.post('/cases/:id/adjustment-grid/analyze', authMiddleware, async (req, res) => {
  try {
    const result = await analyzeGrid(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /forms — list supported form types
router.get('/forms', (_req, res) => {
  res.json({ ok: true, forms: getSupportedForms() });
});

// GET /cases/:id/form-fields/:formType — map case to form fields
router.get('/cases/:id/form-fields/:formType', authMiddleware, (req, res) => {
  try {
    const result = mapToFormFields(req.params.id, req.params.formType);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
