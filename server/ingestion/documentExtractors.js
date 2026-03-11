/**
 * server/ingestion/documentExtractors.js
 * ----------------------------------------
 * Phase 5 — Document-Type-Specific Structured Extractors
 *
 * Each extractor takes raw extracted text from a document and returns
 * an array of structured fact candidates with provenance info.
 *
 * Extractors are deterministic where possible (regex/pattern matching),
 * with AI fallback for complex documents.
 *
 * Supported doc types:
 *   order_sheet       — borrower, address, lender, AMC, product, loan program, due date
 *   engagement_letter — client, intended use/user, scope conditions, assumptions
 *   contract          — contract price, date, concessions, financing, parties
 *   mls_sheet         — address, DOM, list/sale price, GLA, lot, year built, rooms, remarks
 *   assessor_record   — parcel, legal desc, site size, tax data, assessed value, year built
 *   zoning_document   — zoning classification, permitted use, conformity clues
 *   flood_document    — flood zone, FIRM panel, community number, BFE
 *   comp_sheet        — comp address, sale price, sale date, GLA, lot, adjustments
 *
 * Usage:
 *   import { extractStructuredFacts } from '../ingestion/documentExtractors.js';
 *   const facts = await extractStructuredFacts(docType, text, { aiClient, model });
 */

import { callAI } from '../openaiClient.js';
import log from '../logger.js';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract structured fact candidates from document text.
 *
 * @param {string} docType — Phase 5 document type
 * @param {string} text    — extracted text from the document
 * @param {object} [options] — { aiClient, model } for AI-assisted extraction
 * @returns {Promise<ExtractedFact[]>}
 *
 * @typedef {object} ExtractedFact
 * @property {string} factPath  — dot-separated path e.g. "subject.address"
 * @property {string} value     — extracted value
 * @property {string} confidence — 'high' | 'medium' | 'low'
 * @property {string} [sourceText] — snippet from source showing where fact came from
 */
export async function extractStructuredFacts(docType, text, options = {}) {
  if (!text || text.length < 20) return [];

  const extractor = EXTRACTORS[docType];
  if (!extractor) return [];

  try {
    // Try deterministic extraction first
    const deterministicFacts = extractor.deterministic(text);

    // If deterministic got good coverage, use it
    if (deterministicFacts.length >= extractor.minDeterministic) {
      return deterministicFacts;
    }

    // Fall back to AI-assisted extraction
    if (options.aiClient || callAI) {
      const aiFacts = await extractor.aiAssisted(text);
      // Merge: deterministic facts take priority (higher confidence)
      return mergeFacts(deterministicFacts, aiFacts);
    }

    return deterministicFacts;
  } catch (err) {
    log.error('documentExtractors:extraction', { docType, error: err.message });
    return [];
  }
}

/**
 * Get available extractor doc types.
 * @returns {string[]}
 */
export function getExtractorTypes() {
  return Object.keys(EXTRACTORS);
}

// ── Extractor registry ───────────────────────────────────────────────────────

const EXTRACTORS = {
  order_sheet: {
    minDeterministic: 2,
    deterministic: extractOrderSheetDeterministic,
    aiAssisted:    extractOrderSheetAI,
  },
  engagement_letter: {
    minDeterministic: 2,
    deterministic: extractEngagementDeterministic,
    aiAssisted:    extractEngagementAI,
  },
  contract: {
    minDeterministic: 2,
    deterministic: extractContractDeterministic,
    aiAssisted:    extractContractAI,
  },
  mls_sheet: {
    minDeterministic: 3,
    deterministic: extractMlsDeterministic,
    aiAssisted:    extractMlsAI,
  },
  assessor_record: {
    minDeterministic: 2,
    deterministic: extractAssessorDeterministic,
    aiAssisted:    extractAssessorAI,
  },
  zoning_document: {
    minDeterministic: 1,
    deterministic: extractZoningDeterministic,
    aiAssisted:    extractZoningAI,
  },
  flood_document: {
    minDeterministic: 1,
    deterministic: extractFloodDeterministic,
    aiAssisted:    extractFloodAI,
  },
  comp_sheet: {
    minDeterministic: 2,
    deterministic: extractCompDeterministic,
    aiAssisted:    extractCompAI,
  },
};

// ── Utility helpers ──────────────────────────────────────────────────────────

function fact(factPath, value, confidence = 'medium', sourceText = '') {
  if (value == null || String(value).trim() === '') return null;
  return {
    factPath,
    value: String(value).trim(),
    confidence,
    sourceText: sourceText.slice(0, 200),
  };
}

function findValue(text, patterns, flags = 'i') {
  for (const p of patterns) {
    const re = typeof p === 'string' ? new RegExp(p, flags) : p;
    const m = text.match(re);
    if (m && m[1]) return { value: m[1].trim(), source: (m[0] || '').trim() };
  }
  return null;
}

function findCurrency(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const raw = m[1].replace(/[$,\s]/g, '');
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) return { value: String(num), source: (m[0] || '').trim() };
    }
  }
  return null;
}

function findDate(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return { value: m[1].trim(), source: (m[0] || '').trim() };
  }
  return null;
}

function mergeFacts(primary, secondary) {
  const pathSet = new Set(primary.map(f => f.factPath));
  const merged = [...primary];
  for (const f of secondary) {
    if (!pathSet.has(f.factPath)) {
      merged.push(f);
      pathSet.add(f.factPath);
    }
  }
  return merged;
}

async function aiExtract(text, docTypeLabel, schema) {
  const prompt = [
    `You are an appraisal document data extractor. Extract structured facts from this ${docTypeLabel}.`,
    `Return ONLY valid JSON matching this schema. Use null for missing fields.`,
    ``,
    `Schema:`,
    JSON.stringify(schema, null, 2),
    ``,
    `DOCUMENT TEXT:`,
    text.slice(0, 8000),
    ``,
    `Return ONLY the JSON object.`,
  ].join('\n');

  try {
    const raw = await callAI([{ role: 'user', content: prompt }]);
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch { /* fall through */ }
  return {};
}

function jsonToFacts(json, prefix, confidence = 'medium') {
  const results = [];
  for (const [key, value] of Object.entries(json)) {
    if (value == null || value === '') continue;
    const f = fact(`${prefix}.${key}`, value, confidence);
    if (f) results.push(f);
  }
  return results;
}

// ── ORDER SHEET extractor ────────────────────────────────────────────────────

function extractOrderSheetDeterministic(text) {
  const facts = [];

  const borrower = findValue(text, [
    /borrower[:\s]+([^\n]{3,60})/i,
    /owner[:\s]+([^\n]{3,60})/i,
    /client[:\s]+([^\n]{3,60})/i,
  ]);
  if (borrower) facts.push(fact('assignment.borrower', borrower.value, 'high', borrower.source));

  const address = findValue(text, [
    /(?:subject|property)\s*address[:\s]+([^\n]{5,100})/i,
    /address[:\s]+([^\n]{5,100})/i,
  ]);
  if (address) facts.push(fact('subject.address', address.value, 'high', address.source));

  const lender = findValue(text, [
    /lender[:\s]+([^\n]{3,80})/i,
    /lending\s*institution[:\s]+([^\n]{3,80})/i,
  ]);
  if (lender) facts.push(fact('assignment.lenderName', lender.value, 'high', lender.source));

  const amc = findValue(text, [
    /amc[:\s]+([^\n]{3,80})/i,
    /management\s*company[:\s]+([^\n]{3,80})/i,
  ]);
  if (amc) facts.push(fact('assignment.amcName', amc.value, 'medium', amc.source));

  const product = findValue(text, [
    /product\s*(?:type)?[:\s]+([^\n]{3,60})/i,
    /report\s*type[:\s]+([^\n]{3,60})/i,
    /form\s*type[:\s]+([^\n]{3,30})/i,
  ]);
  if (product) facts.push(fact('assignment.productType', product.value, 'medium', product.source));

  const loanType = findValue(text, [
    /loan\s*(?:type|program)[:\s]+([^\n]{3,40})/i,
  ]);
  if (loanType) facts.push(fact('assignment.loanProgram', loanType.value, 'medium', loanType.source));

  const dueDate = findDate(text, [
    /due\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /due[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (dueDate) facts.push(fact('assignment.dueDate', dueDate.value, 'high', dueDate.source));

  const occupancy = findValue(text, [
    /occupancy[:\s]+([^\n]{3,40})/i,
  ]);
  if (occupancy) facts.push(fact('assignment.occupancy', occupancy.value, 'medium', occupancy.source));

  return facts.filter(Boolean);
}

async function extractOrderSheetAI(text) {
  const schema = {
    borrower: null, address: null, city: null, state: null, zip: null,
    lender: null, amc: null, product_type: null, loan_program: null,
    due_date: null, occupancy: null, intended_use: null,
  };
  const json = await aiExtract(text, 'appraisal order sheet', schema);
  const facts = [];
  if (json.borrower) facts.push(fact('assignment.borrower', json.borrower, 'medium'));
  if (json.address)  facts.push(fact('subject.address', json.address, 'medium'));
  if (json.city)     facts.push(fact('subject.city', json.city, 'medium'));
  if (json.state)    facts.push(fact('subject.state', json.state, 'medium'));
  if (json.zip)      facts.push(fact('subject.zip', json.zip, 'medium'));
  if (json.lender)   facts.push(fact('assignment.lenderName', json.lender, 'medium'));
  if (json.amc)      facts.push(fact('assignment.amcName', json.amc, 'medium'));
  if (json.product_type)  facts.push(fact('assignment.productType', json.product_type, 'low'));
  if (json.loan_program)  facts.push(fact('assignment.loanProgram', json.loan_program, 'low'));
  if (json.due_date)      facts.push(fact('assignment.dueDate', json.due_date, 'low'));
  if (json.occupancy)     facts.push(fact('assignment.occupancy', json.occupancy, 'low'));
  if (json.intended_use)  facts.push(fact('assignment.intendedUse', json.intended_use, 'low'));
  return facts.filter(Boolean);
}

// ── ENGAGEMENT LETTER extractor ──────────────────────────────────────────────

function extractEngagementDeterministic(text) {
  const facts = [];

  const client = findValue(text, [
    /client[:\s]+([^\n]{3,80})/i,
    /prepared\s*for[:\s]+([^\n]{3,80})/i,
  ]);
  if (client) facts.push(fact('assignment.clientName', client.value, 'high', client.source));

  const intendedUse = findValue(text, [
    /intended\s*use[:\s]+([^\n]{10,200})/i,
  ]);
  if (intendedUse) facts.push(fact('assignment.intendedUse', intendedUse.value, 'high', intendedUse.source));

  const intendedUser = findValue(text, [
    /intended\s*user[:\s]+([^\n]{3,200})/i,
  ]);
  if (intendedUser) facts.push(fact('assignment.intendedUser', intendedUser.value, 'high', intendedUser.source));

  const effectiveDate = findDate(text, [
    /effective\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (effectiveDate) facts.push(fact('assignment.effectiveDate', effectiveDate.value, 'high', effectiveDate.source));

  return facts.filter(Boolean);
}

async function extractEngagementAI(text) {
  const schema = {
    client: null, intended_use: null, intended_user: null,
    effective_date: null, scope_conditions: null,
    extraordinary_assumptions: null, hypothetical_conditions: null,
  };
  const json = await aiExtract(text, 'engagement letter / scope of work', schema);
  const facts = [];
  if (json.client)        facts.push(fact('assignment.clientName', json.client, 'medium'));
  if (json.intended_use)  facts.push(fact('assignment.intendedUse', json.intended_use, 'medium'));
  if (json.intended_user) facts.push(fact('assignment.intendedUser', json.intended_user, 'medium'));
  if (json.effective_date) facts.push(fact('assignment.effectiveDate', json.effective_date, 'medium'));
  if (json.extraordinary_assumptions) facts.push(fact('assignment.extraordinaryAssumptions', json.extraordinary_assumptions, 'medium'));
  if (json.hypothetical_conditions)   facts.push(fact('assignment.hypotheticalConditions', json.hypothetical_conditions, 'medium'));
  return facts.filter(Boolean);
}

// ── CONTRACT extractor ───────────────────────────────────────────────────────

function extractContractDeterministic(text) {
  const facts = [];

  const price = findCurrency(text, [
    /(?:purchase|contract|sale)\s*price[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /price[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
  ]);
  if (price) facts.push(fact('contract.salePrice', price.value, 'high', price.source));

  const date = findDate(text, [
    /(?:contract|agreement)\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (date) facts.push(fact('contract.contractDate', date.value, 'high', date.source));

  const concessions = findCurrency(text, [
    /(?:seller|concession|credit)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
  ]);
  if (concessions) facts.push(fact('contract.concessions', concessions.value, 'medium', concessions.source));

  const closing = findDate(text, [
    /closing\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (closing) facts.push(fact('contract.closingDate', closing.value, 'medium', closing.source));

  const financing = findValue(text, [
    /financing[:\s]+([^\n]{5,100})/i,
    /loan\s*type[:\s]+([^\n]{3,60})/i,
  ]);
  if (financing) facts.push(fact('contract.financing', financing.value, 'medium', financing.source));

  return facts.filter(Boolean);
}

async function extractContractAI(text) {
  const schema = {
    purchase_price: null, contract_date: null, closing_date: null,
    concessions: null, financing_type: null, buyer: null, seller: null,
    earnest_money: null, contingencies: null,
  };
  const json = await aiExtract(text, 'purchase contract / sales agreement', schema);
  const facts = [];
  if (json.purchase_price) facts.push(fact('contract.salePrice', json.purchase_price, 'medium'));
  if (json.contract_date)  facts.push(fact('contract.contractDate', json.contract_date, 'medium'));
  if (json.closing_date)   facts.push(fact('contract.closingDate', json.closing_date, 'medium'));
  if (json.concessions)    facts.push(fact('contract.concessions', json.concessions, 'medium'));
  if (json.financing_type) facts.push(fact('contract.financing', json.financing_type, 'low'));
  if (json.buyer)          facts.push(fact('contract.buyer', json.buyer, 'low'));
  if (json.seller)         facts.push(fact('contract.seller', json.seller, 'low'));
  return facts.filter(Boolean);
}

// ── MLS SHEET extractor ──────────────────────────────────────────────────────

function extractMlsDeterministic(text) {
  const facts = [];

  const address = findValue(text, [
    /(?:address|location)[:\s]+([^\n]{5,100})/i,
  ]);
  if (address) facts.push(fact('subject.address', address.value, 'medium', address.source));

  const listPrice = findCurrency(text, [
    /list\s*price[:\s]*\$?([\d,]+)/i,
    /asking\s*price[:\s]*\$?([\d,]+)/i,
  ]);
  if (listPrice) facts.push(fact('market.listPrice', listPrice.value, 'high', listPrice.source));

  const salePrice = findCurrency(text, [
    /(?:sale|sold|selling)\s*price[:\s]*\$?([\d,]+)/i,
    /(?:closed|final)\s*price[:\s]*\$?([\d,]+)/i,
  ]);
  if (salePrice) facts.push(fact('contract.salePrice', salePrice.value, 'high', salePrice.source));

  const dom = findValue(text, [
    /(?:dom|days\s*on\s*market)[:\s]+(\d{1,4})/i,
    /cdom[:\s]+(\d{1,4})/i,
  ]);
  if (dom) facts.push(fact('market.dom', dom.value, 'high', dom.source));

  const gla = findValue(text, [
    /(?:gla|sqft|sq\.?\s*ft|square\s*feet|living\s*area)[:\s]+(\d{3,6})/i,
    /(\d{3,6})\s*(?:sqft|sq\.?\s*ft|square\s*feet)/i,
  ]);
  if (gla) facts.push(fact('subject.gla', gla.value, 'medium', gla.source));

  const yearBuilt = findValue(text, [
    /(?:year\s*built|built)[:\s]+(\d{4})/i,
    /yr\s*blt[:\s]+(\d{4})/i,
  ]);
  if (yearBuilt) facts.push(fact('subject.yearBuilt', yearBuilt.value, 'high', yearBuilt.source));

  const bedrooms = findValue(text, [
    /(?:bed(?:room)?s?|br)[:\s]+(\d{1,2})/i,
    /(\d{1,2})\s*(?:bed|br)/i,
  ]);
  if (bedrooms) facts.push(fact('subject.bedrooms', bedrooms.value, 'medium', bedrooms.source));

  const bathrooms = findValue(text, [
    /(?:bath(?:room)?s?|ba)[:\s]+(\d{1,2}(?:\.\d)?)/i,
    /(\d{1,2}(?:\.\d)?)\s*(?:bath|ba)/i,
  ]);
  if (bathrooms) facts.push(fact('subject.bathrooms', bathrooms.value, 'medium', bathrooms.source));

  const lotSize = findValue(text, [
    /(?:lot\s*size|lot\s*area|site\s*size)[:\s]+([^\n]{3,40})/i,
    /(\d[\d,.]+)\s*(?:acres?|ac)/i,
  ]);
  if (lotSize) facts.push(fact('subject.lotSize', lotSize.value, 'medium', lotSize.source));

  return facts.filter(Boolean);
}

async function extractMlsAI(text) {
  const schema = {
    address: null, city: null, state: null, zip: null,
    list_price: null, sale_price: null, sale_date: null,
    dom: null, cdom: null, gla: null, lot_size: null,
    year_built: null, bedrooms: null, bathrooms: null,
    style: null, basement: null, garage: null, condition: null,
    listing_remarks: null,
  };
  const json = await aiExtract(text, 'MLS listing sheet', schema);
  const facts = [];
  if (json.address)    facts.push(fact('subject.address', json.address, 'medium'));
  if (json.city)       facts.push(fact('subject.city', json.city, 'medium'));
  if (json.state)      facts.push(fact('subject.state', json.state, 'medium'));
  if (json.zip)        facts.push(fact('subject.zip', json.zip, 'medium'));
  if (json.list_price) facts.push(fact('market.listPrice', json.list_price, 'medium'));
  if (json.sale_price) facts.push(fact('contract.salePrice', json.sale_price, 'medium'));
  if (json.sale_date)  facts.push(fact('contract.saleDate', json.sale_date, 'medium'));
  if (json.dom)        facts.push(fact('market.dom', json.dom, 'medium'));
  if (json.gla)        facts.push(fact('subject.gla', json.gla, 'medium'));
  if (json.lot_size)   facts.push(fact('subject.lotSize', json.lot_size, 'medium'));
  if (json.year_built) facts.push(fact('subject.yearBuilt', json.year_built, 'medium'));
  if (json.bedrooms)   facts.push(fact('subject.bedrooms', json.bedrooms, 'medium'));
  if (json.bathrooms)  facts.push(fact('subject.bathrooms', json.bathrooms, 'medium'));
  if (json.style)      facts.push(fact('subject.design', json.style, 'low'));
  if (json.basement)   facts.push(fact('improvements.basement', json.basement, 'low'));
  if (json.garage)     facts.push(fact('improvements.garage', json.garage, 'low'));
  if (json.condition)  facts.push(fact('subject.condition', json.condition, 'low'));
  return facts.filter(Boolean);
}

// ── ASSESSOR RECORD extractor ────────────────────────────────────────────────

function extractAssessorDeterministic(text) {
  const facts = [];

  const parcel = findValue(text, [
    /parcel[:\s#]+([^\n]{5,40})/i,
    /pin[:\s]+([^\n]{5,30})/i,
    /tax\s*id[:\s]+([^\n]{5,30})/i,
  ]);
  if (parcel) facts.push(fact('subject.parcelNumber', parcel.value, 'high', parcel.source));

  const assessed = findCurrency(text, [
    /assessed\s*value[:\s]*\$?([\d,]+)/i,
    /total\s*assessed[:\s]*\$?([\d,]+)/i,
  ]);
  if (assessed) facts.push(fact('subject.assessedValue', assessed.value, 'high', assessed.source));

  const yearBuilt = findValue(text, [
    /(?:year\s*built|built)[:\s]+(\d{4})/i,
  ]);
  if (yearBuilt) facts.push(fact('subject.yearBuilt', yearBuilt.value, 'high', yearBuilt.source));

  const sqft = findValue(text, [
    /(?:living\s*area|total\s*(?:sq\s*ft|area)|gla)[:\s]+(\d{3,6})/i,
  ]);
  if (sqft) facts.push(fact('subject.gla', sqft.value, 'medium', sqft.source));

  const lotSize = findValue(text, [
    /(?:lot\s*size|site\s*size|land\s*area)[:\s]+([^\n]{3,40})/i,
    /(\d[\d,.]+)\s*(?:acres?|ac|sf|sq\s*ft)/i,
  ]);
  if (lotSize) facts.push(fact('subject.lotSize', lotSize.value, 'medium', lotSize.source));

  const taxYear = findValue(text, [
    /tax\s*year[:\s]+(\d{4})/i,
  ]);
  if (taxYear) facts.push(fact('subject.taxYear', taxYear.value, 'high', taxYear.source));

  const legalDesc = findValue(text, [
    /legal\s*(?:description|desc)[:\s]+([^\n]{10,200})/i,
  ]);
  if (legalDesc) facts.push(fact('subject.legalDescription', legalDesc.value, 'medium', legalDesc.source));

  return facts.filter(Boolean);
}

async function extractAssessorAI(text) {
  const schema = {
    parcel_number: null, legal_description: null, site_size: null,
    tax_year: null, assessed_value: null, property_class: null,
    year_built: null, square_footage: null, room_count: null,
  };
  const json = await aiExtract(text, 'assessor / property tax record', schema);
  return jsonToFacts(json, 'subject', 'medium');
}

// ── ZONING DOCUMENT extractor ────────────────────────────────────────────────

function extractZoningDeterministic(text) {
  const facts = [];

  const zoning = findValue(text, [
    /(?:zoning\s*(?:district|classification|designation|code))[:\s]+([^\n]{2,40})/i,
    /(?:zone|zoned)[:\s]+([^\n]{2,30})/i,
  ]);
  if (zoning) facts.push(fact('site.zoning', zoning.value, 'high', zoning.source));

  const permittedUse = findValue(text, [
    /permitted\s*use[:\s]+([^\n]{5,200})/i,
    /allowed\s*use[:\s]+([^\n]{5,200})/i,
  ]);
  if (permittedUse) facts.push(fact('site.permittedUse', permittedUse.value, 'medium', permittedUse.source));

  // Check for conformity clues
  const lower = text.toLowerCase();
  if (lower.includes('nonconforming') || lower.includes('non-conforming')) {
    facts.push(fact('site.zoningConformity', 'nonconforming', 'medium', 'nonconforming reference found'));
  } else if (lower.includes('legal nonconforming') || lower.includes('grandfathered')) {
    facts.push(fact('site.zoningConformity', 'legal_nonconforming', 'medium', 'legal nonconforming reference found'));
  }

  return facts.filter(Boolean);
}

async function extractZoningAI(text) {
  const schema = {
    zoning_classification: null, permitted_uses: null,
    setbacks: null, lot_coverage: null, height_limit: null,
    conformity_status: null, municipality: null,
  };
  const json = await aiExtract(text, 'zoning document / zoning letter', schema);
  const facts = [];
  if (json.zoning_classification) facts.push(fact('site.zoning', json.zoning_classification, 'medium'));
  if (json.conformity_status)     facts.push(fact('site.zoningConformity', json.conformity_status, 'medium'));
  if (json.permitted_uses)        facts.push(fact('site.permittedUse', json.permitted_uses, 'low'));
  if (json.municipality)          facts.push(fact('site.municipality', json.municipality, 'low'));
  return facts.filter(Boolean);
}

// ── FLOOD DOCUMENT extractor ─────────────────────────────────────────────────

function extractFloodDeterministic(text) {
  const facts = [];

  const floodZone = findValue(text, [
    /(?:flood\s*zone|zone)[:\s]+([A-Z]{1,2}E?\d*)/i,
    /(?:zone\s*designation)[:\s]+([A-Z]{1,2}E?\d*)/i,
  ]);
  if (floodZone) facts.push(fact('site.floodZone', floodZone.value.toUpperCase(), 'high', floodZone.source));

  const mapNumber = findValue(text, [
    /(?:firm|map|panel)\s*(?:number|no|#)[:\s]+([^\n]{5,30})/i,
    /community\s*panel\s*(?:number|no|#)[:\s]+([^\n]{5,30})/i,
  ]);
  if (mapNumber) facts.push(fact('site.floodMapNumber', mapNumber.value, 'high', mapNumber.source));

  const mapDate = findDate(text, [
    /(?:map|panel|effective)\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (mapDate) facts.push(fact('site.floodMapDate', mapDate.value, 'high', mapDate.source));

  const communityNum = findValue(text, [
    /community\s*(?:number|no|#)[:\s]+(\d{4,10})/i,
  ]);
  if (communityNum) facts.push(fact('site.floodCommunityNumber', communityNum.value, 'medium', communityNum.source));

  return facts.filter(Boolean);
}

async function extractFloodAI(text) {
  const schema = {
    flood_zone: null, firm_panel_number: null, map_date: null,
    community_number: null, base_flood_elevation: null,
    flood_insurance_required: null,
  };
  const json = await aiExtract(text, 'FEMA flood determination / flood document', schema);
  const facts = [];
  if (json.flood_zone)       facts.push(fact('site.floodZone', json.flood_zone, 'medium'));
  if (json.firm_panel_number) facts.push(fact('site.floodMapNumber', json.firm_panel_number, 'medium'));
  if (json.map_date)         facts.push(fact('site.floodMapDate', json.map_date, 'medium'));
  if (json.community_number) facts.push(fact('site.floodCommunityNumber', json.community_number, 'low'));
  return facts.filter(Boolean);
}

// ── COMP SHEET extractor ─────────────────────────────────────────────────────

function extractCompDeterministic(text) {
  const facts = [];

  const address = findValue(text, [
    /(?:address|location|property)[:\s]+([^\n]{5,100})/i,
  ]);
  if (address) facts.push(fact('comp.address', address.value, 'medium', address.source));

  const salePrice = findCurrency(text, [
    /(?:sale|sold|selling|closed)\s*price[:\s]*\$?([\d,]+)/i,
  ]);
  if (salePrice) facts.push(fact('comp.salePrice', salePrice.value, 'high', salePrice.source));

  const saleDate = findDate(text, [
    /(?:sale|sold|closing|closed)\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ]);
  if (saleDate) facts.push(fact('comp.saleDate', saleDate.value, 'high', saleDate.source));

  const gla = findValue(text, [
    /(?:gla|sqft|sq\.?\s*ft|living\s*area)[:\s]+(\d{3,6})/i,
  ]);
  if (gla) facts.push(fact('comp.gla', gla.value, 'medium', gla.source));

  const yearBuilt = findValue(text, [
    /(?:year\s*built|built|yr\s*blt)[:\s]+(\d{4})/i,
  ]);
  if (yearBuilt) facts.push(fact('comp.yearBuilt', yearBuilt.value, 'medium', yearBuilt.source));

  const lotSize = findValue(text, [
    /(?:lot\s*size|site\s*size)[:\s]+([^\n]{3,40})/i,
  ]);
  if (lotSize) facts.push(fact('comp.lotSize', lotSize.value, 'medium', lotSize.source));

  return facts.filter(Boolean);
}

async function extractCompAI(text) {
  const schema = {
    address: null, sale_price: null, sale_date: null,
    gla: null, lot_size: null, year_built: null,
    bedrooms: null, bathrooms: null, condition: null,
    garage: null, basement: null, style: null,
  };
  const json = await aiExtract(text, 'comparable sale sheet', schema);
  return jsonToFacts(json, 'comp', 'medium');
}
