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
import crypto from 'crypto';
import { createRequire } from 'module';
import { resolveCaseDir } from '../utils/caseUtils.js';
import { upload } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { extractImageText } from '../ingestion/imageOcrExtractor.js';
import { scoreDocumentQuality } from '../ingestion/documentQuality.js';
import { DOC_TYPES, DOC_TYPE_LABELS, classifyDocument } from '../ingestion/documentClassifier.js';
import {
  registerDocument, getCaseDocuments, getDocument, reclassifyDocument, deleteDocument,
  runDocumentExtraction, getExtractedFacts, reviewFact, acceptAndMergeFacts,
  getExtractedSections, approveSection, rejectSection,
  getCaseExtractionSummary, getDocumentExtractions, findDuplicateDocumentByHash,
} from '../ingestion/stagingService.js';
import {
  createDocumentIngestJob,
  attachDocumentToIngestJob,
  runDocumentIngestStep,
  skipDocumentIngestStep,
  finalizeDocumentIngestJob,
  setDocumentIngestJobStatus,
  getDocumentIngestJob,
  listCaseDocumentIngestJobs,
  isDocumentIngestStepFailed,
  getDocumentIngestRetryState,
} from '../ingestion/ingestJobService.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { readJSON } from '../utils/fileUtils.js';
import { client, MODEL } from '../openaiClient.js';
import log from '../logger.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const router = Router();
const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'];

function detectUploadKind(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();

  if (ext === '.pdf' || mime === 'application/pdf') return { supported: true, kind: 'pdf', ext };
  if (SUPPORTED_EXTENSIONS.includes(ext) || mime.startsWith('image/')) {
    return { supported: true, kind: 'image', ext };
  }

  return { supported: false, kind: 'unsupported', ext };
}

function sanitizeFilenameToken(value, maxLen = 48) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen) || 'document';
}

function buildStoredFilename({ caseId, docTypeHint, originalFilename, fileHash }) {
  const ext = path.extname(originalFilename || '').toLowerCase() || '.pdf';
  const baseName = sanitizeFilenameToken(path.basename(originalFilename || 'document', ext), 36);
  const docType = sanitizeFilenameToken(docTypeHint || 'unknown', 24);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const hashShort = String(fileHash || '').slice(0, 12) || 'nohash';
  return `${caseId}_${docType}_${stamp}_${hashShort}_${baseName}${ext}`;
}

function getCaseRuntime(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;
  return {
    projection,
    meta: projection.meta || {},
    facts: projection.facts || {},
    outputs: projection.outputs || {},
    history: projection.history || {},
    docText: projection.docText || {},
    provenance: projection.provenance || {},
  };
}

function saveCaseRuntime(caseId, runtime, overrides = {}) {
  const projection = runtime?.projection || {};
  return saveCaseProjection({
    caseId,
    meta: overrides.meta ?? runtime.meta ?? projection.meta ?? {},
    facts: overrides.facts ?? runtime.facts ?? projection.facts ?? {},
    provenance: overrides.provenance ?? runtime.provenance ?? projection.provenance ?? {},
    outputs: overrides.outputs ?? runtime.outputs ?? projection.outputs ?? {},
    history: overrides.history ?? runtime.history ?? projection.history ?? {},
    docText: overrides.docText ?? runtime.docText ?? projection.docText ?? {},
  });
}

async function loadDocumentTextForExtraction({ doc, caseDir, runtimeDocText = {} }) {
  let text = runtimeDocText[doc.doc_type] || '';
  if (text && text.length >= 20) return text;

  const filePath = path.join(caseDir, 'documents', doc.stored_filename);
  if (!fs.existsSync(filePath)) return '';

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(doc.stored_filename || '').toLowerCase();

  if (ext === '.pdf' || doc.file_type === 'pdf') {
    const { text: extracted } = await extractPdfText(buffer, client, MODEL);
    text = (extracted || '').replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
    return text;
  }

  const imageResult = await extractImageText(buffer, {
    aiClient: client,
    model: MODEL,
    ext,
  });
  return imageResult.text || '';
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
  let ingestJobId = null;
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ error: 'Case not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const uploadKind = detectUploadKind(req.file);
    if (!uploadKind.supported) {
      return res.status(415).json({
        ok: false,
        code: 'UNSUPPORTED_FILE_TYPE',
        error: `Unsupported file type. Allowed extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      });
    }

    const caseId = req.params.caseId;
    const legacyDocType = req.body.docType || null;
    const originalFilename = req.file.originalname || 'document.pdf';
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const duplicateExisting = findDuplicateDocumentByHash(caseId, fileHash);
    const job = createDocumentIngestJob({
      caseId,
      originalFilename,
      maxRetries: 2,
    });
    ingestJobId = job?.id || null;

    const nameHint = classifyDocument(originalFilename, '', legacyDocType).docType;
    const storedFilename = buildStoredFilename({
      caseId,
      docTypeHint: duplicateExisting?.doc_type || nameHint,
      originalFilename,
      fileHash,
    });

    // 1. Extract text from uploaded PDF/image when possible.
    let extractedText = '';
    let pageCount = 0;
    let extractionMethod = 'not_run';
    const warnings = [];

    await runDocumentIngestStep(
      ingestJobId,
      'upload',
      { maxAttempts: 1, fatalOnFinalFailure: true },
      async () => ({ meta: { bytes: req.file.size, ext: uploadKind.ext, fileHash } }),
    );

    const ocrRun = await runDocumentIngestStep(
      ingestJobId,
      'ocr',
      {
        maxAttempts: 2,
        fatalOnFinalFailure: false,
        recoverableActionsOnFailure: [
          { id: 'retry_ocr', label: 'Retry OCR', hint: 'Re-run OCR on this source file.' },
          { id: 'reupload_searchable_pdf', label: 'Re-upload Searchable PDF', hint: 'Provide a cleaner/searchable source document.' },
        ],
      },
      async () => {
        if (uploadKind.kind === 'pdf') {
          const { text, method } = await extractPdfText(req.file.buffer, client, MODEL);
          extractedText = text || '';
          extractionMethod = method || 'pdf_extract';
          try { const p = await pdfParse(req.file.buffer); pageCount = p.numpages || 0; } catch { pageCount = 0; }
          if (!extractedText) throw new Error('PDF extraction produced empty text');
          return { meta: { method: extractionMethod, textLength: extractedText.length, pageCount } };
        }

        const imageResult = await extractImageText(req.file.buffer, {
          aiClient: client,
          model: MODEL,
          ext: uploadKind.ext,
          mimeType: req.file.mimetype,
        });
        extractedText = imageResult.text || '';
        extractionMethod = imageResult.method || 'image_no_ocr';
        if (imageResult.error && !extractedText) {
          throw new Error(imageResult.error);
        }
        if (imageResult.error) warnings.push(imageResult.error);
        return { meta: { method: extractionMethod, textLength: extractedText.length, pageCount } };
      },
    );
    if (!ocrRun.ok) {
      extractionMethod = 'failed';
      warnings.push('OCR/text extraction failed; document saved without parsed text.');
    }

    extractedText = extractedText.replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();

    // 2. Persist uploaded bytes unless this is a duplicate.
    const docsDir = path.join(cd, 'documents');
    fs.mkdirSync(docsDir, { recursive: true });
    if (!duplicateExisting) {
      fs.writeFileSync(path.join(docsDir, storedFilename), req.file.buffer);
    } else {
      warnings.push(`Duplicate document detected (matches ${duplicateExisting.id}); skipped duplicate file write.`);
    }

    // 3. Register document row (classification + duplicate linkage).
    const shouldSkipExtraction = Boolean(duplicateExisting) || extractedText.length < 20;
    const ingestionWarning = warnings.length ? warnings.join(' ') : null;
    let documentId = null;
    let docType = 'unknown';
    let classification = null;
    let duplicateDetected = Boolean(duplicateExisting);
    let duplicateOfDocumentId = duplicateExisting?.id || null;
    let quality = null;

    await runDocumentIngestStep(
      ingestJobId,
      'classify',
      {
        maxAttempts: 1,
        fatalOnFinalFailure: true,
      },
      async () => {
        const registered = registerDocument({
          caseId,
          originalFilename,
          storedFilename,
          legacyDocType,
          fileSizeBytes: req.file.size,
          pageCount,
          extractedText,
          fileHash,
          extractionStatus: duplicateExisting ? 'skipped' : (extractedText ? 'extracted' : 'pending'),
          ingestionWarning,
        });

        documentId = registered.documentId;
        docType = registered.docType;
        classification = registered.classification;
        duplicateDetected = registered.duplicateDetected;
        duplicateOfDocumentId = registered.duplicateOfDocumentId;
        quality = registered.quality;
        attachDocumentToIngestJob(ingestJobId, documentId);
        return {
          meta: {
            docType,
            classificationMethod: classification?.method || 'unknown',
            classificationConfidence: classification?.confidence ?? null,
            duplicateDetected,
          },
        };
      },
    );

    // 4. Update canonical case projection with ingestion artifacts.
    const runtime = getCaseRuntime(caseId);
    if (!runtime) {
      return res.status(404).json({ error: 'Case not found' });
    }
    const docText = { ...(runtime.docText || {}) };
    const docTextKey = legacyDocType || docType;
    if (extractedText) docText[docTextKey] = extractedText;

    const meta = { ...(runtime.meta || {}) };
    meta.updatedAt = new Date().toISOString();
    if (!meta.docs) meta.docs = {};
    meta.docs[docTextKey] = {
      uploadedAt: new Date().toISOString(),
      pages: pageCount,
      bytes: req.file.size,
      documentId,
      docType,
      duplicateOf: duplicateOfDocumentId || null,
      warning: ingestionWarning,
    };
    await runDocumentIngestStep(
      ingestJobId,
      'stage',
      {
        maxAttempts: 1,
        fatalOnFinalFailure: true,
      },
      async () => {
        saveCaseRuntime(caseId, runtime, { meta, docText });
        return {
          meta: {
            docTextKey,
            textLength: extractedText.length,
            warningCount: warnings.length,
          },
        };
      },
    );

    // 5. Run extraction for eligible documents only.
    let extractionResult = null;
    if (!shouldSkipExtraction) {
      const extractRun = await runDocumentIngestStep(
        ingestJobId,
        'extract',
        {
          maxAttempts: 2,
          fatalOnFinalFailure: false,
          recoverableActionsOnFailure: [
            { id: 'rerun_extraction', label: 'Retry Extraction', hint: 'Re-run structured extraction for this document.' },
            { id: 'review_text_source', label: 'Review Text Source', hint: 'Inspect OCR/parsing output before extraction.' },
          ],
        },
        async () => {
          extractionResult = await runDocumentExtraction(documentId, extractedText, { aiClient: client, model: MODEL });
          return {
            meta: {
              factsExtracted: extractionResult?.factsExtracted || 0,
              sectionsExtracted: extractionResult?.sectionsExtracted || 0,
            },
          };
        },
      );

      if (!extractRun.ok) {
        log.warn('[documents] Extraction failed for', documentId);
        warnings.push('Structured extraction failed. Retry is available from ingest job actions.');
      }
    } else if (!duplicateExisting && extractedText.length < 20) {
      warnings.push('Text content was too short for structured extraction.');
      skipDocumentIngestStep(ingestJobId, 'extract', 'text_too_short');
    } else if (duplicateExisting) {
      skipDocumentIngestStep(ingestJobId, 'extract', 'duplicate_document');
    }

    const finalizedJob = finalizeDocumentIngestJob(ingestJobId);

    log.info('[documents] Upload complete', {
      caseId, documentId, docType, classification: classification.method,
      confidence: classification.confidence, textLength: extractedText.length,
      factsExtracted: extractionResult?.factsExtracted || 0,
      sectionsExtracted: extractionResult?.sectionsExtracted || 0,
      duplicateDetected,
      ingestJobId,
      ingestJobStatus: finalizedJob?.status || null,
    });

    res.json({
      ok: true,
      documentId,
      docType,
      classification,
      duplicateDetected,
      duplicateOfDocumentId,
      extractionMethod,
      textLength: extractedText.length,
      wordCount: extractedText.split(/\s+/).filter(Boolean).length,
      pageCount,
      preview: extractedText.slice(0, 400),
      warnings,
      quality,
      extraction: extractionResult ? {
        factsExtracted: extractionResult.factsExtracted,
        sectionsExtracted: extractionResult.sectionsExtracted,
      } : null,
      ingestJob: finalizedJob ? {
        id: finalizedJob.id,
        status: finalizedJob.status,
        currentStep: finalizedJob.currentStep,
        retryCount: finalizedJob.retryCount,
        recoverableActions: finalizedJob.recoverableActions,
      } : null,
    });

  } catch (err) {
    if (ingestJobId) {
      const job = getDocumentIngestJob(ingestJobId);
      if (!job || job.status !== 'failed') {
        setDocumentIngestJobStatus(ingestJobId, {
          status: 'failed',
          errorText: err.message,
          currentStep: job?.currentStep || 'upload',
          recoverableActions: [
            { id: 'retry_upload', label: 'Retry Upload', hint: 'Try upload again for this document.' },
          ],
          completed: true,
        });
      }
    }
    log.error('[documents] Upload error:', err.message);
    res.status(500).json({ error: err.message, ingestJobId });
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
        quality: scoreDocumentQuality(d),
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
      document: {
        ...doc,
        label: DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type,
        quality: scoreDocumentQuality(doc),
      },
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

    // Get extracted text from canonical docText projection or re-read from file
    const runtime = getCaseRuntime(req.params.caseId);
    const docText = runtime?.docText || {};
    const text = await loadDocumentTextForExtraction({
      doc,
      caseDir: req.caseDir,
      runtimeDocText: docText,
    });

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
// Ingestion job status endpoints (Phase C)
router.get('/cases/:caseId/ingest-jobs', (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const jobs = listCaseDocumentIngestJobs(req.params.caseId, limit);
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cases/:caseId/ingest-jobs/:jobId', (req, res) => {
  try {
    const job = getDocumentIngestJob(req.params.jobId);
    if (!job || job.caseId !== req.params.caseId) {
      return res.status(404).json({ error: 'Ingest job not found' });
    }
    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cases/:caseId/ingest-jobs/:jobId/retry', async (req, res) => {
  try {
    const step = String(req.body?.step || 'extract').toLowerCase();
    const job = getDocumentIngestJob(req.params.jobId);
    if (!job || job.caseId !== req.params.caseId) {
      return res.status(404).json({
        ok: false,
        code: 'INGEST_JOB_NOT_FOUND',
        error: 'Ingest job not found',
      });
    }
    if (step !== 'extract') {
      return res.status(400).json({
        ok: false,
        code: 'INGEST_STEP_UNSUPPORTED',
        error: 'Only extract step retry is currently supported.',
      });
    }
    if (!isDocumentIngestStepFailed(job, step)) {
      return res.status(409).json({
        ok: false,
        code: 'INGEST_STEP_NOT_FAILED',
        error: 'Requested step is not in failed state.',
      });
    }
    const retryState = getDocumentIngestRetryState(job, step);
    if (!retryState.ok && retryState.reason === 'retry_limit_reached') {
      return res.status(409).json({
        ok: false,
        error: `Retry limit reached for this ingest job (${retryState.retryCount}/${retryState.maxRetries}).`,
        code: 'INGEST_RETRY_LIMIT_REACHED',
        retryCount: retryState.retryCount,
        maxRetries: retryState.maxRetries,
      });
    }
    if (!job.documentId) {
      return res.status(400).json({
        ok: false,
        code: 'INGEST_JOB_MISSING_DOCUMENT',
        error: 'Ingest job has no linked document.',
      });
    }

    const doc = getDocument(job.documentId);
    if (!doc || doc.case_id !== req.params.caseId) {
      return res.status(404).json({
        ok: false,
        code: 'INGEST_DOCUMENT_NOT_FOUND',
        error: 'Linked document not found',
      });
    }

    const runtime = getCaseRuntime(req.params.caseId);
    const text = await loadDocumentTextForExtraction({
      doc,
      caseDir: req.caseDir,
      runtimeDocText: runtime?.docText || {},
    });
    if (!text || text.length < 20) {
      return res.status(400).json({
        ok: false,
        code: 'INGEST_RETRY_NO_TEXT',
        error: 'No text available for extraction retry.',
      });
    }

    const stepRun = await runDocumentIngestStep(
      job.id,
      'extract',
      {
        maxAttempts: Math.max(1, Number(job.maxRetries || 2)),
        fatalOnFinalFailure: false,
        recoverableActionsOnFailure: [
          { id: 'rerun_extraction', label: 'Retry Extraction', hint: 'Run extraction again after reviewing text source.' }
        ],
      },
      async () => {
        const result = await runDocumentExtraction(doc.id, text, { aiClient: client, model: MODEL });
        return {
          meta: {
            factsExtracted: result?.factsExtracted || 0,
            sectionsExtracted: result?.sectionsExtracted || 0,
          },
          result,
        };
      }
    );

    const finalized = finalizeDocumentIngestJob(job.id);
    res.json({
      ok: true,
      retry: stepRun.ok,
      attempts: stepRun.attempts,
      job: finalized,
      extraction: stepRun.result?.result || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
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

