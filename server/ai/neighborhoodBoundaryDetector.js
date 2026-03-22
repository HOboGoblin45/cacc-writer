/**
 * server/ai/neighborhoodBoundaryDetector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered neighborhood boundary detection.
 *
 * Every appraisal needs neighborhood boundaries (North: Main St, South: I-55,
 * East: Route 9, West: Veterans Pkwy). This module:
 *
 *   1. Uses geocoding to find the subject's coordinates
 *   2. Queries OpenStreetMap Overpass API for nearby roads/features
 *   3. AI determines the logical neighborhood boundaries
 *   4. Generates boundary description text
 *   5. Identifies land use percentages
 *   6. Finds nearby schools, shopping, employment centers
 *
 * Uses FREE public data (OSM) + Platform AI.
 */

import { geocodeAddress } from '../geocoder.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Detect neighborhood boundaries for a property.
 */
export async function detectBoundaries(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};

  // Geocode if needed
  let lat = parseFloat(subject.latitude || 0);
  let lon = parseFloat(subject.longitude || 0);

  if (!lat || !lon) {
    const fullAddr = `${subject.address || subject.streetAddress}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}`;
    try {
      const geo = await geocodeAddress(fullAddr);
      if (geo) { lat = geo.lat; lon = geo.lon; }
    } catch { /* ok */ }
  }

  if (!lat || !lon) throw new Error('Could not geocode subject address');

  // Query OpenStreetMap for nearby major roads and features
  let osmData = null;
  try {
    const radius = 2000; // 2km radius
    const query = `[out:json][timeout:15];(
      way["highway"~"primary|secondary|tertiary|motorway|trunk"](around:${radius},${lat},${lon});
      way["waterway"~"river|stream"](around:${radius},${lat},${lon});
      way["railway"="rail"](around:${radius},${lat},${lon});
      node["amenity"~"school|hospital|shopping"](around:${radius},${lat},${lon});
      node["shop"~"supermarket|mall"](around:${radius},${lat},${lon});
    );out tags;`;

    const osmRes = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(20000),
    });

    if (osmRes.ok) {
      osmData = await osmRes.json();
    }
  } catch (e) {
    log.warn('boundary:osm-failed', { error: e.message });
  }

  // Extract road names and features
  const roads = [];
  const features = [];
  if (osmData?.elements) {
    for (const el of osmData.elements) {
      if (el.tags?.name) {
        if (el.tags.highway) roads.push({ name: el.tags.name, type: el.tags.highway });
        else if (el.tags.waterway) features.push({ name: el.tags.name, type: 'waterway' });
        else if (el.tags.railway) features.push({ name: el.tags.name, type: 'railway' });
        else if (el.tags.amenity) features.push({ name: el.tags.name, type: el.tags.amenity });
        else if (el.tags.shop) features.push({ name: el.tags.name, type: 'shopping' });
      }
    }
  }

  // Use AI to determine logical boundaries
  if (!PLATFORM_GEMINI_KEY) {
    return { roads, features, note: 'Platform AI not configured — raw OSM data returned' };
  }

  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `Determine the neighborhood boundaries for a residential property at:
${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}
Coordinates: ${lat}, ${lon}

Nearby major roads: ${roads.map(r => `${r.name} (${r.type})`).join(', ') || 'none found'}
Nearby features: ${features.map(f => `${f.name} (${f.type})`).join(', ') || 'none found'}

Return JSON:
{
  "boundaries": { "north": "road/feature name", "south": "", "east": "", "west": "" },
  "boundaryDescription": "The neighborhood is bounded by X to the north, Y to the south...",
  "neighborhoodName": "name if identifiable",
  "nearbySchools": [{ "name": "", "distance": "X miles", "type": "elementary|middle|high" }],
  "nearbyShopping": [{ "name": "", "distance": "X miles" }],
  "nearbyEmployment": [{ "name": "", "distance": "X miles" }],
  "nearbyTransit": [{ "name": "", "distance": "X miles", "type": "highway|bus|rail" }],
  "landUse": { "residential": 75, "commercial": 15, "industrial": 5, "agricultural": 5 },
  "confidence": "high|medium|low"
}` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
  };

  const aiRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!aiRes.ok) throw new Error(`AI error: ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let boundaries;
  try { boundaries = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) boundaries = JSON.parse(match[0]); else throw new Error('Parse failed');
  }

  // Save to facts
  facts.neighborhood = { ...(facts.neighborhood || {}), ...boundaries, detectedAt: new Date().toISOString() };
  facts.subject = { ...subject, latitude: lat, longitude: lon };
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = datetime("now") WHERE case_id = ?', [JSON.stringify(facts), caseId]);

  log.info('boundary:detected', { caseId, confidence: boundaries.confidence });
  return boundaries;
}

export default { detectBoundaries };
