/**
 * server/api/importRoutes.js
 * ---------------------------
 * Import-into-existing-case endpoints.
 *
 * Routes:
 *   POST /api/cases/:caseId/import-order   — Upload assignment-sheet PDF → populate existing case
 *   POST /api/cases/:caseId/import-xml     — Upload ACI/alamode MISMO XML → populate existing case
 *
 * Unlike /api/intake/* (which create new cases), these endpoints update an existing case
 * with extracted data, merging it into the current facts and metadata.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';

import { upload, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { parseOrderText, buildFactsFromOrder } from '../intake/orderParser.js';
import { parseAciXml, buildFactsFromXml, extractAndSavePdf } from '../intake/xmlParser.js';
import { casePath, normalizeFormType } from '../utils/caseUtils.js';
import { applyMetaDefaults } from '../caseMetadata.js';
import { trimText } from '../utils/textUtils.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { callAI, MODEL, client } from '../openaiClient.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { sendErrorResponse } from '../utils/errorResponse.js';
import log from '../logger.js';

const router = Router();

// ── AI extraction prompt for appraisal order documents ────────────────────────

const ORDER_EXTRACTION_PROMPT = `Extract all appraisal assignment details from this order document. Return a JSON object with these fields:
{
  "address": "full street address",
  "city": "",
  "state": "",
  "zipCode": "",
  "county": "",
  "borrower": "borrower name(s)",
  "lender": "lender/client name",
  "loanType": "conventional/FHA/VA/USDA",
  "loanProgram": "purchase/refinance/other",
  "propertyType": "single family/condo/multi-family",
  "formType": "1004/1025/1073",
  "salePrice": "",
  "saleDate": "",
  "legalDescription": "",
  "censusTract": "",
  "occupancy": "owner/tenant/vacant",
  "amcName": "",
  "feeAmount": "",
  "dueDate": "",
  "specialInstructions": ""
}
Only include fields you can confidently extract. Use null for fields not found.
Return ONLY the JSON object — no markdown fences, no explanation.`;

/**
 * Use GPT-4.1 to extract structured order data from raw text.
 * Falls back to parseOrderText() if AI call fails.
 */
async function aiExtractOrderData(pdfText) {
  try {
    const response = await callAI([
      {
        role: 'system',
        content: 'You are an expert at parsing appraisal order documents from AMCs (appraisal management companies). Extract data precisely and return valid JSON only.',
      },
      {
        role: 'user',
        content: `${ORDER_EXTRACTION_PROMPT}\n\n---ORDER DOCUMENT---\n${pdfText.slice(0, 12000)}`,
      },
    ], { model: MODEL, temperature: 0 });

    const raw = (response?.output_text || response?.text || '').trim();
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);

    // Normalise field names to match the rest of the codebase
    return {
      address: parsed.address || null,
      city: parsed.city || null,
      state: parsed.state || null,
      zip: parsed.zipCode || null,
      county: parsed.county || null,
      borrowerName: parsed.borrower || null,
      lenderName: parsed.lender || null,
      loanType: parsed.loanType || null,
      loanProgram: parsed.loanProgram || null,
      propertyType: parsed.propertyType || null,
      formTypeCode: parsed.formType || null,
      salePrice: parsed.salePrice || null,
      saleDate: parsed.saleDate || null,
      legalDescription: parsed.legalDescription || null,
      censusTract: parsed.censusTract || null,
      occupancy: parsed.occupancy || null,
      amcName: parsed.amcName || null,
      fee: parsed.feeAmount || null,
      deliveryDate: parsed.dueDate || null,
      specialInstructions: parsed.specialInstructions || null,
      _extractedByAI: true,
    };
  } catch (aiErr) {
    log.warn('importRoutes:ai-extract-failed', { error: aiErr.message });
    // Graceful fallback to regex parser
    return parseOrderText(pdfText);
  }
}

/**
 * Merge new facts into existing case facts (deep-merge, new values win).
 */
function mergeFacts(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [section, sectionData] of Object.entries(incoming)) {
    if (section === 'comps' || Array.isArray(sectionData)) {
      // Arrays: only add if not already present
      if (!merged[section]) merged[section] = sectionData;
    } else if (sectionData && typeof sectionData === 'object') {
      merged[section] = { ...(merged[section] || {}), ...sectionData };
    } else {
      merged[section] = sectionData;
    }
  }
  return merged;
}

// ── POST /api/cases/:caseId/import-order ─────────────────────────────────────

/**
 * Upload an AMC assignment-sheet PDF and auto-populate an existing case.
 *
 * Multipart body: file (PDF)
 * Returns: { ok, caseId, extracted, updatedFields, meta }
 */
router.post('/cases/:caseId/import-order', upload.single('file'), async (req, res) => {
  const { caseId } = req.params;

  try {
    // Validate case exists
    const projection = getCaseProjection(caseId);
    if (!projection) {
      return res.status(404).json({ ok: false, code: 'CASE_NOT_FOUND', error: `Case not found: ${caseId}` });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, code: 'MISSING_FILE', error: 'A PDF file is required (multipart field: file)' });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const mime = req.file.mimetype || '';
    if (!mime.includes('pdf') && ext !== '.pdf') {
      return res.status(415).json({ ok: false, code: 'UNSUPPORTED_FILE_TYPE', error: 'Only PDF files are accepted for order import' });
    }

    if (req.file.size > 50 * 1024 * 1024) {
      return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', error: 'PDF must be under 50MB' });
    }

    // 1. Extract text from PDF
    const pdfBuffer = await readUploadedFile(req.file);
    const { text, method: extractionMethod, error: extractionError } = await extractPdfText(pdfBuffer, client, MODEL);

    if (!text || text.length < 30) {
      return res.status(422).json({
        ok: false,
        code: 'PDF_EXTRACTION_FAILED',
        error: extractionError || 'Could not extract text from PDF',
        extractionMethod,
      });
    }

    // 2. AI-powered extraction (falls back to regex parser)
    const extracted = await aiExtractOrderData(text);

    // 3. Build new facts from the extracted order data
    const newFacts = buildFactsFromOrder(extracted);

    // 4. Merge with existing facts
    const existingFacts = projection.facts || {};
    const mergedFacts = mergeFacts(existingFacts, newFacts);

    // 5. Update case metadata with extracted fields
    const existingMeta = projection.meta || {};
    const metaUpdates = { updatedAt: new Date().toISOString() };

    if (extracted.address && !existingMeta.address) metaUpdates.address = trimText(extracted.address, 240);
    if (extracted.borrowerName && !existingMeta.borrower) metaUpdates.borrower = trimText(extracted.borrowerName, 180);
    if (extracted.lenderName && !existingMeta.lenderName) metaUpdates.lenderName = trimText(extracted.lenderName, 200);
    if (extracted.loanType && !existingMeta.loanProgram) metaUpdates.loanProgram = trimText(extracted.loanType, 100);
    if (extracted.county && !existingMeta.county) metaUpdates.county = trimText(extracted.county, 100);
    if (extracted.city && !existingMeta.city) metaUpdates.city = trimText(extracted.city, 100);
    if (extracted.state && !existingMeta.state) metaUpdates.state = trimText(extracted.state, 50);
    if (extracted.formTypeCode && !existingMeta.formType) {
      metaUpdates.formType = normalizeFormType(extracted.formTypeCode);
    }

    const updatedMeta = applyMetaDefaults({ ...existingMeta, ...metaUpdates });

    // 6. Save updated projection
    const updatedProjection = saveCaseProjection({
      caseId,
      meta: updatedMeta,
      facts: mergedFacts,
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });

    // Summarise what was updated for the toast message
    const updatedFields = Object.keys(metaUpdates).filter(k => k !== 'updatedAt');

    log.info('importRoutes:order:imported', {
      caseId,
      address: extracted.address,
      borrower: extracted.borrowerName,
      lender: extracted.lenderName,
      extractionMethod,
      extractedByAI: extracted._extractedByAI,
    });

    res.json({
      ok: true,
      caseId,
      extracted,
      updatedFields,
      meta: updatedProjection.meta,
      facts: mergedFacts,
      extractionMethod,
    });
  } catch (err) {
    log.error('importRoutes:import-order', { caseId, error: err.message });
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

// ── POST /api/cases/:caseId/import-xml ───────────────────────────────────────

/**
 * Upload an ACI/alamode MISMO XML export and auto-populate an existing case.
 *
 * Multipart body: file (XML)
 * Returns: { ok, caseId, extracted, comps, narrativeKeys, hasPdf, meta, facts }
 */
router.post('/cases/:caseId/import-xml', upload.single('file'), async (req, res) => {
  const { caseId } = req.params;

  try {
    // Validate case exists
    const projection = getCaseProjection(caseId);
    if (!projection) {
      return res.status(404).json({ ok: false, code: 'CASE_NOT_FOUND', error: `Case not found: ${caseId}` });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, code: 'MISSING_FILE', error: 'An XML file is required (multipart field: file)' });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.xml') {
      return res.status(415).json({ ok: false, code: 'UNSUPPORTED_FILE_TYPE', error: 'Only .xml files are accepted for XML import' });
    }

    if (req.file.size > 100 * 1024 * 1024) {
      return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', error: 'XML must be under 100MB' });
    }

    const xmlContent = await readUploadedFile(req.file, 'utf8');

    if (!xmlContent.includes('<VALUATION_RESPONSE') && !xmlContent.includes('VALUATION_RESPONSE')) {
      return res.status(422).json({
        ok: false,
        code: 'INVALID_XML_FORMAT',
        error: 'File does not appear to be an ACI VALUATION_RESPONSE XML',
      });
    }

    // 1. Parse the XML
    const { extracted, comps, narratives, hasPdf, pdfBase64 } = parseAciXml(xmlContent);

    // 2. Build facts from XML data
    const newFacts = buildFactsFromXml(extracted, comps);

    // 3. Merge with existing facts
    const existingFacts = projection.facts || {};
    const mergedFacts = mergeFacts(existingFacts, newFacts);

    // 4. Update case metadata
    const existingMeta = projection.meta || {};
    const metaUpdates = { updatedAt: new Date().toISOString() };

    const xmlAddress = extracted.address || extracted.streetAddress;
    if (xmlAddress && !existingMeta.address) metaUpdates.address = trimText(xmlAddress, 240);
    if (extracted.borrowerName && !existingMeta.borrower) metaUpdates.borrower = trimText(extracted.borrowerName, 180);
    if (extracted.lenderName && !existingMeta.lenderName) metaUpdates.lenderName = trimText(extracted.lenderName, 200);
    if (extracted.county && !existingMeta.county) metaUpdates.county = trimText(extracted.county, 100);
    if (extracted.city && !existingMeta.city) metaUpdates.city = trimText(extracted.city, 100);
    if (extracted.state && !existingMeta.state) metaUpdates.state = trimText(extracted.state, 50);
    if (extracted.formTypeCode && !existingMeta.formType) {
      metaUpdates.formType = normalizeFormType(extracted.formTypeCode);
    }

    const updatedMeta = applyMetaDefaults({ ...existingMeta, ...metaUpdates });

    // 5. Save updated projection
    const updatedProjection = saveCaseProjection({
      caseId,
      meta: updatedMeta,
      facts: mergedFacts,
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });

    // 6. Save narratives and comps as supplementary files
    const caseDir = casePath(caseId);
    if (Object.keys(narratives).length > 0) {
      writeJSON(path.join(caseDir, 'xml_narratives.json'), narratives);
    }
    if (comps.length > 0) {
      writeJSON(path.join(caseDir, 'xml_comps.json'), comps);
    }

    // 7. Extract embedded PDF if present
    let savedPdfPath = null;
    if (hasPdf && pdfBase64) {
      const baseFilename = (req.file.originalname || 'aci-report').replace(/\.xml$/i, '');
      const voiceFormType = normalizeFormType(extracted.formTypeCode || '1004');
      const projectRoot = path.resolve(caseDir, '..', '..');
      const voicePdfDir = path.join(projectRoot, 'voice_pdfs', voiceFormType);
      savedPdfPath = extractAndSavePdf(pdfBase64, voicePdfDir, baseFilename);
    }

    log.info('importRoutes:xml:imported', {
      caseId,
      address: xmlAddress,
      compsCount: comps.length,
      narrativeKeys: Object.keys(narratives),
      hasPdf,
    });

    res.json({
      ok: true,
      caseId,
      extracted,
      comps,
      narrativeKeys: Object.keys(narratives),
      hasPdf,
      savedPdfPath,
      meta: updatedProjection.meta,
      facts: mergedFacts,
    });
  } catch (err) {
    log.error('importRoutes:import-xml', { caseId, error: err.message });
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

export default router;
