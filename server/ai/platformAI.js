/**
 * server/ai/platformAI.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform-level AI — proprietary features powered by YOUR Gemini key.
 *
 * This is the moat. Users don't need their own AI keys for:
 *   - PDF order form extraction (Gemini PDF vision)
 *   - Photo analysis (condition/quality detection)
 *   - Address verification enrichment
 *   - Market context generation
 *   - Document classification
 *
 * Users choose their OWN AI provider (OpenAI/Ollama/Gemini) for
 * narrative generation. But the platform features above always use
 * the platform's Gemini key — it's a built-in service.
 *
 * Cost model:
 *   Gemini 2.5 Flash: ~$0.0001 per 1K input tokens
 *   Average PDF extraction: ~2K tokens = $0.0002 per extraction
 *   At 1000 users × 30 PDFs/month = $6/month total cost
 *   That's a rounding error compared to subscription revenue.
 *
 * Config:
 *   PLATFORM_GEMINI_KEY — the platform's own key (set by admin)
 *   Separate from user's GEMINI_API_KEY which is for their generation
 */

import log from '../logger.js';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const PLATFORM_MODEL = process.env.PLATFORM_AI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Check if platform AI is available.
 */
export function isPlatformAIAvailable() {
  return Boolean(PLATFORM_GEMINI_KEY);
}

/**
 * Call the platform's Gemini API.
 * This is NOT the user's AI provider — this is the platform's built-in AI.
 */
async function callPlatformAI(contents, options = {}) {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured. Set PLATFORM_GEMINI_KEY in .env');

  const model = options.model || PLATFORM_MODEL;
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${PLATFORM_GEMINI_KEY}`;

  const body = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: options.maxTokens || 4000,
    },
  };

  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  if (options.responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = options.responseSchema;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 120000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Platform AI error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const usage = data.usageMetadata || {};

  log.info('platform-ai:call', {
    model,
    feature: options.feature || 'unknown',
    promptTokens: usage.promptTokenCount,
    completionTokens: usage.candidatesTokenCount,
    cost: estimateCost(usage.promptTokenCount, usage.candidatesTokenCount),
  });

  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Estimate cost for logging.
 */
function estimateCost(promptTokens, completionTokens) {
  // Gemini 2.5 Flash pricing (approximate)
  const inputCost = (promptTokens || 0) / 1000000 * 0.15;  // $0.15/M input
  const outputCost = (completionTokens || 0) / 1000000 * 0.60;  // $0.60/M output
  return `$${(inputCost + outputCost).toFixed(6)}`;
}

// ── PROPRIETARY FEATURES ─────────────────────────────────────────────────────

/**
 * Extract structured data from a PDF using platform AI.
 * This is the FREE built-in feature — no user API key needed.
 *
 * @param {Buffer} pdfBuffer — raw PDF bytes
 * @param {string} documentType — 'order' | 'mls' | 'tax' | 'general'
 * @returns {Promise<Object>} extracted data
 */
export async function platformExtractPdf(pdfBuffer, documentType = 'order') {
  const base64 = pdfBuffer.toString('base64');

  const prompts = {
    order: `Extract ALL structured data from this appraisal order form. Return JSON with sections: subject (address, city, state, zip, county, legalDescription, taxParcelId), borrower (name, phone, email), lender (name, address, loanNumber), amc (name, orderNumber, contact), contract (salePrice, contractDate, seller, financingType), assignment (purpose, loanType, propertyType, occupancy), order (formType, dueDate, fee, specialInstructions), property (yearBuilt, gla, bedrooms, bathrooms, lotSize, stories, garageType, garageCars). Normalize dates to YYYY-MM-DD. Dollar amounts as numbers only. State as 2-letter code.`,

    mls: `Extract comparable sale data from this MLS listing sheet. Return JSON: { address, city, state, zip, salePrice, listPrice, saleDate, dom, gla, lotSize, yearBuilt, bedrooms, bathrooms, stories, garageType, garageCars, basementArea, basementFinished, condition, quality, style, construction, heating, cooling, mlsNumber, dataSource, pricePerSf }. Numbers only for prices and measurements.`,

    tax: `Extract property tax and assessment data. Return JSON: { parcelId, owner, assessedLand, assessedImprovement, assessedTotal, taxYear, annualTax, legalDescription, lotSize, yearBuilt, gla, bedrooms, bathrooms, stories, propertyClass, zoning }`,

    general: `Extract all relevant real estate and appraisal data from this document. Return structured JSON with clear field names.`,
  };

  const contents = [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
      { text: prompts[documentType] || prompts.general },
    ],
  }];

  const response = await callPlatformAI(contents, {
    feature: `pdf-extract-${documentType}`,
    systemInstruction: 'You are an expert appraisal data extraction system. Extract every piece of data with 100% accuracy. Return only valid JSON.',
    maxTokens: 4000,
    temperature: 0.05,
  });

  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Could not parse extraction result');
  }

  return { data: parsed, source: 'platform-gemini', documentType };
}

/**
 * Analyze a photo using platform AI.
 * Built-in feature — auto-categorize and detect condition/quality.
 *
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 * @returns {Promise<Object>}
 */
export async function platformAnalyzePhoto(imageBuffer, mimeType = 'image/jpeg') {
  const base64 = imageBuffer.toString('base64');

  const contents = [{
    role: 'user',
    parts: [
      { inlineData: { mimeType, data: base64 } },
      { text: `Analyze this real estate inspection photo. Return JSON: { "category": "front|rear|street|kitchen|bathroom|living|bedroom|basement|garage|exterior|other", "caption": "one-sentence professional caption", "condition": "C1|C2|C3|C4|C5|C6", "quality": "Q1|Q2|Q3|Q4|Q5|Q6", "features": ["notable features"], "materials": ["visible materials"], "issues": ["any defects or concerns"], "confidence": "high|medium|low" }` },
    ],
  }];

  const response = await callPlatformAI(contents, {
    feature: 'photo-analysis',
    maxTokens: 500,
    temperature: 0.1,
  });

  let parsed;
  try {
    parsed = JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else return { category: 'other', caption: 'Property photo', confidence: 'low' };
  }

  return parsed;
}

/**
 * Classify a document type using platform AI.
 * Determines if uploaded PDF is an order, MLS sheet, tax record, etc.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} document type
 */
export async function platformClassifyDocument(pdfBuffer) {
  const base64 = pdfBuffer.toString('base64');

  const contents = [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
      { text: 'What type of real estate document is this? Return ONLY one of: order, mls, tax, survey, engagement, hoa, inspection, appraisal, other' },
    ],
  }];

  const response = await callPlatformAI(contents, {
    feature: 'doc-classify',
    maxTokens: 20,
    temperature: 0.0,
  });

  const type = response.trim().toLowerCase().replace(/[^a-z]/g, '');
  const valid = ['order', 'mls', 'tax', 'survey', 'engagement', 'hoa', 'inspection', 'appraisal', 'other'];
  return valid.includes(type) ? type : 'other';
}

/**
 * Smart document upload — classify then extract.
 * The user uploads ANY PDF and we figure out what it is and extract the right data.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>}
 */
export async function platformSmartExtract(pdfBuffer) {
  const startTime = Date.now();

  // Step 1: Classify the document
  const documentType = await platformClassifyDocument(pdfBuffer);

  // Step 2: Extract based on type
  const extraction = await platformExtractPdf(pdfBuffer, documentType);

  const durationMs = Date.now() - startTime;
  log.info('platform-ai:smart-extract', { documentType, durationMs });

  return {
    documentType,
    ...extraction,
    durationMs,
  };
}

/**
 * Batch extract multiple PDFs at once.
 *
 * @param {Array<{buffer: Buffer, name: string}>} files
 * @returns {Promise<Array>}
 */
export async function platformBatchExtract(files) {
  const results = [];
  for (const file of files) {
    try {
      const result = await platformSmartExtract(file.buffer);
      results.push({ name: file.name, ok: true, ...result });
    } catch (err) {
      results.push({ name: file.name, ok: false, error: err.message });
    }
  }
  return results;
}

export default {
  isPlatformAIAvailable, platformExtractPdf, platformAnalyzePhoto,
  platformClassifyDocument, platformSmartExtract, platformBatchExtract,
};
