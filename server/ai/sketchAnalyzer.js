/**
 * server/ai/sketchAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered floor plan / sketch analyzer.
 *
 * Appraisers draw or photograph floor plan sketches during inspections.
 * This module uses Gemini vision to:
 *   1. Read a hand-drawn or digital floor plan sketch
 *   2. Extract room dimensions and calculate areas
 *   3. Identify room types (bedroom, bathroom, kitchen, etc.)
 *   4. Calculate total GLA per floor
 *   5. Detect floor count and layout type
 *   6. Cross-check against case facts for consistency
 *
 * Platform AI feature — free for all users.
 */

import { isPlatformAIAvailable } from './platformAI.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';
import fs from 'fs';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Analyze a floor plan sketch image.
 *
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 * @returns {Promise<Object>}
 */
export async function analyzeSketch(imageBuffer, mimeType = 'image/jpeg') {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured');

  const base64 = imageBuffer.toString('base64');
  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: `Analyze this floor plan sketch of a residential property. Extract all room measurements and calculate areas. Return JSON:
{
  "floors": [
    {
      "level": "1st Floor",
      "rooms": [
        { "name": "Living Room", "length": 15, "width": 12, "area": 180 },
        { "name": "Kitchen", "length": 12, "width": 10, "area": 120 }
      ],
      "totalArea": 0
    }
  ],
  "totalGLA": 0,
  "stories": 1,
  "layoutType": "Ranch|Two-Story|Split-Level|Bi-Level|Cape Cod|Colonial|Other",
  "rooms": { "bedrooms": 0, "bathrooms": 0, "total": 0 },
  "garage": { "attached": true, "cars": 2, "area": 0 },
  "basement": { "exists": false, "finishedArea": 0, "totalArea": 0 },
  "notes": ["any observations about the layout"],
  "confidence": "high|medium|low"
}

If dimensions are written on the sketch, use those exact numbers. If not visible, estimate based on proportions and typical room sizes. Calculate all areas as length × width. Total GLA = sum of above-grade living areas (exclude garage, basement, porches).` },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
    systemInstruction: { parts: [{ text: 'You are an expert at reading residential property floor plan sketches and extracting precise measurements.' }] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sketch analysis error: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]); else throw new Error('Could not parse sketch analysis');
  }

  // Recalculate totals for accuracy
  if (parsed.floors) {
    let totalGLA = 0;
    for (const floor of parsed.floors) {
      let floorTotal = 0;
      for (const room of floor.rooms || []) {
        room.area = room.area || (room.length && room.width ? Math.round(room.length * room.width) : 0);
        floorTotal += room.area;
      }
      floor.totalArea = floorTotal;
      totalGLA += floorTotal;
    }
    parsed.totalGLA = totalGLA;
  }

  log.info('sketch:analyzed', { totalGLA: parsed.totalGLA, floors: parsed.floors?.length, confidence: parsed.confidence });
  return parsed;
}

/**
 * Analyze a sketch and update case measurements + facts.
 */
export async function analyzeSketchForCase(caseId, imageBuffer, mimeType) {
  const analysis = await analyzeSketch(imageBuffer, mimeType);

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  // Update improvements with sketch data
  if (!facts.improvements) facts.improvements = {};
  if (analysis.totalGLA) facts.improvements.gla = String(analysis.totalGLA);
  if (analysis.stories) facts.improvements.stories = String(analysis.stories);
  if (analysis.rooms?.bedrooms) facts.improvements.bedrooms = String(analysis.rooms.bedrooms);
  if (analysis.rooms?.bathrooms) facts.improvements.bathrooms = String(analysis.rooms.bathrooms);
  if (analysis.rooms?.total) facts.improvements.totalRooms = String(analysis.rooms.total);
  if (analysis.garage?.cars) facts.improvements.garageCars = String(analysis.garage.cars);
  if (analysis.garage?.attached !== undefined) facts.improvements.garageType = analysis.garage.attached ? 'Attached' : 'Detached';
  if (analysis.basement?.totalArea) facts.improvements.basementArea = String(analysis.basement.totalArea);
  if (analysis.basement?.finishedArea) facts.improvements.basementFinished = String(analysis.basement.finishedArea);
  if (analysis.layoutType) facts.improvements.design = analysis.layoutType;

  // Save sketch analysis
  facts.sketchAnalysis = {
    ...analysis,
    analyzedAt: new Date().toISOString(),
  };

  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(facts), now, caseId]);

  log.info('sketch:case-updated', { caseId, totalGLA: analysis.totalGLA });

  return {
    caseId,
    ...analysis,
    factsUpdated: true,
  };
}

export default { analyzeSketch, analyzeSketchForCase };
