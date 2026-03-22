/**
 * server/ai/multiCompExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extract multiple comparables from a single MLS search results PDF.
 *
 * Appraisers often download a multi-page MLS search results PDF
 * containing 6-20 potential comps. This module:
 *   1. Reads the entire PDF with Gemini vision
 *   2. Extracts ALL listed properties
 *   3. Returns structured data for each comp
 *   4. Auto-ranks by similarity to subject
 *   5. Can import best comps directly into case
 *
 * Platform AI feature — free for all users.
 */

import { dbGet, dbRun, dbAll } from '../db/database.js';
import { scoreCompSimilarity } from '../comparables/compAnalyzer.js';
import log from '../logger.js';
import crypto from 'crypto';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Extract all comparables from a multi-listing PDF.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>}
 */
export async function extractMultipleComps(pdfBuffer) {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured');

  const base64 = pdfBuffer.toString('base64');
  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: `Extract ALL property listings from this MLS search results document. For EACH property, return: { "address": "", "city": "", "state": "", "zip": "", "mlsNumber": "", "salePrice": number, "listPrice": number, "saleDate": "YYYY-MM-DD", "dom": number, "gla": number, "lotSize": number, "yearBuilt": number, "bedrooms": number, "bathrooms": number, "stories": number, "garageType": "", "garageCars": number, "basementArea": number, "basementFinished": number, "condition": "", "quality": "", "style": "", "heating": "", "cooling": "", "pricePerSf": number, "dataSource": "" }

Return a JSON array of all properties found. Include EVERY listing you can identify. Use numbers (not strings) for numeric fields. Omit fields with no data.` },
      ],
    }],
    generationConfig: { temperature: 0.05, maxOutputTokens: 8000 },
    systemInstruction: { parts: [{ text: 'You are an expert at extracting structured real estate data from MLS listing documents. Extract every property with precision.' }] },
  };

  const startTime = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let comps;
  try { comps = JSON.parse(text); } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) comps = JSON.parse(match[0]);
    else throw new Error('Could not parse comp extraction');
  }

  if (!Array.isArray(comps)) comps = [comps];

  // Calculate price per SF if missing
  for (const comp of comps) {
    if (comp.salePrice && comp.gla && !comp.pricePerSf) {
      comp.pricePerSf = Math.round(comp.salePrice / comp.gla * 100) / 100;
    }
  }

  const durationMs = Date.now() - startTime;
  log.info('multi-comp:extracted', { count: comps.length, durationMs });

  return { comps, count: comps.length, durationMs };
}

/**
 * Extract comps from PDF, rank against subject, and import best ones into case.
 */
export async function extractAndImportComps(caseId, pdfBuffer, { maxImport = 6 } = {}) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = { ...facts.subject, ...facts.improvements, ...facts.site };

  // Extract all comps
  const { comps, durationMs } = await extractMultipleComps(pdfBuffer);

  // Score each against subject
  const scored = comps.map(comp => ({
    ...comp,
    similarity: scoreCompSimilarity(subject, comp),
  }));

  // Sort by similarity
  scored.sort((a, b) => b.similarity.totalScore - a.similarity.totalScore);

  // Import top comps into case
  const imported = [];
  for (let i = 0; i < Math.min(scored.length, maxImport); i++) {
    const comp = scored[i];
    try {
      const id = crypto.randomBytes(8).toString('hex');
      dbRun(
        `INSERT INTO comp_candidates (id, case_id, source_type, source_key, candidate_json, is_active, created_at)
         VALUES (?, ?, 'mls_import', ?, ?, 1, datetime('now'))`,
        [id, caseId, comp.mlsNumber || comp.address || id, JSON.stringify(comp)]
      );
      imported.push({ id, address: comp.address, salePrice: comp.salePrice, similarity: comp.similarity.percentMatch });
    } catch (err) {
      log.warn('multi-comp:import-failed', { address: comp.address, error: err.message });
    }
  }

  log.info('multi-comp:imported', { caseId, extracted: comps.length, imported: imported.length });

  return {
    caseId,
    totalExtracted: comps.length,
    totalImported: imported.length,
    imported,
    allComps: scored.map(c => ({
      address: c.address,
      city: c.city,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      gla: c.gla,
      yearBuilt: c.yearBuilt,
      similarity: c.similarity.percentMatch,
    })),
    durationMs,
  };
}

export default { extractMultipleComps, extractAndImportComps };
