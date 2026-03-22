/**
 * server/ai/compNarrativeGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered comparable analysis narrative generator.
 *
 * Generates the most difficult part of an appraisal — the comp discussion.
 * For each comparable, AI writes:
 *   - Why this comp was selected
 *   - How it compares to the subject
 *   - Justification for each adjustment
 *   - Market support for adjustment amounts
 *   - Bracketing analysis
 *   - Weight given in reconciliation
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbAll } from '../db/database.js';
import { scoreCompSimilarity, suggestAdjustments } from '../comparables/compAnalyzer.js';
import { getLearnedMarketFactors } from '../intelligence/adjustmentLearner.js';
import log from '../logger.js';

/**
 * Generate comp discussion narratives for all comps in a case.
 */
export async function generateCompDiscussion(caseId, userId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = { ...facts.subject, ...facts.improvements, ...facts.site };

  let comps = [];
  try {
    comps = dbAll('SELECT * FROM comp_candidates WHERE case_id = ? AND is_active = 1 ORDER BY created_at LIMIT 6', [caseId]);
  } catch { return { error: 'No comps found' }; }

  if (comps.length === 0) return { error: 'No comps found' };

  // Get learned market factors
  const marketFactors = getLearnedMarketFactors(userId || 'default', {
    county: facts.subject?.county,
    city: facts.subject?.city,
  });

  const compAnalyses = [];

  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    const data = JSON.parse(comp.candidate_json || '{}');

    const similarity = scoreCompSimilarity(subject, data);
    const adjustments = suggestAdjustments(subject, data, marketFactors);

    const messages = [
      {
        role: 'system',
        content: `You are an expert residential real estate appraiser writing the comparable analysis discussion for an appraisal report. Write a professional narrative discussing this comparable sale, including:
1. Why this comp was selected (location, similarity, recency)
2. Key similarities and differences to the subject
3. Adjustment rationale for each significant adjustment
4. Market support for the adjustment amounts
5. The adjusted sale price and its reliability

Be specific with numbers. Reference actual property characteristics. This must be defensible in a review.`,
      },
      {
        role: 'user',
        content: `Subject: ${subject.address || 'N/A'}, ${subject.city || ''} ${subject.state || ''}
GLA: ${subject.gla || 'N/A'} SF | Year Built: ${subject.yearBuilt || 'N/A'} | Beds: ${subject.bedrooms || 'N/A'} | Baths: ${subject.bathrooms || 'N/A'}

Comparable ${i + 1}: ${data.address || comp.source_key || 'N/A'}, ${data.city || ''}
Sale Price: $${(data.salePrice || data.sale_price || 0).toLocaleString()} | Sale Date: ${data.saleDate || data.sale_date || 'N/A'}
GLA: ${data.gla || 'N/A'} SF | Year Built: ${data.yearBuilt || 'N/A'} | Beds: ${data.bedrooms || 'N/A'} | Baths: ${data.bathrooms || 'N/A'}
Lot: ${data.lotSize || 'N/A'} SF | Garage: ${data.garageCars || 'N/A'}-car

Similarity Score: ${similarity.percentMatch}%
Adjustments:
${adjustments.adjustments.map(a => `  ${a.label}: ${a.amount >= 0 ? '+' : ''}$${a.amount.toLocaleString()} (${a.reasoning})`).join('\n')}
Net Adjustment: $${adjustments.netAdjustment.toLocaleString()} (${adjustments.netAdjustmentPct}%)
Gross Adjustment: $${adjustments.grossAdjustment.toLocaleString()} (${adjustments.grossAdjustmentPct}%)
Adjusted Sale Price: $${adjustments.adjustedPrice.toLocaleString()}
${adjustments.flags.length ? 'Flags: ' + adjustments.flags.join('; ') : ''}

Write a 2-3 paragraph professional comparable analysis discussion.`,
      },
    ];

    try {
      const narrative = await callAI(messages, { maxTokens: 800, temperature: 0.3 });
      compAnalyses.push({
        compNumber: i + 1,
        address: data.address || comp.source_key,
        salePrice: data.salePrice || data.sale_price,
        adjustedPrice: adjustments.adjustedPrice,
        similarityScore: similarity.percentMatch,
        narrative,
        adjustments: adjustments.adjustments,
        flags: adjustments.flags,
      });
    } catch (err) {
      compAnalyses.push({ compNumber: i + 1, address: data.address, error: err.message });
    }
  }

  // Generate bracketing analysis
  const bracketingNarrative = await generateBracketingAnalysis(subject, compAnalyses, facts);

  log.info('comp-narrative:complete', { caseId, compsAnalyzed: compAnalyses.length });

  return {
    caseId,
    compDiscussions: compAnalyses,
    bracketing: bracketingNarrative,
    marketFactorsUsed: {
      learned: marketFactors._learnedCount,
      total: marketFactors._totalCategories,
    },
  };
}

async function generateBracketingAnalysis(subject, compAnalyses, facts) {
  const validComps = compAnalyses.filter(c => c.adjustedPrice);
  if (validComps.length < 2) return null;

  const prices = validComps.map(c => c.adjustedPrice).sort((a, b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const median = prices[Math.floor(prices.length / 2)];
  const finalValue = facts.reconciliation?.finalOpinionOfValue;

  const messages = [
    {
      role: 'system',
      content: 'Write a brief bracketing analysis for the sales comparison approach. Explain how the adjusted comparable values bracket the final opinion of value.',
    },
    {
      role: 'user',
      content: `Adjusted values: ${validComps.map(c => `Comp ${c.compNumber}: $${c.adjustedPrice.toLocaleString()}`).join(', ')}
Range: $${low.toLocaleString()} to $${high.toLocaleString()}
Median: $${median.toLocaleString()}
${finalValue ? `Final Opinion of Value: $${Number(finalValue).toLocaleString()}` : ''}

Write a 1-2 paragraph bracketing analysis.`,
    },
  ];

  try {
    return await callAI(messages, { maxTokens: 500, temperature: 0.3 });
  } catch { return null; }
}

export default { generateCompDiscussion };
