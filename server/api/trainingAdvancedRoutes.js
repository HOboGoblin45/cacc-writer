/**
 * server/api/trainingAdvancedRoutes.js
 * ACI extraction + training pipeline endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { scanAppraisalDirectory, runExtractionPipeline } from '../training/aciExtractor.js';
import path from 'path';

const router = Router();

// POST /training/scan — scan a directory for appraisal files
router.post('/training/scan', authMiddleware, (req, res) => {
  try {
    const dir = req.body.directory;
    if (!dir) return res.status(400).json({ ok: false, error: 'directory required' });
    const scan = scanAppraisalDirectory(dir);
    res.json({ ok: true, ...scan, aciCount: scan.aci.length, xmlCount: scan.xml.length, pdfCount: scan.pdf.length });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /training/extract — run full extraction pipeline
router.post('/training/extract', authMiddleware, (req, res) => {
  try {
    const sourceDir = req.body.sourceDirectory;
    const outputDir = req.body.outputDirectory || path.join(process.cwd(), 'training_output');
    if (!sourceDir) return res.status(400).json({ ok: false, error: 'sourceDirectory required' });

    const result = runExtractionPipeline(sourceDir, outputDir);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
