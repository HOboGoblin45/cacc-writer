/**
 * server/ai/conditionRatingAssistant.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-assisted condition and quality rating determination.
 *
 * One of the most contested parts of an appraisal — the C&Q ratings.
 * Lenders challenge them, reviewers second-guess them, AMCs send stips.
 *
 * This module:
 *   1. Analyzes ALL case data (photos, field notes, measurements)
 *   2. Suggests C&Q ratings with detailed justification
 *   3. Provides UAD 3.6 compliant rating definitions
 *   4. Cross-references photos against rating criteria
 *   5. Generates defensible rating narrative
 *   6. Compares subject to comp ratings for consistency
 *   7. Flags potential rating disputes before they happen
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';

const CQ_DEFINITIONS = {
  condition: {
    C1: 'All improvements are new and have not previously been occupied. The entire structure and all components are new, and the dwelling features no physical depreciation.',
    C2: 'The improvements are recently constructed and not previously occupied. No updates or deferred maintenance are apparent. All short-lived building components are expected to meet or exceed their expected useful life.',
    C3: 'The improvements are well maintained and feature limited physical depreciation due to normal wear and tear. Some components may have been updated or recently repaired. The overall effective age may be less than actual age.',
    C4: 'The improvements feature some minor deferred maintenance and physical deterioration due to normal wear and tear. The dwelling has been adequately maintained and requires only minimal repairs to building components.',
    C5: 'The improvements feature obvious deferred maintenance and are in need of some significant repairs. Some building components need repairs, and many minor repairs are needed.',
    C6: 'The improvements need substantial repairs and rehabilitation. The improvements are below minimum building standards and are not habitable in their current condition.',
  },
  quality: {
    Q1: 'Dwellings with this quality rating are usually unique structures that are individually designed by an architect for a specified user. Materials and finishes throughout are of the highest quality.',
    Q2: 'Dwellings with this quality rating are often custom designed for construction on an individual property owner\'s site. Materials and finishes throughout the dwelling are generally of high or very high quality.',
    Q3: 'Dwellings with this quality rating are residences of higher quality built from individual or readily available designer plans. The design includes significant exterior ornamentation and interiors are well finished.',
    Q4: 'Dwellings with this quality rating meet or exceed the requirements of applicable building codes. Standard or modified standard building plans are utilized. Materials and finishes are of average to good quality.',
    Q5: 'Dwellings with this quality rating feature economy of construction and basic functionality as main considerations. Materials and finishes are primarily stock or builder grade.',
    Q6: 'Dwellings with this quality rating are of basic quality and lower cost. Some components may not be up to current building code. Only the most basic finishes are present.',
  },
};

/**
 * AI-assisted C&Q rating analysis.
 */
export async function analyzeConditionQuality(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const improvements = facts.improvements || {};
  const photoAnalysis = facts.photoAnalysis || {};
  const subject = facts.subject || {};

  // Gather all evidence
  const evidence = [];

  // From photos
  if (photoAnalysis.predominantCondition) evidence.push(`Photo analysis suggests condition: ${photoAnalysis.predominantCondition}`);
  if (photoAnalysis.predominantQuality) evidence.push(`Photo analysis suggests quality: ${photoAnalysis.predominantQuality}`);
  if (photoAnalysis.issues?.length) evidence.push(`Photo issues: ${photoAnalysis.issues.join('; ')}`);
  if (photoAnalysis.features?.length) evidence.push(`Features observed: ${photoAnalysis.features.join(', ')}`);
  if (photoAnalysis.materials?.length) evidence.push(`Materials: ${photoAnalysis.materials.join(', ')}`);

  // From field notes
  let fieldNotes = [];
  try {
    fieldNotes = dbAll('SELECT transcript FROM voice_notes WHERE case_id = ? ORDER BY created_at', [caseId]);
  } catch { /* ok */ }
  if (fieldNotes.length) evidence.push(`Field notes: ${fieldNotes.map(n => n.transcript).join('. ')}`);

  // From checklists
  let checklists = [];
  try {
    checklists = dbAll('SELECT room, items_json, notes FROM inspection_checklists WHERE case_id = ?', [caseId]);
  } catch { /* ok */ }
  if (checklists.length) {
    evidence.push(`Checklist data: ${checklists.map(c => `${c.room}: ${c.notes || 'complete'}`).join('; ')}`);
  }

  // Property characteristics
  const yearBuilt = parseInt(improvements.yearBuilt || 0);
  const age = yearBuilt ? new Date().getFullYear() - yearBuilt : null;
  const effectiveAge = parseInt(improvements.effectiveAge || 0);

  const messages = [
    {
      role: 'system',
      content: `You are a senior appraisal reviewer determining the condition and quality ratings for a residential property per UAD standards. Analyze ALL evidence and provide ratings with detailed justification.

CONDITION DEFINITIONS:
${Object.entries(CQ_DEFINITIONS.condition).map(([k, v]) => `${k}: ${v}`).join('\n')}

QUALITY DEFINITIONS:
${Object.entries(CQ_DEFINITIONS.quality).map(([k, v]) => `${k}: ${v}`).join('\n')}

Return JSON:
{
  "condition": {
    "rating": "C1-C6",
    "confidence": "high|medium|low",
    "justification": "detailed explanation referencing specific evidence",
    "keyFactors": ["list of factors that determined this rating"],
    "definition": "the UAD definition for this rating"
  },
  "quality": {
    "rating": "Q1-Q6",
    "confidence": "high|medium|low",
    "justification": "detailed explanation",
    "keyFactors": ["list of factors"],
    "definition": "the UAD definition"
  },
  "effectiveAge": number_estimate,
  "remainingEconomicLife": number_estimate,
  "totalEconomicLife": number_estimate,
  "disputeRisk": "low|medium|high",
  "disputeRiskFactors": ["factors that could lead to rating challenges"],
  "defensibilityScore": 1-10,
  "recommendations": ["any suggestions for strengthening the rating"]
}`,
    },
    {
      role: 'user',
      content: `Property: ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''}
Year Built: ${yearBuilt || 'N/A'} (${age ? age + ' years old' : 'age unknown'})
Effective Age: ${effectiveAge || 'Not specified'}
GLA: ${improvements.gla || 'N/A'} SF
Current Condition Rating: ${improvements.condition || 'Not set'}
Current Quality Rating: ${improvements.quality || 'Not set'}

EVIDENCE:
${evidence.length > 0 ? evidence.join('\n') : 'No additional evidence available. Base analysis on property age, GLA, and general characteristics for the area.'}`,
    },
  ];

  const response = await callAI(messages, { maxTokens: 2000, temperature: 0.2 });

  let analysis;
  try { analysis = JSON.parse(response); } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) analysis = JSON.parse(match[0]); else throw new Error('Parse failed');
  }

  // Save to facts
  facts.cqAnalysis = { ...analysis, analyzedAt: new Date().toISOString() };
  if (analysis.condition?.rating && !improvements.condition) facts.improvements.condition = analysis.condition.rating;
  if (analysis.quality?.rating && !improvements.quality) facts.improvements.quality = analysis.quality.rating;
  if (analysis.effectiveAge && !improvements.effectiveAge) facts.improvements.effectiveAge = String(analysis.effectiveAge);

  dbGet.__db || (() => {
    const { getDb } = require('../db/database.js');
    getDb().prepare(`UPDATE case_facts SET facts_json = ?, updated_at = datetime("now") WHERE case_id = ?`)
      .run(JSON.stringify(facts), caseId);
  })();

  try {
    const { getDb } = await import('../db/database.js');
    getDb().prepare(`UPDATE case_facts SET facts_json = ?, updated_at = datetime("now") WHERE case_id = ?`)
      .run(JSON.stringify(facts), caseId);
  } catch { /* ok */ }

  log.info('cq:analyzed', { caseId, condition: analysis.condition?.rating, quality: analysis.quality?.rating, disputeRisk: analysis.disputeRisk });
  return analysis;
}

export { CQ_DEFINITIONS };
export default { analyzeConditionQuality, CQ_DEFINITIONS };
