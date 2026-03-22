/**
 * server/api/platformAIRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform AI routes — FREE built-in AI features for all users.
 *
 * These endpoints use the platform's Gemini key, not the user's.
 * Available on ALL tiers including free.
 *
 * This is what makes users say "I can't believe this is free."
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  isPlatformAIAvailable, platformExtractPdf, platformAnalyzePhoto,
  platformClassifyDocument, platformSmartExtract, platformBatchExtract,
} from '../ai/platformAI.js';
import { upload } from '../utils/middleware.js';
import { addPhoto, autoCategorize } from '../photos/photoManager.js';
import { dbRun, dbGet } from '../db/database.js';
import log from '../logger.js';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

// ── GET /platform/status ─────────────────────────────────────────────────────

router.get('/platform/status', (_req, res) => {
  const available = isPlatformAIAvailable();
  res.json({
    ok: true,
    platformAI: available,
    features: {
      pdfExtraction: available,
      photoAnalysis: available,
      documentClassification: available,
      smartUpload: available,
    },
    note: available
      ? 'Platform AI is active. PDF extraction, photo analysis, and document classification are free for all users.'
      : 'Platform AI not configured. Set PLATFORM_GEMINI_KEY in .env.',
  });
});

// ── POST /platform/extract — Smart document upload + extraction ──────────────
// Upload ANY PDF → auto-classify → extract structured data

router.post('/platform/extract', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });

  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const result = await platformSmartExtract(pdfBuffer);

    res.json({
      ok: true,
      fileName: req.file.originalname,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
  }
});

// ── POST /platform/extract-order — Extract order form specifically ───────────

router.post('/platform/extract-order', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });

  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const result = await platformExtractPdf(pdfBuffer, 'order');

    res.json({ ok: true, fileName: req.file.originalname, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
  }
});

// ── POST /platform/extract-and-create — Extract order + auto-create case ─────

router.post('/platform/extract-and-create', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });

  try {
    const pdfBuffer = fs.readFileSync(req.file.path);

    // Classify first
    const docType = await platformClassifyDocument(pdfBuffer);

    // Extract
    const extraction = await platformExtractPdf(pdfBuffer, docType === 'order' ? 'order' : 'general');
    const data = extraction.data;

    if (docType === 'order' || data.subject?.address) {
      // Create case
      const caseId = crypto.randomBytes(4).toString('hex');
      const now = new Date().toISOString();
      const formType = data.order?.formType || req.body?.formType || '1004';

      // Build internal facts
      const facts = {
        subject: {
          address: data.subject?.address,
          streetAddress: data.subject?.address,
          city: data.subject?.city,
          state: data.subject?.state,
          zip: data.subject?.zip,
          zipCode: data.subject?.zip,
          county: data.subject?.county,
          legalDescription: data.subject?.legalDescription,
          taxParcelId: data.subject?.taxParcelId,
          borrower: data.borrower?.name,
          owner: data.borrower?.name,
          propertyType: data.assignment?.propertyType,
        },
        lender: data.lender || {},
        amc: data.amc || {},
        contract: data.contract || {},
        assignment: {
          type: 'Standard',
          purpose: data.assignment?.purpose || 'Purchase',
          intendedUse: 'Mortgage lending decision',
          propertyRightsAppraised: 'Fee Simple',
          loanType: data.assignment?.loanType,
          loanProgram: data.assignment?.loanProgram,
        },
        improvements: data.property || {},
        order: data.order || {},
      };

      // Clean nulls
      const cleanFacts = JSON.parse(JSON.stringify(facts, (k, v) => v === '' || v === null || v === undefined ? undefined : v));

      dbRun('INSERT INTO case_records (case_id, form_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [caseId, formType, 'draft', now, now]);
      dbRun('INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [caseId, JSON.stringify(cleanFacts), now, now]);

      log.info('platform:case-created', { caseId, formType, documentType: docType });

      res.status(201).json({
        ok: true,
        caseId,
        formType,
        documentType: docType,
        address: data.subject?.address,
        fieldsExtracted: Object.keys(cleanFacts).length,
        facts: cleanFacts,
      });
    } else {
      res.json({ ok: true, documentType: docType, data: extraction.data, note: 'Document extracted but no case created (not an order form)' });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
  }
});

// ── POST /platform/analyze-photo — Analyze inspection photo ──────────────────

router.post('/platform/analyze-photo', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Photo required' });

  try {
    const imageBuffer = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || 'image/jpeg';
    const analysis = await platformAnalyzePhoto(imageBuffer, mimeType);

    // If caseId provided, also save the photo to the case
    if (req.body.caseId) {
      const result = addPhoto(req.body.caseId, req.user.userId, {
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        mimeType,
        category: analysis.category || autoCategorize(req.file.originalname),
        label: analysis.caption,
      });
      analysis.photoId = result.photoId;
      analysis.savedToCase = req.body.caseId;
    }

    res.json({ ok: true, ...analysis });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /platform/batch-extract — Upload multiple PDFs at once ──────────────

router.post('/platform/batch-extract', authMiddleware, upload.array('files', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ ok: false, error: 'At least one file required' });

  try {
    const files = req.files.map(f => ({
      buffer: fs.readFileSync(f.path),
      name: f.originalname,
    }));

    const results = await platformBatchExtract(files);

    res.json({ ok: true, total: results.length, successful: results.filter(r => r.ok).length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    // Cleanup
    for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch { /* ok */ } }
  }
});

// ── POST /platform/classify — Just classify a document (no extraction) ───────

router.post('/platform/classify', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'PDF file required' });

  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const documentType = await platformClassifyDocument(pdfBuffer);
    res.json({ ok: true, documentType, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
  }
});

export default router;
