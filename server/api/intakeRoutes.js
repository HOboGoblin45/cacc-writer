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

import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { parseOrderText, getMissingRequiredFields, buildFactsFromOrder } from '../intake/orderParser.js';
import { parseAciXml, extractAndSavePdf, buildFactsFromXml } from '../intake/xmlParser.js';
import { casePath, normalizeFormType } from '../utils/caseUtils.js';
import { applyMetaDefaults, extractMetaFields } from '../caseMetadata.js';
import { trimText } from '../utils/textUtils.js';
import { saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { client, MODEL } from '../openaiClient.js';
import log from '../logger.js';
import { logNewJob } from '../integrations/googleSheets.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { geocodeAddress } from '../geocoder.js';
import { getNeighborhoodBoundaryFeatures } from '../neighborhoodContext.js';
import { CACC_APPRAISALS_ROOT } from '../config/productionScope.js';
import { sendErrorResponse } from '../utils/errorResponse.js';

const router = Router();

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const createFolderSchema = z.object({
  caseId: z.string().min(1).max(20).optional(),
  orderDate: z.string().datetime().optional(),
  borrowerName: z.string().min(1).max(120),
  address: z.string().min(1).max(200),
});

const scanFolderSchema = z.object({
  folderPath: z.string().min(1).max(500),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

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
function sanitizePathSegment(value, fallback = 'unknown', maxLen = 80) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, maxLen) || fallback;
}

function resolveAllowedIntakeFolderPath(folderPath) {
  const trimmed = String(folderPath || '').trim();
  if (!trimmed) return null;

  const allowedRoot = path.resolve(CACC_APPRAISALS_ROOT);
  const resolved = path.resolve(trimmed);
  const relative = path.relative(allowedRoot, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

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

    // Check file size < 50MB
    const MAX_PDF_BYTES = 50 * 1024 * 1024;
    if (req.file.size > MAX_PDF_BYTES) {
      return res.status(413).json({
        ok: false,
        code: 'FILE_TOO_LARGE',
        error: `PDF file too large (${Math.round(req.file.size / 1024 / 1024)}MB). Maximum size is 50MB.`,
      });
    }

    // Extract text from PDF
    const pdfBuffer = await readUploadedFile(req.file);
    const { text, method: extractionMethod, error: extractionError } = await extractPdfText(
      pdfBuffer,
      client,
      MODEL,
    );

    if (!text || text.length < 50) {
      const isScanned = extractionMethod === 'ocr-vision' ||
        (extractionError || '').toLowerCase().includes('image') ||
        (extractionError || '').toLowerCase().includes('scan');
      return res.status(422).json({
        ok: false,
        code: 'PDF_EXTRACTION_FAILED',
        error: isScanned
          ? 'PDF appears to be a scanned image - text extraction failed. Please use a text-based PDF.'
          : (extractionError || 'Could not extract text from PDF'),
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

    // Auto-geocode if address available (non-fatal, runs in background)
    if (extracted.address) {
      (async () => {
        try {
          const geoResult = await geocodeAddress(extracted.address);
          if (geoResult) {
            const cd = casePath(caseId);
            const geocodeData = {
              subject: { address: extracted.address, result: geoResult },
              comps: [],
              geocodedAt: new Date().toISOString(),
              autoGeocoded: true,
            };
            writeJSON(path.join(cd, 'geocode.json'), geocodeData);
            // Fetch and save boundary roads into facts
            try {
              const boundaryFeatures = await getNeighborhoodBoundaryFeatures(geoResult.lat, geoResult.lng, 1.5);
              if (boundaryFeatures?.boundaryRoads) {
                const { north, south, east, west } = boundaryFeatures.boundaryRoads;
                const existingFacts = readJSON(path.join(cd, 'facts.json'), {});
                const updatedFacts = {
                  ...existingFacts,
                  neighborhood_boundary_north: north || existingFacts.neighborhood_boundary_north || null,
                  neighborhood_boundary_south: south || existingFacts.neighborhood_boundary_south || null,
                  neighborhood_boundary_east: east || existingFacts.neighborhood_boundary_east || null,
                  neighborhood_boundary_west: west || existingFacts.neighborhood_boundary_west || null,
                };
                writeJSON(path.join(cd, 'facts.json'), updatedFacts);
                log.info('intake:auto-geocode:boundary-saved', { caseId, north, south, east, west });
              }
            } catch (boundaryErr) {
              log.warn('intake:auto-geocode:boundary-failed', { caseId, error: boundaryErr.message });
            }
            log.info('intake:auto-geocode:complete', { caseId, lat: geoResult.lat, lng: geoResult.lng });
          }
        } catch (geoErr) {
          log.warn('intake:auto-geocode:failed', { caseId, error: geoErr.message });
        }
      })();
    }

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
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

// ── POST /api/intake/create-folder ───────────────────────────────────────────

/**
 * Create the standard CACC Appraisals folder structure for a job.
 *
 * Body: { caseId?, orderDate?, borrowerName, address }
 * Returns: { ok, folderPath, created }
 */
router.post('/intake/create-folder', validateBody(createFolderSchema), (req, res) => {
  try {
    const body = req.validated;
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
    return sendErrorResponse(res, err);
  }
});

// ── POST /api/intake/scan-job-folder ─────────────────────────────────────────

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
router.post('/intake/scan-job-folder', validateBody(scanFolderSchema), (req, res) => {
  try {
    const body = req.validated;
    const folderPath = resolveAllowedIntakeFolderPath(body.folderPath);
    if (!folderPath) {
      return res.status(403).json({
        ok: false,
        code: 'FOLDER_PATH_NOT_ALLOWED',
        error: `folderPath must be inside ${CACC_APPRAISALS_ROOT}`,
      });
    }

    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({
        ok: false,
        code: 'FOLDER_NOT_FOUND',
        error: `Folder not found: ${folderPath}`,
      });
    }

    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        ok: false,
        code: 'NOT_A_DIRECTORY',
        error: `Path is not a directory: ${folderPath}`,
      });
    }

    const result = classifyFiles(folderPath);

    res.json({
      ok: true,
      folderPath,
      assignmentSheet: result.assignmentSheet,
      completedReport: result.completedReport,
      otherFiles: result.otherFiles,
      allPdfs: result.allPdfs,
    });
  } catch (err) {
    log.error('intake:scan-job-folder', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

// ── POST /api/intake/xml ──────────────────────────────────────────────────────

/**
 * Accept an ACI VALUATION_RESPONSE XML export, extract all structured facts,
 * create a cacc-writer case, and save the embedded PDF for voice training.
 *
 * Multipart body:
 *   file: XML file (required, .xml or .XML)
 *
 * Returns:
 *   { ok, caseId, extracted, comps, narrativeKeys, hasPdf, savedPdfPath, meta, facts }
 */
router.post('/intake/xml', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, code: 'MISSING_FILE', error: 'An XML file is required (multipart field: file)' });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.xml'].includes(ext)) {
      return res.status(415).json({ ok: false, code: 'UNSUPPORTED_FILE_TYPE', error: 'Only .xml files are accepted for XML intake' });
    }

    const MAX_XML_BYTES = 100 * 1024 * 1024; // 100MB — ACI XMLs can be large (embedded PDF)
    if (req.file.size > MAX_XML_BYTES) {
      return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', error: `XML file too large (${Math.round(req.file.size / 1024 / 1024)}MB). Maximum is 100MB.` });
    }

    const xmlContent = await readUploadedFile(req.file, 'utf8');

    // Validate it's a VALUATION_RESPONSE
    if (!xmlContent.includes('<VALUATION_RESPONSE') && !xmlContent.includes('VALUATION_RESPONSE')) {
      return res.status(422).json({ ok: false, code: 'INVALID_XML_FORMAT', error: 'File does not appear to be an ACI VALUATION_RESPONSE XML. Expected root tag: <VALUATION_RESPONSE>' });
    }

    // Parse the XML
    const { extracted, comps, narratives, hasPdf, pdfBase64 } = parseAciXml(xmlContent);

    // Determine form type
    const formTypeCode = extracted.formTypeCode || '1004';

    // Build case
    let caseId = '';
    let caseDir = '';
    do {
      caseId = uuidv4().replace(/-/g, '').slice(0, 8);
      caseDir = casePath(caseId);
    } while (fs.existsSync(caseDir));

    const baseMeta = {
      caseId,
      address: trimText(extracted.address || extracted.streetAddress || '', 240),
      borrower: trimText(extracted.borrowerName || '', 180),
      formType: normalizeFormType(formTypeCode),
      status: 'active',
      pipelineStage: 'intake',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intakeSource: 'aci-xml',
    };

    const metaExtras = {};
    if (extracted.lenderName) metaExtras.lenderName = trimText(extracted.lenderName, 200);
    if (extracted.county) metaExtras.county = trimText(extracted.county, 100);
    if (extracted.city) metaExtras.city = trimText(extracted.city, 100);
    if (extracted.state) metaExtras.state = trimText(extracted.state, 50);
    if (extracted.appraiserFileId) metaExtras.notes = `ACI File: ${extracted.appraiserFileId}`;

    const meta = applyMetaDefaults({ ...baseMeta, ...metaExtras });
    const facts = buildFactsFromXml(extracted, comps);

    // Create case on disk
    fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });
    saveCaseProjection({ caseId, meta, facts, provenance: {}, outputs: {}, history: {}, docText: {} });

    // Save narratives from addendum
    if (Object.keys(narratives).length > 0) {
      writeJSON(path.join(caseDir, 'xml_narratives.json'), narratives);
    }

    // Save comps
    if (comps.length > 0) {
      writeJSON(path.join(caseDir, 'xml_comps.json'), comps);
    }

    // Extract and save embedded PDF for voice training
    let savedPdfPath = null;
    if (hasPdf && pdfBase64) {
      const baseFilename = sanitizePathSegment(
        extracted.appraiserFileId || (req.file.originalname || 'aci-report').replace(/\.xml$/i, ''),
        'aci-report',
        120,
      );
      const voiceFormType = sanitizePathSegment(normalizeFormType(formTypeCode), 'unknown', 24);
      const projectRoot = path.resolve(caseDir, '..', '..');
      const voicePdfDir = path.join(
        projectRoot,
        'voice_pdfs',
        voiceFormType,
      );
      savedPdfPath = extractAndSavePdf(pdfBase64, voicePdfDir, baseFilename);
    }

    log.info('intake:xml:created', {
      caseId,
      formTypeCode,
      address: extracted.address,
      compsCount: comps.length,
      narrativeKeys: Object.keys(narratives),
      hasPdf,
      savedPdfPath,
    });

    // Auto-geocode in background
    if (extracted.lat && extracted.lng) {
      // Already have lat/lng from MapReferenceIdentifier
      const geocodeData = {
        subject: {
          address: extracted.address || '',
          result: { lat: extracted.lat, lng: extracted.lng, source: 'aci-xml' },
        },
        comps: comps.filter(c => c.lat && c.lng).map(c => ({
          address: c.address,
          lat: parseFloat(c.lat),
          lng: parseFloat(c.lng),
        })),
        geocodedAt: new Date().toISOString(),
        autoGeocoded: true,
      };
      writeJSON(path.join(caseDir, 'geocode.json'), geocodeData);
    } else if (extracted.address) {
      // Fall back to geocoding API
      (async () => {
        try {
          const geoResult = await geocodeAddress(extracted.address);
          if (geoResult) {
            writeJSON(path.join(caseDir, 'geocode.json'), {
              subject: { address: extracted.address, result: geoResult },
              comps: [],
              geocodedAt: new Date().toISOString(),
              autoGeocoded: true,
            });
          }
        } catch (geoErr) {
          log.warn('intake:xml:geocode-failed', { caseId, error: geoErr.message });
        }
      })();
    }

    res.json({
      ok: true,
      caseId,
      extracted,
      comps,
      narrativeKeys: Object.keys(narratives),
      narrativeSummary: Object.fromEntries(
        Object.entries(narratives).map(([k, v]) => [k, v.slice(0, 200) + (v.length > 200 ? '...' : '')])
      ),
      hasPdf,
      savedPdfPath,
      meta,
      facts,
    });
  } catch (err) {
    log.error('intake:xml', { error: err.message });
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

export default router;
