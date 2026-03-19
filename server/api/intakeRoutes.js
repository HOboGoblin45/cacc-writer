/**
 * server/api/intakeRoutes.js
 * ---------------------------
 * Order intake automation endpoints.
 *
 * Routes:
 *   POST /api/intake/order              — Upload assignment sheet PDF, parse it, create case
 *   POST /api/intake/create-folder      — Create the standard CACC Appraisals folder structure
 *   POST /api/intake/scan-job-folder    — Scan an existing job folder for key files
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { upload } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { parseOrderText, getMissingRequiredFields, buildFactsFromOrder } from '../intake/orderParser.js';
import { casePath, normalizeFormType } from '../utils/caseUtils.js';
import { applyMetaDefaults, extractMetaFields } from '../caseMetadata.js';
import { trimText } from '../utils/textUtils.js';
import { saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { client, MODEL } from '../openaiClient.js';
import log from '../logger.js';
import { logNewJob } from '../integrations/googleSheets.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

// Month name → zero-padded number
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function getMonthName(monthNum) {
  return MONTH_NAMES[monthNum - 1] || String(monthNum);
}

/**
 * Build the CACC Appraisals folder path for a job.
 *
 * Pattern: CACC Appraisals\[YYYY] Appraisals\[Month]\[YYYY-MM-DD] - [BorrowerName] - [Address]
 */
const CACC_APPRAISALS_ROOT = 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals';

function buildJobFolderPath({ orderDate, borrowerName, address }) {
  let yyyy, mm, dd, monthNum;
  if (orderDate) {
    // Parse date string directly to avoid timezone issues
    // Support YYYY-MM-DD or ISO strings
    const isoMatch = String(orderDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      yyyy = parseInt(isoMatch[1], 10);
      monthNum = parseInt(isoMatch[2], 10);
      dd = isoMatch[3];
      mm = isoMatch[2];
    } else {
      // Fall back to Date parsing for other formats
      const date = new Date(orderDate);
      yyyy = date.getFullYear();
      monthNum = date.getMonth() + 1;
      mm = String(monthNum).padStart(2, '0');
      dd = String(date.getDate()).padStart(2, '0');
    }
  } else {
    const date = new Date();
    yyyy = date.getFullYear();
    monthNum = date.getMonth() + 1;
    mm = String(monthNum).padStart(2, '0');
    dd = String(date.getDate()).padStart(2, '0');
  }
  const monthName = getMonthName(monthNum);
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Sanitize borrower and address for filesystem use
  const safeBorrower = (borrowerName || 'Unknown').replace(/[<>:"\/\\|?*]/g, '').trim().slice(0, 60);
  const safeAddress = (address || 'Unknown').replace(/[<>:"\/\\|?*]/g, '').trim().slice(0, 80);
  const folderName = `${dateStr} - ${safeBorrower} - ${safeAddress}`;

  return path.join(CACC_APPRAISALS_ROOT, `${yyyy} Appraisals`, monthName, folderName);
}

// ── POST /api/intake/order ────────────────────────────────────────────────────

/**
 * Accept a PDF assignment sheet, extract order fields, create a cacc-writer case.
 *
 * Multipart body:
 *   file: PDF file (required)
 *
 * Returns:
 *   { ok, caseId, extracted, missingFields, meta }
 */
router.post('/intake/order', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        code: 'MISSING_FILE',
        error: 'A PDF file is required (multipart field: file)',
      });
    }

    const mime = req.file.mimetype || '';
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!mime.includes('pdf') && ext !== '.pdf') {
      return res.status(415).json({
        ok: false,
        code: 'UNSUPPORTED_FILE_TYPE',
        error: 'Only PDF files are accepted for order intake',
      });
    }

    // Extract text from PDF
    const { text, method: extractionMethod, error: extractionError } = await extractPdfText(
      req.file.buffer,
      client,
      MODEL,
    );

    if (!text || text.length < 50) {
      return res.status(422).json({
        ok: false,
        code: 'PDF_EXTRACTION_FAILED',
        error: extractionError || 'Could not extract text from PDF',
        extractionMethod,
      });
    }

    // Parse order fields from the extracted text
    const extracted = parseOrderText(text);
    const missingFields = getMissingRequiredFields(extracted);

    // Determine form type
    const formTypeCode = extracted.formTypeCode || '1004';
    const normalizedFormType = normalizeFormType(formTypeCode);

    // Build case metadata
    let caseId = '';
    let caseDir = '';
    do {
      caseId = uuidv4().replace(/-/g, '').slice(0, 8);
      caseDir = casePath(caseId);
    } while (fs.existsSync(caseDir));

    const baseMeta = {
      caseId,
      address: trimText(extracted.address, 240) || '',
      borrower: trimText(extracted.borrowerName, 180) || '',
      formType: normalizedFormType,
      status: 'active',
      pipelineStage: 'intake',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Apply any optional meta fields from extracted
    const metaExtras = {};
    if (extracted.lenderName) metaExtras.lenderName = trimText(extracted.lenderName, 200);
    if (extracted.loanType) metaExtras.loanProgram = trimText(extracted.loanType, 100);
    if (extracted.county) metaExtras.county = trimText(extracted.county, 100);
    if (extracted.city) metaExtras.city = trimText(extracted.city, 100);
    if (extracted.state) metaExtras.state = trimText(extracted.state, 50);
    if (extracted.orderID) metaExtras.notes = `Order ID: ${extracted.orderID}`;

    const meta = applyMetaDefaults({ ...baseMeta, ...metaExtras });

    // Build facts from extracted order data
    const facts = buildFactsFromOrder(extracted);

    // Create the case on disk + in DB
    fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });
    const projection = saveCaseProjection({
      caseId,
      meta,
      facts,
      provenance: {},
      outputs: {},
      history: {},
      docText: {},
    });

    log.info('intake:order:created', {
      caseId,
      orderID: extracted.orderID,
      address: extracted.address,
      extractionMethod,
    });

    // Log the new job to CSV (and Google Sheets when configured)
    logNewJob(extracted).catch(err => {
      log.warn('intake:order:log-job-failed', { error: err.message });
    });

    res.json({
      ok: true,
      caseId,
      extracted,
      missingFields,
      meta: projection.meta,
      facts,
      extractionMethod,
    });
  } catch (err) {
    log.error('intake:order', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/intake/create-folder ───────────────────────────────────────────

const createFolderSchema = z.object({
  caseId: z.string().optional(),
  orderDate: z.string().optional(),
  borrowerName: z.string().min(1).max(120),
  address: z.string().min(1).max(200),
});

/**
 * Create the standard CACC Appraisals folder structure for a job.
 *
 * Body: { caseId?, orderDate?, borrowerName, address }
 * Returns: { ok, folderPath, created }
 */
router.post('/intake/create-folder', (req, res) => {
  const body = parsePayload(createFolderSchema, req.body || {}, res);
  if (!body) return;

  try {
    const folderPath = buildJobFolderPath({
      orderDate: body.orderDate || new Date().toISOString(),
      borrowerName: body.borrowerName,
      address: body.address,
    });

    let created = false;
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      created = true;
    }

    log.info('intake:create-folder', { folderPath, created, caseId: body.caseId });

    res.json({ ok: true, folderPath, created });
  } catch (err) {
    log.error('intake:create-folder', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/intake/scan-job-folder ─────────────────────────────────────────

const scanFolderSchema = z.object({
  folderPath: z.string().min(1).max(500),
});

// Patterns that identify assignment sheets vs completed reports
const ASSIGNMENT_SHEET_PATTERNS = [
  /assignment[_\s-]*sheet/i,
  /order[_\s-]*sheet/i,
  /appraisal[_\s-]*(?:assignment|order|request)/i,
  /request[_\s-]*form/i,
];

const COMPLETED_REPORT_PATTERNS = [
  /^\d{4,6}\.pdf$/i,    // e.g. 48759.PDF
  /final[_\s-]*report/i,
  /appraisal[_\s-]*report/i,
  /completed/i,
];

function classifyFiles(dirPath) {
  let assignmentSheet = null;
  let completedReport = null;
  const otherFiles = [];

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return { assignmentSheet: null, completedReport: null, otherFiles: [], error: err.message };
  }

  const pdfFiles = entries
    .filter(e => e.isFile() && /\.pdf$/i.test(e.name))
    .map(e => path.join(dirPath, e.name));

  for (const filePath of pdfFiles) {
    const name = path.basename(filePath);
    const isAssignment = ASSIGNMENT_SHEET_PATTERNS.some(p => p.test(name));
    const isCompleted = COMPLETED_REPORT_PATTERNS.some(p => p.test(name));

    if (isAssignment && !assignmentSheet) {
      assignmentSheet = filePath;
    } else if (isCompleted && !isAssignment && !completedReport) {
      completedReport = filePath;
    } else {
      otherFiles.push(filePath);
    }
  }

  // If we have exactly 2 PDFs and haven't classified one as completed,
  // the non-assignment-sheet one is the report
  if (!completedReport && pdfFiles.length === 2) {
    completedReport = pdfFiles.find(f => f !== assignmentSheet) || null;
  }

  // If only one PDF and we haven't classified anything
  if (pdfFiles.length === 1 && !assignmentSheet && !completedReport) {
    assignmentSheet = pdfFiles[0];
  }

  // Collect non-PDF files too
  const nonPdfFiles = entries
    .filter(e => e.isFile() && !/\.pdf$/i.test(e.name))
    .map(e => path.join(dirPath, e.name));

  return {
    assignmentSheet,
    completedReport,
    otherFiles: [...otherFiles, ...nonPdfFiles],
    allPdfs: pdfFiles,
  };
}

/**
 * Scan a job folder to locate the assignment sheet and completed report PDF.
 *
 * Body: { folderPath }
 * Returns: { ok, assignmentSheet, completedReport, otherFiles, allPdfs }
 */
router.post('/intake/scan-job-folder', (req, res) => {
  const body = parsePayload(scanFolderSchema, req.body || {}, res);
  if (!body) return;

  try {
    if (!fs.existsSync(body.folderPath)) {
      return res.status(404).json({
        ok: false,
        code: 'FOLDER_NOT_FOUND',
        error: `Folder not found: ${body.folderPath}`,
      });
    }

    const stat = fs.statSync(body.folderPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        ok: false,
        code: 'NOT_A_DIRECTORY',
        error: `Path is not a directory: ${body.folderPath}`,
      });
    }

    const result = classifyFiles(body.folderPath);

    res.json({
      ok: true,
      folderPath: body.folderPath,
      assignmentSheet: result.assignmentSheet,
      completedReport: result.completedReport,
      otherFiles: result.otherFiles,
      allPdfs: result.allPdfs,
    });
  } catch (err) {
    log.error('intake:scan-job-folder', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
