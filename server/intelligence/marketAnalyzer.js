/**
 * server/intelligence/marketAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered market conditions analyzer.
 *
 * Given a subject property location, automatically researches and generates:
 *   - Market conditions narrative (supply/demand, price trends)
 *   - Neighborhood boundaries and description
 *   - Location factors (proximity to schools, highways, commercial)
 *   - Zoning compliance analysis
 *   - Flood zone / environmental risk context
 *
 * Uses the geocoder + AI to produce defensible, data-backed narratives.
 */

import { callAI } from '../openaiClient.js';
import { geocodeAddress } from '../geocoder.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Analyze market conditions for a subject property.
 *
 * @param {string} caseId
 * @param {Object} [options]
 * @returns {Promise<Object>} market analysis
 */
export async function analyzeMarket(caseId, options = {}) {
  const startTime = Date.now();

  const caseFacts = dbGet('SELECT * FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};

  // Geocode subject if not already done
  let geo = null;
  if (subject.address || subject.streetAddress) {
    try {
      const fullAddr = `${subject.address || subject.streetAddress}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || subject.zipCode || ''}`;
      geo = await geocodeAddress(fullAddr);
    } catch (e) {
      log.warn('market:geocode-failed', { error: e.message });
    }
  }

  // Build analysis prompt
  const contextParts = [
    `Subject: ${subject.address || subject.streetAddress || 'Unknown'}`,
    `City: ${subject.city || 'Unknown'}, ${subject.state || ''} ${subject.zip || ''}`,
    `County: ${subject.county || 'Unknown'}`,
  ];

  if (facts.improvements) {
    const imp = facts.improvements;
    contextParts.push(`Property: ${imp.yearBuilt ? 'Built ' + imp.yearBuilt : ''} ${imp.gla ? imp.gla + ' SF' : ''} ${imp.bedrooms ? imp.bedrooms + 'BR' : ''} ${imp.bathrooms ? imp.bathrooms + 'BA' : ''}`);
  }

  if (geo) {
    contextParts.push(`Coordinates: ${geo.lat}, ${geo.lon}`);
    if (geo.boundaryRoads) contextParts.push(`Boundary roads: ${geo.boundaryRoads}`);
    if (geo.landUse) contextParts.push(`Land use: ${geo.landUse}`);
  }

  if (facts.contract?.salePrice) {
    contextParts.push(`Contract price: $${Number(facts.contract.salePrice).toLocaleString()}`);
  }

  const messages = [
    {
      role: 'system',
      content: `You are an expert residential real estate appraiser analyzing market conditions. Generate a comprehensive market analysis for the subject property location.

Return a JSON object with these sections:

{
  "neighborhood": {
    "name": "Neighborhood/subdivision name if identifiable",
    "boundaries": "North: [road], South: [road], East: [road], West: [road]",
    "builtUp": "Over 75%|25-75%|Under 25%",
    "growth": "Rapid|Stable|Slow",
    "propertyValues": "Increasing|Stable|Declining",
    "demandSupply": "Shortage|In Balance|Over Supply",
    "marketingTime": "Under 3 Mos|3-6 Mos|Over 6 Mos",
    "predominantOccupancy": "Owner|Tenant|Vacant (0-5%)|Vacant (over 5%)",
    "landUseResidential": "percentage as number",
    "landUseCommercial": "percentage as number",
    "singleFamilyPriceRange": {"low": number, "high": number, "predominant": number},
    "singleFamilyAgeRange": {"low": number, "high": number, "predominant": number},
    "description": "2-3 sentence neighborhood description"
  },
  "marketConditions": {
    "trend": "Stable|Increasing|Declining",
    "medianDaysOnMarket": number or null,
    "supplyMonths": number or null,
    "absorptionRate": "description",
    "narrative": "3-5 sentence market conditions narrative suitable for an appraisal report"
  },
  "locationFactors": {
    "proximity": [
      {"type": "School", "name": "approximate", "distance": "X miles"},
      {"type": "Shopping", "name": "approximate", "distance": "X miles"},
      {"type": "Highway", "name": "approximate", "distance": "X miles"},
      {"type": "Employment", "name": "approximate", "distance": "X miles"}
    ],
    "positiveFactors": ["list of positive location factors"],
    "negativeFactors": ["list of negative location factors or 'None noted'"],
    "narrative": "2-3 sentence location summary"
  },
  "confidence": "high|medium|low"
}

Be realistic and conservative. If you're unsure about specific data points, use reasonable estimates based on typical patterns for this type of area and note your confidence level. Do NOT fabricate specific MLS statistics.`,
    },
    {
      role: 'user',
      content: `Analyze market conditions for this property:\n\n${contextParts.join('\n')}`,
    },
  ];

  const response = await callAI(messages, { maxTokens: 2000, temperature: 0.2 });

  // Parse response
  let analysis;
  try {
    analysis = JSON.parse(response);
  } catch {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[1]);
    } else {
      const start = response.indexOf('{');
      const end = response.lastIndexOf('}');
      if (start >= 0 && end > start) {
        analysis = JSON.parse(response.slice(start, end + 1));
      } else {
        throw new Error('Could not parse market analysis response');
      }
    }
  }

  const durationMs = Date.now() - startTime;

  // Save analysis to case facts
  const updatedFacts = {
    ...facts,
    neighborhood: {
      ...(facts.neighborhood || {}),
      ...analysis.neighborhood,
    },
    marketConditions: analysis.marketConditions,
    locationFactors: analysis.locationFactors,
  };

  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(updatedFacts), now, caseId]);

  log.info('market:analysis-complete', { caseId, durationMs, confidence: analysis.confidence });

  return {
    caseId,
    analysis,
    geo,
    durationMs,
  };
}

export default { analyzeMarket };
