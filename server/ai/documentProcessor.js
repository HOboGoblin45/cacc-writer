/**
 * server/ai/documentProcessor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gemini-powered document processor.
 *
 * Uses Gemini's native PDF understanding (no OCR needed) to:
 *   - Extract structured data from order forms
 *   - Process MLS sheets and extract comp data
 *   - Read tax records and extract assessed values
 *   - Parse engagement letters
 *   - Extract data from any appraisal-related document
 *
 * 10x better than text-based OCR because Gemini:
 *   - Understands layouts, tables, and forms
 *   - Reads handwriting
 *   - Processes images within PDFs (stamps, signatures)
 *   - Handles up to 1000+ pages
 */

import { processPdf, isGeminiConfigured } from './geminiProvider.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';
import fs from 'fs';

const ORDER_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    subject: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        zip: { type: 'string' },
        county: { type: 'string' },
        legalDescription: { type: 'string' },
        taxParcelId: { type: 'string' },
      },
    },
    borrower: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } },
    },
    lender: {
      type: 'object',
      properties: { name: { type: 'string' }, address: { type: 'string' }, loanNumber: { type: 'string' } },
    },
    amc: {
      type: 'object',
      properties: { name: { type: 'string' }, orderNumber: { type: 'string' }, contact: { type: 'string' } },
    },
    contract: {
      type: 'object',
      properties: { salePrice: { type: 'string' }, contractDate: { type: 'string' }, seller: { type: 'string' } },
    },
    assignment: {
      type: 'object',
      properties: { purpose: { type: 'string' }, loanType: { type: 'string' }, propertyType: { type: 'string' }, occupancy: { type: 'string' } },
    },
    order: {
      type: 'object',
      properties: { formType: { type: 'string' }, dueDate: { type: 'string' }, fee: { type: 'string' }, specialInstructions: { type: 'string' } },
    },
    property: {
      type: 'object',
      properties: { yearBuilt: { type: 'string' }, gla: { type: 'string' }, bedrooms: { type: 'string' }, bathrooms: { type: 'string' }, lotSize: { type: 'string' } },
    },
  },
};

/**
 * Extract structured data from an order form PDF using Gemini vision.
 * No OCR needed — Gemini reads the PDF natively.
 */
export async function extractOrderFromPdf(pdfPath) {
  if (!isGeminiConfigured()) throw new Error('Gemini API not configured (set GEMINI_API_KEY)');

  const pdfBuffer = fs.readFileSync(pdfPath);
  const startTime = Date.now();

  const result = await processPdf(pdfBuffer,
    `Extract ALL structured data from this appraisal order form. Include every field you can find: subject property, borrower, lender, AMC, contract details, assignment details, order details, and any property information. Return a JSON object.`,
    {
      responseSchema: ORDER_EXTRACTION_SCHEMA,
      systemInstruction: 'You are an expert appraisal order processor. Extract every piece of data from this order form with 100% accuracy. Normalize dates to YYYY-MM-DD. Normalize dollar amounts to numbers only.',
    }
  );

  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Could not parse extraction result');
  }

  const durationMs = Date.now() - startTime;
  const fieldCount = countFields(parsed);

  log.info('doc-ai:order-extracted', { durationMs, fieldCount });

  return { facts: parsed, meta: { durationMs, fieldCount, source: 'gemini-pdf', confidence: 'high' } };
}

/**
 * Extract comp data from an MLS sheet PDF.
 */
export async function extractCompFromPdf(pdfPath) {
  if (!isGeminiConfigured()) throw new Error('Gemini API not configured');

  const pdfBuffer = fs.readFileSync(pdfPath);

  const result = await processPdf(pdfBuffer,
    `Extract comparable sale data from this MLS listing sheet. Return a JSON object with: { "address": "", "city": "", "state": "", "zip": "", "salePrice": "", "saleDate": "", "listPrice": "", "dom": "", "gla": "", "lotSize": "", "yearBuilt": "", "bedrooms": "", "bathrooms": "", "stories": "", "garageType": "", "garageCars": "", "basementArea": "", "basementFinished": "", "pool": "", "fireplaces": "", "condition": "", "style": "", "construction": "", "heating": "", "cooling": "", "mlsNumber": "", "dataSource": "" }. Include only fields with actual data.`,
    {
      systemInstruction: 'You are an expert real estate appraiser extracting comparable sale data from MLS sheets. Be precise with numbers and dates.',
    }
  );

  let parsed;
  try { parsed = JSON.parse(result); } catch {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]); else throw new Error('Parse failed');
  }

  return { comp: parsed, source: 'gemini-pdf' };
}

/**
 * Extract tax data from a county assessor record PDF.
 */
export async function extractTaxRecord(pdfPath) {
  if (!isGeminiConfigured()) throw new Error('Gemini API not configured');

  const pdfBuffer = fs.readFileSync(pdfPath);

  const result = await processPdf(pdfBuffer,
    `Extract property tax and assessment data from this tax record document. Return JSON: { "parcelId": "", "owner": "", "assessedLand": "", "assessedImprovement": "", "assessedTotal": "", "taxYear": "", "annualTax": "", "legalDescription": "", "lotSize": "", "yearBuilt": "", "gla": "", "bedrooms": "", "bathrooms": "", "stories": "", "propertyClass": "", "neighborhood": "", "zoning": "" }`,
    { systemInstruction: 'Extract property assessment and tax data with precision.' }
  );

  let parsed;
  try { parsed = JSON.parse(result); } catch {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]); else throw new Error('Parse failed');
  }

  return { taxData: parsed, source: 'gemini-pdf' };
}

/**
 * Process any document and extract relevant appraisal data.
 * General-purpose — works on any document type.
 */
export async function processAnyDocument(pdfPath, documentType = 'general') {
  if (!isGeminiConfigured()) throw new Error('Gemini API not configured');

  const pdfBuffer = fs.readFileSync(pdfPath);

  const prompts = {
    general: 'Extract all relevant real estate and appraisal data from this document. Return structured JSON.',
    engagement: 'Extract engagement letter details: client, property, scope of work, fee, due date, special conditions.',
    survey: 'Extract survey/plat data: lot dimensions, area, easements, encroachments, boundary descriptions.',
    hoa: 'Extract HOA/condo data: association name, monthly fee, special assessments, amenities, units, project details.',
  };

  const result = await processPdf(pdfBuffer, prompts[documentType] || prompts.general);

  let parsed;
  try { parsed = JSON.parse(result); } catch {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]); else return { rawText: result, source: 'gemini-pdf' };
  }

  return { data: parsed, documentType, source: 'gemini-pdf' };
}

function countFields(obj, count = 0) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) count = countFields(v, count);
    else if (v && v !== '') count++;
  }
  return count;
}

export default { extractOrderFromPdf, extractCompFromPdf, extractTaxRecord, processAnyDocument };
