/**
 * server/api/trainingAdvancedRoutes.js
 * ACI extraction + training pipeline endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { scanAppraisalDirectory, runExtractionPipeline } from '../training/aciExtractor.js';
import path from 'path';

const router = Router();

// Validation schemas
const scanBodySchema = z.object({
  directory: z.string().min(1, 'directory is required'),
}).passthrough();

const extractBodySchema = z.object({
  sourceDirectory: z.string().min(1, 'sourceDirectory is required'),
  outputDirectory: z.string().optional(),
}).passthrough();

// Validation middleware
const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body || {});
    next();
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.errors[0]?.message || 'Invalid request body' });
  }
};

// POST /training/scan — scan a directory for appraisal files
router.post('/training/scan', authMiddleware, validateBody(scanBodySchema), (req, res) => {
  try {
    const dir = req.validated.directory;
    const scan = scanAppraisalDirectory(dir);
    res.json({ ok: true, ...scan, aciCount: scan.aci.length, xmlCount: scan.xml.length, pdfCount: scan.pdf.length });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /training/extract — run full extraction pipeline
router.post('/training/extract', authMiddleware, validateBody(extractBodySchema), (req, res) => {
  try {
    const sourceDir = req.validated.sourceDirectory;
    const outputDir = req.validated.outputDirectory || path.join(process.cwd(), 'training_output');

    const result = runExtractionPipeline(sourceDir, outputDir);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
