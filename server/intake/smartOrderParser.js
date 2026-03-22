/**
 * server/intake/smartOrderParser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered order form parser.
 *
 * Takes a raw PDF text extraction and uses AI to identify and structure
 * ALL appraisal order fields into the internal facts schema.
 *
 * This replaces manual data entry. Upload the PDF → facts auto-populate.
 *
 * Extracts:
 *   - Subject property (address, city, state, zip, county)
 *   - Borrower / owner info
 *   - Lender / client info  
 *   - Property type, occupancy, assignment details
 *   - Contract info (sale price, date, financing)
 *   - Special instructions, comparable requirements
 *   - Due date, fee, AMC info
 */

import crypto from 'crypto';
import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

const EXTRACTION_PROMPT = `You are an expert appraisal order parser. Extract ALL structured data from this appraisal order form text.

Return a JSON object with these sections (include only fields that have values):

{
  "subject": {
    "address": "",
    "unit": "",
    "city": "",
    "state": "",
    "zip": "",
    "county": "",
    "legalDescription": "",
    "taxParcelId": "",
    "censusTract": "",
    "mapReference": ""
  },
  "borrower": {
    "name": "",
    "phone": "",
    "email": "",
    "currentAddress": ""
  },
  "owner": {
    "name": "",
    "phone": ""
  },
  "lender": {
    "name": "",
    "address": "",
    "contact": "",
    "phone": "",
    "email": "",
    "loanNumber": "",
    "caseNumber": "",
    "fhaCase": ""
  },
  "amc": {
    "name": "",
    "orderNumber": "",
    "contact": "",
    "phone": "",
    "email": ""
  },
  "assignment": {
    "type": "",
    "purpose": "",
    "intendedUse": "",
    "propertyRightsAppraised": "",
    "loanType": "",
    "loanProgram": "",
    "occupancy": "",
    "propertyType": ""
  },
  "contract": {
    "salePrice": "",
    "contractDate": "",
    "seller": "",
    "financingType": "",
    "concessions": "",
    "daysOnMarket": ""
  },
  "order": {
    "dueDate": "",
    "fee": "",
    "rushFee": "",
    "formType": "",
    "specialInstructions": "",
    "additionalForms": [],
    "compRequirements": ""
  },
  "property": {
    "yearBuilt": "",
    "gla": "",
    "bedrooms": "",
    "bathrooms": "",
    "lotSize": "",
    "stories": "",
    "garageType": "",
    "garageCars": "",
    "hoa": "",
    "hoaFrequency": ""
  }
}

Rules:
- Only include fields where you found actual data
- Normalize state to 2-letter code
- Normalize dates to YYYY-MM-DD format
- Normalize dollar amounts to numbers only (no $ or commas)
- If you find the form type mentioned (1004, 1025, 1073, etc.), put it in order.formType
- Parse addresses into components when possible
- Identify AMC vs lender — AMC is the management company, lender is the bank
- Extract special instructions verbatim

Return ONLY the JSON. No explanation.`;

/**
 * Parse an order form PDF text into structured facts.
 *
 * @param {string} rawText — extracted text from the PDF
 * @param {Object} [options]
 * @returns {Promise<Object>} parsed facts
 */
export async function parseOrderForm(rawText, options = {}) {
  if (!rawText || rawText.trim().length < 50) {
    throw new Error('Order form text is too short to parse');
  }

  const startTime = Date.now();

  const messages = [
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: `Parse this appraisal order form:\n\n${rawText.slice(0, 12000)}` },
  ];

  const response = await callAI(messages, {
    maxTokens: 2000,
    temperature: 0.1,
  });

  // Extract JSON from response
  let parsed;
  try {
    // Try direct parse
    parsed = JSON.parse(response);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      // Try finding first { to last }
      const start = response.indexOf('{');
      const end = response.lastIndexOf('}');
      if (start >= 0 && end > start) {
        parsed = JSON.parse(response.slice(start, end + 1));
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    }
  }

  const durationMs = Date.now() - startTime;

  // Count extracted fields
  let fieldCount = 0;
  const countFields = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) countFields(v);
      else if (v && v !== '') fieldCount++;
    }
  };
  countFields(parsed);

  log.info('order-parser:complete', { durationMs, fieldCount });

  return {
    facts: parsed,
    meta: {
      durationMs,
      fieldCount,
      sourceLength: rawText.length,
      confidence: fieldCount > 15 ? 'high' : fieldCount > 8 ? 'medium' : 'low',
    },
  };
}

/**
 * Parse order and auto-create a case with populated facts.
 *
 * @param {string} rawText
 * @param {string} userId
 * @param {Object} [options]
 * @returns {Promise<Object>} { caseId, facts, meta }
 */
export async function parseAndCreateCase(rawText, userId, options = {}) {
  const { facts, meta } = await parseOrderForm(rawText, options);

  // Determine form type
  const formType = facts.order?.formType || options.formType || '1004';

  // Create case
  const caseId = crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString();
  const address = facts.subject?.address || 'Imported Order';

  dbRun(
    `INSERT INTO case_records (case_id, form_type, case_status, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?)`,
    [caseId, formType, now, now]
  );

  // Flatten facts into the internal schema
  const internalFacts = {
    subject: {
      address: facts.subject?.address,
      streetAddress: facts.subject?.address,
      city: facts.subject?.city,
      state: facts.subject?.state,
      zip: facts.subject?.zip,
      zipCode: facts.subject?.zip,
      county: facts.subject?.county,
      legalDescription: facts.subject?.legalDescription,
      taxParcelId: facts.subject?.taxParcelId,
      censusTract: facts.subject?.censusTract,
      borrower: facts.borrower?.name,
      owner: facts.owner?.name || facts.borrower?.name,
      occupancy: facts.assignment?.occupancy,
      propertyType: facts.assignment?.propertyType,
    },
    lender: {
      name: facts.lender?.name,
      address: facts.lender?.address,
      contact: facts.lender?.contact,
      loanNumber: facts.lender?.loanNumber,
      caseNumber: facts.lender?.caseNumber,
    },
    amc: facts.amc || {},
    contract: {
      salePrice: facts.contract?.salePrice,
      contractDate: facts.contract?.contractDate,
      seller: facts.contract?.seller,
      financingType: facts.contract?.financingType,
      concessions: facts.contract?.concessions,
    },
    assignment: {
      type: facts.assignment?.type || 'Standard',
      purpose: facts.assignment?.purpose || 'Purchase',
      intendedUse: facts.assignment?.intendedUse || 'Mortgage lending decision',
      propertyRightsAppraised: facts.assignment?.propertyRightsAppraised || 'Fee Simple',
      loanType: facts.assignment?.loanType,
      loanProgram: facts.assignment?.loanProgram,
    },
    improvements: {
      yearBuilt: facts.property?.yearBuilt,
      gla: facts.property?.gla,
      bedrooms: facts.property?.bedrooms,
      bathrooms: facts.property?.bathrooms,
      lotSize: facts.property?.lotSize,
      stories: facts.property?.stories,
      garageType: facts.property?.garageType,
      garageCars: facts.property?.garageCars,
    },
    order: {
      dueDate: facts.order?.dueDate,
      fee: facts.order?.fee,
      specialInstructions: facts.order?.specialInstructions,
    },
  };

  // Remove empty/null values
  const cleanFacts = JSON.parse(JSON.stringify(internalFacts, (k, v) => v === '' || v === null || v === undefined ? undefined : v));

  dbRun(
    'INSERT INTO case_facts (case_id, facts_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [caseId, JSON.stringify(cleanFacts), now, now]
  );

  log.info('order-parser:case-created', { caseId, formType, fieldCount: meta.fieldCount, address });

  return { caseId, formType, address, facts: cleanFacts, meta };
}

export default { parseOrderForm, parseAndCreateCase };
