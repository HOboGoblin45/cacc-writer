/**
 * server/api/documentRoutes.js
 * ------------------------------
 * Phase 5 — Document Intelligence API endpoints.
 *
 * Mounted at: /api  (via cacc-writer-server.js)
 *
 * Endpoints:
 *   POST   /cases/:caseId/documents/upload       — upload + register + classify + extract
 *   GET    /cases/:caseId/documents               — list all case documents
 *   GET    /cases/:caseId/documents/:docId         — get single document details
 *   DELETE /cases/:caseId/documents/:docId         — delete document + extractions
 *   PATCH  /cases/:caseId/documents/:docId/classify — reclassify a document
 *   POST   /cases/:caseId/documents/:docId/extract  — run/re-run extraction
 *   GET    /cases/:caseId/extraction-summary       — extraction summary stats
 *   GET    /cases/:caseId/extracted-facts          — list extracted fact candidates
 *   POST   /cases/:caseId/extracted-facts/review   — accept/reject facts
 *   POST   /cases/:caseId/extracted-facts/merge    — merge accepted facts into case
 *   GET    /cases/:caseId/extracted-sections        — list extracted narrative sections
 *   POST   /cases/:caseId/extracted-sections/:id/approve — approve section to memory
 *   POST   /cases/:caseId/extracted-sections/:id/reject  — reject section
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { resolveCaseDir } from '../utils/caseUtils.js';
import { upload } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { DOC_TYPES, DOC_TYPE_LABELS, classifyDocument } from '../ingestion/documentClassifier.js';
import {
  registerDocument, getCaseDocuments, getDocument, reclassifyDocument, deleteDocument,
  runDocumentExtraction, getExtractedFacts, reviewFact, acceptAndMergeFacts,
  getExtractedSections, approveSection, rejectSection,
  getCaseExtractionSummary, getDocumentExtractions,
} from '../ingestion/stagingService.js';
import { syncCaseRecordFromFilesystem } from '../caseRecord/caseRecordService.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { client, MODEL } from '../openaiClient.js';
import log from '../logger.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const router = Router();

function safeSyncCaseRecord(caseId) {
  try {
    syncCaseRecordFromFilesystem(caseId);
  } catch (err) {
    // Keep document ingestion flows stable if canonical sync has an issue.
    log.warn('case-record:sync-failed', { caseId, error: err.message });
  }
}

// ── param: caseId validation ────────────────────────────────────────────────

router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ error: 'Invalid case ID format' });
  req.caseDir = cd;
  next();
});

// ── POST /cases/:caseId/documents/upload ─────────────────────────────────────
/**
 * Upload a document, register it, classify it, extract text, and run structured extraction.
 * Replaces the legacy upload flow with Phase 5 document intelligence.
 *
 * Body (multipart): file, docType (optional legacy docType hint)
 */
router.post('/cases/:caseId/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ error: 'Case not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const isPdf = req.file.mimetype === 'application/pdf' ||
      String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ error: 'Only PDF files are allowed' });

    const caseId = req.params.caseId;
    const legacyDocType = req.body.docType || null;
    const originalFilename = req.file.originalname || 'document.pdf';

    // 1. Extract text from PDF
    let extractedText = '';
    let pageCount = 0;
    let extractionMethod = 'failed';
    try {
      const { text, method } = await extractPdfText(req.file.buffer, client, MODEL);
      extractedText = text || '';
      extractionMethod = method;
      try { const p = await pdfParse(req.file.buffer); pageCount = p.numpages || 0; } catch { pageCount = 0; }
    } catch (err) {
      log.warn('[documents] Text extraction failed:', err.message);
      extractedText = '';
    }

    extractedText = extractedText.replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();

    // 2. Register document (classifies automatically)
    const storedFilename = `${Date.now()}_${originalFilename.replace(/[^a-z0-9._-]/gi, '_')}`;
    const docsDir = path.join(cd, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, storedFilename), req.file.buffer);

    const { documentId, docType, classification } = registerDocument({
      caseId,
      originalFilename,
      storedFilename,
      legacyDocType,
      fileSizeBytes: req.file.size,
      pageCount,
      extractedText,
    });

    // 3. Also write to doc_text.json for backward compatibility
    const dtf = path.join(cd, 'doc_text.json');
    const docText = readJSON(dtf, {});
    const docTextKey = legacyDocType || docType;
    docText[docTextKey] = extractedText;
    writeJSON(dtf, docText);

    // 4. Update meta.json for backward compatibility
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.updatedAt = new Date().toISOString();
    if (!meta.docs) meta.docs = {};
    meta.docs[docTextKey] = {
      uploadedAt: new Date().toISOString(),
      pages: pageCount,
      bytes: req.file.size,
      documentId,
      docType,
    };
    writeJSON(mf, meta);
    safeSyncCaseRecord(caseId);

    // 5. Run structured extraction (async — don't block response)
    let extractionResult = null;
    try {
      extractionResult = await runDocumentExtraction(documentId, extractedText, { aiClient: client, model: MODEL });
    } catch (err) {
      log.warn('[documents] Extraction failed for', documentId, err.message);
    }

    log.info('[documents] Upload complete', {
      caseId, documentId, docType, classification: classification.method,
      confidence: classification.confidence, textLength: extractedText.length,
      factsExtracted: extractionResult?.factsExtracted || 0,
      sectionsExtracted: extractionResult?.sectionsExtracted || 0,
    });

    res.json({
      ok: true,
      documentId,
      docType,
      classification,
      extractionMethod,
      textLength: extractedText.length,
      wordCount: extractedText.split(/\s+/).filter(Boolean).length,
      pageCount,
      preview: extractedText.slice(0, 400),
      extraction: extractionResult ? {
        factsExtracted:    extractionResult.factsExtracted,
        sectionsExtracted: extractionResult.sectionsExtracted,
      } : null,
    });

  } catch (err) {
    log.error('[documents] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/documents ─────────────────────────────────────────────
router.get('/cases/:caseId/documents', (req, res) => {
  try {
    const docs = getCaseDocuments(req.params.caseId);
    res.json({
      ok: true,
      documents: docs.map(d => ({
        ...d,
        label: DOC_TYPE_LABELS[d.doc_type] || d.doc_type,
        tags: safeParseJSON(d.tags_json, []),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/documents/:docId ──────────────────────────────────────
router.get('/cases/:caseId/documents/:docId', (req, res) => {
  try {
    const doc = getDocument(req.params.docId);
    if (!doc || doc.case_id !== req.params.caseId) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const extractions = getDocumentExtractions(req.params.docId);
    res.json({
      ok: true,
      document: { ...doc, label: DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type },
      extractions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /cases/:caseId/documents/:docId ───────────────────────────────────
router.delete('/cases/:caseId/documents/:docId', (req, res) => {
  try {
    const doc = getDocument(req.params.docId);
    if (!doc || doc.case_id !== req.params.caseId) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete file from disk
    const filePath = path.join(req.caseDir, 'documents', doc.stored_filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    deleteDocument(req.params.docId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /cases/:caseId/documents/:docId/classify ───────────────────────────
router.patch('/cases/:caseId/documents/:docId/classify', (req, res) => {
  try {
    const { docType } = req.body;
    if (!docType || !DOC_TYPES.includes(docType)) {
      return res.status(400).json({ error: `Invalid doc type. Must be one of: ${DOC_TYPES.join(', ')}` });
    }
    reclassifyDocument(req.params.docId, docType);
    res.json({ ok: true, docType, label: DOC_TYPE_LABELS[docType] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases/:caseId/documents/:docId/extract ─────────────────────────────
router.post('/cases/:caseId/documents/:docId/extract', async (req, res) => {
  try {
    const doc = getDocument(req.params.docId);
    if (!doc || doc.case_id !== req.params.caseId) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get extracted text from doc_text.json or re-read from file
    const dtf = path.join(req.caseDir, 'doc_text.json');
    const docText = readJSON(dtf, {});
    let text = docText[doc.doc_type] || '';

    if (!text) {
      // Try to read from stored file
      const filePath = path.join(req.caseDir, 'documents', doc.stored_filename);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const { text: extracted } = await extractPdfText(buffer, client, MODEL);
        text = (extracted || '').replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
      }
    }

    if (!text || text.length < 20) {
      return res.status(400).json({ error: 'No text available for extraction. Re-upload the document.' });
    }

    const result = await runDocumentExtraction(req.params.docId, text, { aiClient: client, model: MODEL });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/extraction-summary ────────────────────────────────────
router.get('/cases/:caseId/extraction-summary', (req, res) => {
  try {
    const summary = getCaseExtractionSummary(req.params.caseId);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/extracted-facts ───────────────────────────────────────
router.get('/cases/:caseId/extracted-facts', (req, res) => {
  try {
    const status = req.query.status || null;
    const facts = getExtractedFacts(req.params.caseId, status);
    res.json({ ok: true, facts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases/:caseId/extracted-facts/review ───────────────────────────────
router.post('/cases/:caseId/extracted-facts/review', (req, res) => {
  try {
    const { factId, action } = req.body;
    if (!factId || !['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'Provide factId and action (accepted|rejected)' });
    }
    reviewFact(factId, action);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases/:caseId/extracted-facts/merge ────────────────────────────────
router.post('/cases/:caseId/extracted-facts/merge', (req, res) => {
  try {
    const { factIds } = req.body;
    if (!Array.isArray(factIds) || factIds.length === 0) {
      return res.status(400).json({ error: 'Provide factIds array' });
    }
    const result = acceptAndMergeFacts(req.params.caseId, factIds);
    safeSyncCaseRecord(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/extracted-sections ────────────────────────────────────
router.get('/cases/:caseId/extracted-sections', (req, res) => {
  try {
    const status = req.query.status || null;
    const sections = getExtractedSections(req.params.caseId, status);
    res.json({ ok: true, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases/:caseId/extracted-sections/:id/approve ───────────────────────
router.post('/cases/:caseId/extracted-sections/:id/approve', (req, res) => {
  try {
    const result = approveSection(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases/:caseId/extracted-sections/:id/reject ────────────────────────
router.post('/cases/:caseId/extracted-sections/:id/reject', (req, res) => {
  try {
    rejectSection(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /documents/types ─────────────────────────────────────────────────────
router.get('/documents/types', (_req, res) => {
  res.json({
    ok: true,
    types: DOC_TYPES.map(t => ({ id: t, label: DOC_TYPE_LABELS[t] || t })),
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

export default router;
