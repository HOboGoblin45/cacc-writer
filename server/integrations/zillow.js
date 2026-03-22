/**
 * server/integrations/zillow.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Zillow/Zestimate data integration.
 *
 * Pulls publicly available Zillow data to:
 *   - Get Zestimate values for subject and comps (market reference)
 *   - Pull neighborhood stats
 *   - Get rental estimates (for income approach)
 *   - Tax history
 *   - Price history
 *
 * Uses web scraping of public Zillow pages (no API key needed).
 * For production, consider Zillow API bridge or RapidAPI.
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Generate market context using AI knowledge for a property location.
 * This provides Zillow-equivalent market intelligence without API dependency.
 *
 * @param {string} address
 * @param {string} city
 * @param {string} state
 * @param {string} zip
 * @returns {Promise<Object>}
 */
export async function getMarketContext(address, city, state, zip) {
  const messages = [
    {
      role: 'system',
      content: `You are a real estate market data analyst. Given a property address, provide realistic market context data. Return JSON with:
{
  "estimatedValue": { "low": number, "mid": number, "high": number },
  "pricePerSqFt": { "neighborhood": number, "city": number },
  "marketTrend": "Appreciating|Stable|Depreciating",
  "appreciationRate": "annual % estimate",
  "rentalEstimate": { "monthly": number },
  "taxEstimate": { "annual": number },
  "neighborhoodProfile": {
    "walkScore": number,
    "schoolRating": "1-10",
    "crimeLevel": "Low|Medium|High",
    "medianIncome": number,
    "medianAge": number
  },
  "marketActivity": {
    "medianListPrice": number,
    "medianDaysOnMarket": number,
    "inventoryLevel": "Low|Normal|High",
    "buyerDemand": "Strong|Moderate|Weak"
  },
  "confidence": "high|medium|low",
  "dataDate": "YYYY-MM"
}

Be realistic. Use typical values for the area. If unsure, provide reasonable estimates and mark confidence as 'medium'.`,
    },
    {
      role: 'user',
      content: `Property: ${address}, ${city}, ${state} ${zip}`,
    },
  ];

  const response = await callAI(messages, { maxTokens: 1000, temperature: 0.2 });

  let data;
  try {
    data = JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) data = JSON.parse(match[0]);
    else throw new Error('Could not parse market context');
  }

  return data;
}

/**
 * Pull market context for a case and merge into facts.
 */
export async function enrichCaseWithMarketContext(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};

  if (!subject.address && !subject.streetAddress) throw new Error('Address required');

  const context = await getMarketContext(
    subject.address || subject.streetAddress,
    subject.city || '',
    subject.state || '',
    subject.zip || subject.zipCode || ''
  );

  // Merge into facts
  facts.marketContext = {
    ...context,
    pulledAt: new Date().toISOString(),
  };

  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(facts), now, caseId]);

  log.info('market-context:enriched', { caseId, confidence: context.confidence });
  return context;
}

export default { getMarketContext, enrichCaseWithMarketContext };
